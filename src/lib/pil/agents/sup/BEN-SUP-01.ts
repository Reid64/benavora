import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { pilResearchRuns, pilProspects } from "@/lib/pil/db";
import { createResearchRun, advanceRunState } from "@/lib/pil/workflow";
import { logAction } from "@/lib/pil/audit";
import { createReviewItem } from "@/lib/pil/human-review";
import type { Prospect, ResearchRun } from "@/lib/pil/types";

// BEN-SUP-01 -- Chief Prospect Intelligence Orchestrator
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 1 -- SUPERVISORY & ORCHESTRATION").
// Owns the persistent prospect-intelligence objective for a tenant and
// coordinates the research fleet. Never scrapes sources itself -- it
// observes portfolio state, plans which agent families still owe research,
// dispatches pil_research_runs for the gaps, and delegates execution to
// BEN-SUP-02 (strategy) and the Discovery family entry point.

type ResearchFamily = "discovery" | "prospect_intelligence" | "relationship_intelligence" | "qualification";

const ALL_FAMILIES: ResearchFamily[] = [
  "discovery",
  "prospect_intelligence",
  "relationship_intelligence",
  "qualification",
];

const FAMILY_KEYWORDS: Record<ResearchFamily, string[]> = {
  discovery: ["find", "discover", "identify", "surface", "new prospect", "candidate"],
  prospect_intelligence: ["wealth", "capacity", "foundation", "corporate", "business", "dossier", "profile"],
  relationship_intelligence: ["relationship", "connection", "network", "board", "introduc", "warm path"],
  qualification: ["qualify", "qualification", "score", "rank", "prioritiz", "readiness"],
};

const STRATEGY_ARCHITECT_AGENT = "BEN-SUP-02";
const DISCOVERY_ENTRYPOINT_AGENT = "BEN-DIS-01";
const MODEL_TOKEN_UNIT_COST_USD = 0.00002;

// Discovery and qualification bracket every research objective (spec §6:
// every path starts by finding/confirming the entity and ends by qualifying
// it), so both are always required regardless of goal phrasing.
function classifyGoal(goal: string): ResearchFamily[] {
  const lower = goal.toLowerCase();
  const matched = new Set<ResearchFamily>(
    ALL_FAMILIES.filter((family) => FAMILY_KEYWORDS[family].some((keyword) => lower.includes(keyword))),
  );
  matched.add("discovery");
  matched.add("qualification");
  matched.add("prospect_intelligence");
  return Array.from(matched);
}

function familyOfRun(run: ResearchRun): ResearchFamily | null {
  const plan = run.structured_plan as { agent_family?: string; run_type?: string } | null;
  const family = plan?.agent_family ?? plan?.run_type ?? null;
  return (ALL_FAMILIES as string[]).includes(family ?? "") ? (family as ResearchFamily) : null;
}

function tallyStatuses(runs: ResearchRun[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const run of runs) counts[run.status] = (counts[run.status] ?? 0) + 1;
  return counts;
}

