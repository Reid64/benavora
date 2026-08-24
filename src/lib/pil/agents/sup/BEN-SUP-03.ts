import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { logAction } from "@/lib/pil/audit";
import type { AgentRun, AgentRunStatus } from "@/lib/pil/types";

// BEN-SUP-03 -- Cross-Agent Research Planner
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 1 -- SUPERVISORY & ORCHESTRATION").
// Converts a research run into a dependency-aware, staged execution plan:
// Discovery -> Prospect Intelligence (parallel) -> Relationship Intelligence
// -> Qualification, matching the spec's worked example ("Individual/
// Foundation/Board/Giving/Business Intelligence run concurrently; entity
// reconciliation -> affinity -> relationship -> qualification run after").
// "Agent tasks" for a research run are its pil_agent_runs rows -- there is
// no research_run_id column on pil_delegated_tasks (only parent_agent_run_id),
// so per-run task state is observed through pil_agent_runs.

interface PlanStage {
  stage: number;
  agents: string[];
  dependsOn: number | null;
}

const STAGES: PlanStage[] = [
  { stage: 1, agents: ["BEN-DIS-01"], dependsOn: null },
  { stage: 2, agents: ["BEN-INT-01", "BEN-INT-08"], dependsOn: 1 },
  { stage: 3, agents: ["BEN-REL-01"], dependsOn: 2 },
  { stage: 4, agents: ["BEN-QLF-04"], dependsOn: 3 },
];

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;

type StageStatus = "not_started" | "in_progress" | "completed" | "failed";

function statusOf(agentCode: string, tasks: AgentRun[]): AgentRunStatus | null {
  const relevant = tasks.filter((t) => t.agent_id === agentCode);
  if (relevant.length === 0) return null;
  // Most recent attempt wins (retries after a failure supersede it).
  const latest = relevant.reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b));
  return latest.status;
}

function stageStatus(stage: PlanStage, tasks: AgentRun[]): StageStatus {
  const statuses = stage.agents.map((agentCode) => statusOf(agentCode, tasks));
  if (statuses.every((s) => s === "completed")) return "completed";
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.every((s) => s === null)) return "not_started";
  return "in_progress";
}

export class CrossAgentResearchPlanner implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    // 1. Receive the active research run's existing agent tasks.
    const tasks = await this.loadAgentRuns(context.orgId, context.runId);

    // 2/3. Analyze dependencies and determine each stage's readiness.
    const stageStatuses = STAGES.map((stage) => ({ stage, status: stageStatus(stage, tasks) }));

    await this.tryUseTool(context, runner, "T-GRAPH", 20);
    const tokensUsed = await this.tryUseTool(context, runner, "T-MODEL", 100);

    const delegations: DelegationRequest[] = [];
    const decisions: Record<string, unknown>[] = [];

    // 6. Handle failures first: replan by re-dispatching only the failed
    // agents in the earliest failed stage rather than cascading forward.
    const failedStage = stageStatuses.find((s) => s.status === "failed");
    if (failedStage) {
      const failedAgents = failedStage.stage.agents.filter((agentCode) => statusOf(agentCode, tasks) === "failed");
      for (const agentCode of failedAgents) {
        delegations.push({
          childAgentCode: agentCode,
          objective: `Retry stage ${failedStage.stage.stage} task after failure (research run ${context.runId})`,
          maxAutonomy: "A2",
        });
      }
      decisions.push({ action: "replan_failed_stage", stage: failedStage.stage.stage, agents: failedAgents });
    } else {
      // 4/5. Create delegated tasks for the earliest stage whose
      // dependency is satisfied and that has not yet started, and monitor
      // completion of everything already in flight.
      const readyStage = stageStatuses.find(({ stage, status }) => {
        if (status !== "not_started") return false;
        if (stage.dependsOn === null) return true;
        const dependency = stageStatuses.find((s) => s.stage.stage === stage.dependsOn);
        return dependency?.status === "completed";
      });

      if (readyStage) {
        for (const agentCode of readyStage.stage.agents) {
          delegations.push({
            childAgentCode: agentCode,
            objective: `Execute stage ${readyStage.stage.stage} research task (research run ${context.runId})`,
            maxAutonomy: "A2",
          });
        }
        decisions.push({ action: "dispatch_stage", stage: readyStage.stage.stage, agents: readyStage.stage.agents });
      } else {
        decisions.push({ action: "await_dependencies", stageStatuses: stageStatuses.map((s) => ({ stage: s.stage.stage, status: s.status })) });
      }
    }

    for (const decision of decisions) {
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: `planner.${decision.action}`,
        resource_type: "pil_research_runs",
        resource_id: context.runId,
        before_state: null,
        after_state: decision,
        policy_decision: null,
        ip_address: null,
      });
    }

    // 7. Determine terminal state: all stages complete with no orphaned
    // tasks and no active failure.
    const allComplete = stageStatuses.every((s) => s.status === "completed");
    const status: AgentResult["status"] = allComplete ? "completed" : failedStage ? "replanning" : "running";

    return {
      status,
      evidence: [],
      conclusions: {
        stageStatuses: stageStatuses.map((s) => ({ stage: s.stage.stage, agents: s.stage.agents, status: s.status })),
        decisions,
        allComplete,
      },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private async loadAgentRuns(orgId: string, researchRunId: string): Promise<AgentRun[]> {
    const { data, error } = await getPilClient()
      .from("pil_agent_runs")
      .select("*")
      .eq("organization_id", orgId)
      .eq("research_run_id", researchRunId);
    if (error) throw error;
    return (data ?? []) as AgentRun[];
  }

  private async tryUseTool(context: AgentContext, runner: AgentRunner, tool: string, units: number): Promise<number> {
    if (!context.tools.includes(tool)) return 0;
    try {
      await runner.useTool(context, tool, { unitCost: MODEL_TOKEN_UNIT_COST_USD, units, costType: "model_tokens" });
      return units;
    } catch {
      return 0;
    }
  }
}

export default CrossAgentResearchPlanner;
