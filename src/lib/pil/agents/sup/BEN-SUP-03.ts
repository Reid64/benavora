import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { logAction } from "@/lib/pil/audit";
import { getBudgetSummary } from "@/lib/pil/cost";
import type { AgentRun, AgentRunStatus, CostBudget } from "@/lib/pil/types";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";

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
//
// This file also covers the spec's redundant-research prevention
// ("observes redundant-research risk"), orphaned-task recovery ("no
// orphaned tasks past deadline"), and delegation-authority bound
// ("plan requires ... authority beyond A2 without prior tenant policy
// grant" -- a missing implementation is exactly that: no specialist exists
// to grant authority to, so the plan gets revised at the strategy level
// (BEN-SUP-02) instead of retried).

interface PlanStage {
  stage: number;
  agents: string[];
  dependsOn: number | null;
}

const STAGES: PlanStage[] = [
  // Phase 5.4 (2026-09-15): BEN-DIS-02 (Major Donor Discovery) and BEN-DIS-08
  // (Hidden Prospect & CRM Rediscovery) were fully built but had no entry
  // point into this pipeline -- both are independent of any other stage's
  // output (BEN-DIS-08 does an org-wide CRM scan, BEN-DIS-02 needs only
  // context.goal), so they run in parallel with BEN-DIS-01 here, same as
  // stage 2 already fans out to two agents at once.
  { stage: 1, agents: ["BEN-DIS-01", "BEN-DIS-02", "BEN-DIS-08"], dependsOn: null },
  { stage: 2, agents: ["BEN-INT-01", "BEN-INT-08"], dependsOn: 1 },
  { stage: 3, agents: ["BEN-REL-01"], dependsOn: 2 },
  { stage: 4, agents: ["BEN-QLF-04"], dependsOn: 3 },
];

// Redundancy window: a COMPLETED run of the same agent against the same
// prospect (in any research run for this org) within the last 7 days is
// treated as still-fresh evidence -- reuses the spec's "observes
// redundant-research risk by checking existing pil_evidence before
// assigning new research" intent, scoped to pil_agent_runs since that's
// where per-agent task completion actually lives (see file header).
const REDUNDANCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Orphan staleness: a stage stuck "in_progress" (started but neither
// completed nor failed) for longer than this is treated as an orphaned/
// stuck join rather than left to poll forever.
const ORPHAN_STALENESS_MS = 30 * 60 * 1000;

// Exact text of agents/index.ts's NotImplementedAgent fallback error --
// matching against it is how this planner tells "specialist doesn't exist
// yet" apart from an ordinary retryable failure.
const CAPABILITY_ABSENT_ERROR_TEXT = "has no implementation yet";

type StageStatus = "not_started" | "in_progress" | "completed" | "failed";

interface StageStatusEntry {
  stage: PlanStage;
  status: StageStatus;
}

function latestRunFor(agentCode: string, tasks: AgentRun[]): AgentRun | null {
  const relevant = tasks.filter((t) => t.agent_id === agentCode);
  if (relevant.length === 0) return null;
  // Most recent attempt wins (retries after a failure supersede it).
  return relevant.reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b));
}