export class ChiefProspectIntelligenceOrchestrator implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    // 1. Observe current research state for the prospect.
    const priorRuns = context.prospectId ? await this.loadRunsForProspect(context.orgId, context.prospectId) : [];

    const completedFamilies = new Set(
      priorRuns.filter((r) => r.status === "completed").map(familyOfRun).filter((f): f is ResearchFamily => f !== null),
    );
    const activeFamilies = new Set(
      priorRuns
        .filter((r) => r.status === "planning" || r.status === "running")
        .map(familyOfRun)
        .filter((f): f is ResearchFamily => f !== null),
    );

    // 2. Assess what has been completed vs what the goal requires.
    const requiredFamilies = classifyGoal(context.goal);
    const gapFamilies = requiredFamilies.filter((f) => !completedFamilies.has(f) && !activeFamilies.has(f));

    // 3. Form the research plan.
    const plan = {
      requiredFamilies,
      completedFamilies: Array.from(completedFamilies),
      activeFamilies: Array.from(activeFamilies),
      gapFamilies,
    };
    await this.recordDecision(context, "orchestrator.plan_formed", { plan });

    const tokensUsed = await this.tryUseTool(context, runner, "T-MODEL", 200);

    // 4. Create and dispatch a pil_research_runs row per required agent
    // family that has no completed or in-flight coverage yet.
    const dispatchedRunIds: string[] = [];
    for (const family of gapFamilies) {
      const run = await createResearchRun({
        orgId: context.orgId,
        prospectId: context.prospectId,
        runType: family,
        goal: context.goal,
        triggeredBy: context.agentCode,
      });
      await advanceRunState(run.id, "running", { agent_family: family, dispatched_by: context.agentCode });
      dispatchedRunIds.push(run.id);
    }

    // 5. Monitor progress across all delegated runs for this prospect.
    const allRuns = context.prospectId ? await this.loadRunsForProspect(context.orgId, context.prospectId) : priorRuns;
    const statusCounts = tallyStatuses(allRuns);

    // 6. Evaluate aggregate results: the objective is satisfied only when
    // every required family already had completed coverage BEFORE this
    // cycle dispatched anything new.
    const objectiveSatisfied = gapFamilies.length === 0 && requiredFamilies.every((f) => completedFamilies.has(f));

    const conclusions: Record<string, unknown> = {
      plan,
      dispatchedRunIds,
      statusCounts,
      objectiveSatisfied,
    };

    await this.recordDecision(context, "orchestrator.evaluated", { objectiveSatisfied, statusCounts, dispatchedRunIds });

    // 7. Escalate consequential conclusions to a human.
    if (objectiveSatisfied && context.prospectId) {
      const prospect = await this.loadProspect(context.orgId, context.prospectId);
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "high_impact_action",
        subject_type: "pil_prospects",
        subject_id: context.prospectId,
        requested_by_agent_id: context.agentCode,
        priority: "normal",
        status: "pending",
        summary: `Research objective satisfied for prospect ${prospect?.display_name ?? context.prospectId}: all required agent families (${requiredFamilies.join(", ")}) completed.`,
        evidence_refs: [],
        assigned_to_user_id: null,
        resolved_at: null,
      });
      conclusions.humanReviewCreated = true;
    }

    // Delegate to the Strategy Architect (and the Discovery entry point when
    // discovery itself is a gap) whenever there is unmet research need.
    const delegations: DelegationRequest[] = [];
    if (!objectiveSatisfied) {
      delegations.push({
        childAgentCode: STRATEGY_ARCHITECT_AGENT,
        objective: `Formalize a research strategy for prospect ${context.prospectId ?? "(portfolio-level)"}: goal="${context.goal}"; gaps=${gapFamilies.join(",") || "none"}`,
        maxAutonomy: "A2",
      });
      if (gapFamilies.includes("discovery")) {
        delegations.push({
          childAgentCode: DISCOVERY_ENTRYPOINT_AGENT,
          objective: `Discover candidate prospects matching goal="${context.goal}"`,
          maxAutonomy: "A2",
        });
      }
    }

    return {
      status: objectiveSatisfied ? "completed" : "running",
      evidence: [],
      conclusions,
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private async loadRunsForProspect(orgId: string, prospectId: string): Promise<ResearchRun[]> {
    const { data, error } = await pilResearchRuns(orgId).eq("prospect_id", prospectId);
    if (error) throw error;
    return (data ?? []) as ResearchRun[];
  }

  private async loadProspect(orgId: string, prospectId: string): Promise<Prospect | null> {
    const { data, error } = await pilProspects(orgId).eq("id", prospectId).maybeSingle();
    if (error) throw error;
    return (data as Prospect | null) ?? null;
  }

  private async recordDecision(context: AgentContext, action: string, state: Record<string, unknown>): Promise<void> {
    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action,
      resource_type: "pil_research_runs",
      resource_id: context.runId,
      before_state: null,
      after_state: state,
      policy_decision: null,
      ip_address: null,
    });
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

export default ChiefProspectIntelligenceOrchestrator;