function statusOf(agentCode: string, tasks: AgentRun[]): AgentRunStatus | null {
  return latestRunFor(agentCode, tasks)?.status ?? null;
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
    const stageStatuses: StageStatusEntry[] = STAGES.map((stage) => ({ stage, status: stageStatus(stage, tasks) }));

    await this.tryUseTool(context, runner, "T-GRAPH", 20);
    const tokensUsed = await this.tryUseTool(context, runner, "T-MODEL", 100);

    const delegations: DelegationRequest[] = [];
    const decisions: Record<string, unknown>[] = [];

    // 6. Handle failures first: replan by re-dispatching only the failed
    // agents in the earliest failed stage rather than cascading forward.
    // A failed agent whose latest run is capability-absent (no
    // implementation registered) is not an ordinary retryable failure --
    // retrying it would just reproduce the same NotImplementedAgent
    // failure forever, so it's routed to BEN-SUP-02 to revise the
    // strategy around the missing specialist instead.
    const failedStage = stageStatuses.find((s) => s.status === "failed");
    let effectiveStatuses: StageStatusEntry[] = stageStatuses;

    if (failedStage) {
      const failedAgents = failedStage.stage.agents.filter((agentCode) => statusOf(agentCode, tasks) === "failed");
      const retryAgents: string[] = [];
      for (const agentCode of failedAgents) {
        const latestRun = latestRunFor(agentCode, tasks);
        if (latestRun?.error?.includes(CAPABILITY_ABSENT_ERROR_TEXT)) {
          delegations.push({
            childAgentCode: "BEN-SUP-02",
            objective: `Capability ${agentCode} has no implementation yet (research run ${context.runId}, stage ${failedStage.stage.stage}) -- revise the research strategy around this missing specialist`,
            maxAutonomy: "A2",
          });
          decisions.push({ action: "capability_absent", stage: failedStage.stage.stage, agentCode, researchRunId: context.runId });
        } else {
          retryAgents.push(agentCode);
          delegations.push({
            childAgentCode: agentCode,
            objective: `Retry stage ${failedStage.stage.stage} task after failure (research run ${context.runId})`,
            maxAutonomy: "A2",
          });
        }
      }
      if (retryAgents.length > 0) {
        decisions.push({ action: "replan_failed_stage", stage: failedStage.stage.stage, agents: retryAgents });
      }
    } else {
      // 4/5. Create delegated tasks for the earliest stage whose
      // dependency is satisfied and that has not yet started, and monitor
      // completion of everything already in flight. Stages that turn out
      // to be entirely redundant (step (a) below) are marked completed
      // in-place so the next stage in line gets a chance this same cycle
      // instead of leaving the plan waiting on work that will never be
      // (re-)dispatched.
      const workingStatuses: StageStatusEntry[] = stageStatuses.map((s) => ({ ...s }));
      effectiveStatuses = workingStatuses;
      let dispatched = false;
      let budgetConstrained = false;

      for (let i = 0; i < STAGES.length; i++) {
        const readyStage = workingStatuses.find(({ stage, status }) => {
          if (status !== "not_started") return false;
          if (stage.dependsOn === null) return true;
          const dependency = workingStatuses.find((s) => s.stage.stage === stage.dependsOn);
          return dependency?.status === "completed";
        });
        if (!readyStage) break;

        // (d) Budget reservation conflict: don't open new spend on a
        // stage that hasn't already started if the org budget is already
        // at/over its alert threshold.
        const budgets = await getBudgetSummary(context.orgId);
        const orgBudget = budgets.find((b) => b.scope_type === "org" && b.scope_id === context.orgId) ?? null;
        if (this.isBudgetConstrained(orgBudget)) {
          decisions.push({ action: "budget_reservation_conflict", stage: readyStage.stage.stage, agents: readyStage.stage.agents });
          budgetConstrained = true;
          break;
        }

        // (a) Redundancy / duplicate-research prevention: don't
        // re-dispatch an agent that already completed against this exact
        // prospect in another research run within the redundancy window.
        const dispatchAgents: string[] = [];
        for (const agentCode of readyStage.stage.agents) {
          const redundant = context.prospectId
            ? await this.findRedundantCompletedRun(context.orgId, context.prospectId, agentCode, context.runId)
            : null;
          if (redundant) {
            decisions.push({
              action: "redundant_task_skipped",
              stage: readyStage.stage.stage,
              agentCode,
              priorAgentRunId: redundant.id,
              priorResearchRunId: redundant.research_run_id,
            });
          } else {
            dispatchAgents.push(agentCode);
          }
        }

        if (dispatchAgents.length > 0) {
          for (const agentCode of dispatchAgents) {
            delegations.push({
              childAgentCode: agentCode,
              objective: `Execute stage ${readyStage.stage.stage} research task (research run ${context.runId})`,
              maxAutonomy: "A2",
            });
          }
          decisions.push({ action: "dispatch_stage", stage: readyStage.stage.stage, agents: dispatchAgents });
          dispatched = true;
          break;
        }

        // Every agent in this stage was already satisfied by prior
        // research -- treat the stage as completed for stageStatus()
        // purposes this cycle and let the next stage compete to be ready.
        readyStage.status = "completed";
      }

      if (!dispatched && !budgetConstrained) {
        const stillIncomplete = workingStatuses.some((s) => s.status !== "completed");
        if (stillIncomplete) {
          // (b) Orphaned/stuck join detection: a stage that's been
          // in_progress past the staleness threshold with no completion
          // is handed to BEN-SUP-06 for recovery investigation instead of
          // being left to await_dependencies forever.
          const orphan = this.findOrphanedStage(workingStatuses, tasks);
          if (orphan) {
            delegations.push({
              childAgentCode: "BEN-SUP-06",
              objective: `Stalled stage ${orphan.stage.stage} (agents: ${orphan.stuckAgents.join(", ")}) has been in_progress since ${orphan.oldestStartedAt} with no completion for research run ${context.runId} -- investigate the orphaned/corrupted task and recommend recovery.`,
              maxAutonomy: "A2",
            });
            decisions.push({
              action: "orphan_detected",
              stage: orphan.stage.stage,
              agents: orphan.stuckAgents,
              oldestStartedAt: orphan.oldestStartedAt,
              researchRunId: context.runId,
            });
          } else {
            decisions.push({ action: "await_dependencies", stageStatuses: workingStatuses.map((s) => ({ stage: s.stage.stage, status: s.status })) });
          }
        }
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
    const allComplete = effectiveStatuses.every((s) => s.status === "completed");
    // p5.2b (2026-09-15): the third branch was "running" -- the in-progress
    // placeholder AgentRunner.createRun() itself inserts, never a valid
    // terminal AgentResult (confirmed live: left this run's own pil_agent_runs
    // row stuck at status='running' forever whenever stages were still
    // incomplete but nothing had failed). This run's own unit of work
    // (checking stage statuses, logging planner decisions) is complete
    // either way; overall multi-stage progress is tracked separately in
    // structured_plan/pil_research_runs, not this run's own terminal status.
    const status: AgentResult["status"] = allComplete ? "completed" : failedStage ? "replanning" : "completed";

    return {
      status,
      evidence: [],
      conclusions: {
        stageStatuses: effectiveStatuses.map((s) => ({ stage: s.stage.stage, agents: s.stage.agents, status: s.status })),
        decisions,
        allComplete,
      },
      delegations,
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts; recording it again here would double-count the same tokens.
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

  private isBudgetConstrained(budget: CostBudget | null): boolean {
    // Same pattern as BEN-SUP-04's isConstrained() (agents/sup/BEN-SUP-04.ts).
    if (!budget || budget.budget_limit_usd <= 0) return false;
    const spentPct = (budget.spent_usd / budget.budget_limit_usd) * 100;
    return spentPct >= budget.alert_threshold_pct;
  }

  // pil_agent_runs has no prospect_id column -- it's reached through
  // pil_research_runs.prospect_id (research_run_id FK), so this is a
  // two-step lookup: research runs for this org+prospect, then a
  // completed run of this exact agent against any of them, most recent
  // first, excluding the current research run (redundancy only makes
  // sense against a *different* run's completed work).
  private async findRedundantCompletedRun(
    orgId: string,
    prospectId: string,
    agentCode: string,
    currentResearchRunId: string,
  ): Promise<AgentRun | null> {
    const { data: runs, error: runsError } = await getPilClient()
      .from("pil_research_runs")
      .select("id")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId);
    if (runsError) throw runsError;

    const researchRunIds = ((runs ?? []) as { id: string }[])
      .map((r) => r.id)
      .filter((id) => id !== currentResearchRunId);
    if (researchRunIds.length === 0) return null;

    const { data, error } = await getPilClient()
      .from("pil_agent_runs")
      .select("*")
      .eq("organization_id", orgId)
      .eq("agent_id", agentCode)
      .eq("status", "completed")
      .in("research_run_id", researchRunIds);
    if (error) throw error;

    const windowStart = Date.now() - REDUNDANCY_WINDOW_MS;
    const fresh = ((data ?? []) as AgentRun[]).filter((r) => new Date(r.created_at).getTime() >= windowStart);
    if (fresh.length === 0) return null;
    return fresh.reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b));
  }

  private findOrphanedStage(
    statuses: StageStatusEntry[],
    tasks: AgentRun[],
  ): { stage: PlanStage; stuckAgents: string[]; oldestStartedAt: string } | null {
    const now = Date.now();
    for (const entry of statuses) {
      if (entry.status !== "in_progress") continue;

      const stuckAgents = entry.stage.agents.filter((agentCode) => {
        const s = statusOf(agentCode, tasks);
        return s !== null && s !== "completed" && s !== "failed";
      });
      if (stuckAgents.length === 0) continue;

      const startedAts = stuckAgents
        .map((agentCode) => latestRunFor(agentCode, tasks)?.started_at ?? null)
        .filter((s): s is string => s !== null);
      if (startedAts.length === 0) continue;

      const oldestStartedAt = startedAts.reduce((a, b) => (new Date(a) < new Date(b) ? a : b));
      if (now - new Date(oldestStartedAt).getTime() >= ORPHAN_STALENESS_MS) {
        return { stage: entry.stage, stuckAgents, oldestStartedAt };
      }
    }
    return null;
  }

  private async tryUseTool(context: AgentContext, runner: AgentRunner, tool: string, units: number): Promise<number> {
    if (!context.tools.includes(tool)) return 0;
    try {
      const rate = await pilBlendedTokenRateUsd();
      await runner.useTool(context, tool, { unitCost: rate, units, costType: "model_tokens", model: PIL_AGENT_MODEL });
      return units;
    } catch {
      return 0;
    }
  }
}

export default CrossAgentResearchPlanner;
