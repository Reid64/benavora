import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getActiveRuns } from "@/lib/pil/workflow";
import { getBudgetSummary } from "@/lib/pil/cost";
import { logAction } from "@/lib/pil/audit";
import { createReviewItem } from "@/lib/pil/human-review";
import type { AgentRun, CostBudget, EvidenceItem, ResearchRun } from "@/lib/pil/types";

// BEN-SUP-04 -- Research Portfolio Allocator
// (PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 1 -- SUPERVISORY & ORCHESTRATION").
// Allocates research resources toward the prospects with the highest
// expected fundraising intelligence value. The applied schema has no
// pil_research_goals table and ResearchRunStatus has no "paused" member (see
// workflow.ts) -- pausing a run is therefore represented the same way
// workflow.ts already folds planning parameters into structured_plan: a
// direct metadata-only update (no status transition) that flags
// `paused: true`, since there is no reversible status this agent could
// transition a run through and back.

const LOW_YIELD_STEP_THRESHOLD = 5;
const LOW_YIELD_VALUE_THRESHOLD = 0.2;

interface RunScore {
  run: ResearchRun;
  value: number;
  depthAchieved: number;
  totalSteps: number;
  proximityToGoal: number;
  prospectScore: number;
}

function scoreRun(run: ResearchRun, agentRuns: AgentRun[], evidenceByProspect: Map<string, EvidenceItem[]>): RunScore {
  const runTasks = agentRuns.filter((t) => t.research_run_id === run.id);
  const completed = runTasks.filter((t) => t.status === "completed").length;
  const proximityToGoal = runTasks.length > 0 ? completed / runTasks.length : 0;

  const evidence = run.prospect_id ? (evidenceByProspect.get(run.prospect_id) ?? []) : [];
  const prospectScore = evidence.length > 0 ? evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length : 0;

  const depthAchieved = completed;
  const depthNormalized = Math.min(depthAchieved / 5, 1);

  const value = Number((0.4 * prospectScore + 0.4 * proximityToGoal + 0.2 * depthNormalized).toFixed(3));

  return { run, value, depthAchieved, totalSteps: runTasks.length, proximityToGoal, prospectScore };
}

export class ResearchPortfolioAllocator implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    // 1. Load all active research runs for the org.
    const activeRuns = await getActiveRuns(context.orgId);

    // 2. Load budget state.
    const budgets = await getBudgetSummary(context.orgId);
    const orgBudget = budgets.find((b) => b.scope_type === "org" && b.scope_id === context.orgId) ?? null;

    const runIds = activeRuns.map((r) => r.id);
    const prospectIds = Array.from(new Set(activeRuns.map((r) => r.prospect_id).filter((id): id is string => id !== null)));

    const agentRuns = runIds.length > 0 ? await this.loadAgentRuns(context.orgId, runIds) : [];
    const evidenceByProspect = prospectIds.length > 0 ? await this.loadEvidenceByProspect(context.orgId, prospectIds) : new Map<string, EvidenceItem[]>();

    // 3. Score each active run by expected fundraising intelligence value.
    const scored = activeRuns.map((run) => scoreRun(run, agentRuns, evidenceByProspect));

    const tokensUsed = await this.tryUseTool(context, runner, "T-COST", 20);

    const decisions: Record<string, unknown>[] = [];
    const delegations: DelegationRequest[] = [];

    // 4. When budget is constrained: pause the lowest-value run and
    // reallocate by deepening research on the highest-value one.
    const constrained = this.isConstrained(orgBudget);
    if (constrained && scored.length > 0) {
      const ranked = [...scored].sort((a, b) => a.value - b.value);
      const lowest = ranked[0];
      const highest = ranked[ranked.length - 1];

      if (lowest && highest) {
        await this.pauseRun(lowest.run);
        decisions.push({ action: "pause", runId: lowest.run.id, prospectId: lowest.run.prospect_id, value: lowest.value });

        if (highest.run.id !== lowest.run.id) {
          const representative = agentRuns
            .filter((t) => t.research_run_id === highest.run.id)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
          if (representative) {
            delegations.push({
              childAgentCode: representative.agent_id,
              objective: `Increase research depth on prospect ${highest.run.prospect_id ?? highest.run.id} -- highest marginal value in this portfolio rebalance`,
              maxAutonomy: "A2",
            });
          }
          decisions.push({ action: "reallocate", runId: highest.run.id, prospectId: highest.run.prospect_id, value: highest.value });
        }
      }
    }

    // 5. Flag prospects showing low research yield after enough steps.
    const lowYield = scored.filter((s) => s.depthAchieved >= LOW_YIELD_STEP_THRESHOLD && s.value < LOW_YIELD_VALUE_THRESHOLD);
    for (const candidate of lowYield) {
      if (candidate.run.prospect_id) {
        await createReviewItem({
          organization_id: context.orgId,
          review_type: "critic_block",
          subject_type: "pil_research_runs",
          subject_id: candidate.run.id,
          requested_by_agent_id: context.agentCode,
          priority: "normal",
          status: "pending",
          summary: `Low research yield on prospect ${candidate.run.prospect_id}: value ${candidate.value} after ${candidate.depthAchieved} completed steps. Recommend termination review.`,
          evidence_refs: [],
          assigned_to_user_id: null,
          resolved_at: null,
        });
      }
      decisions.push({ action: "flag_low_yield", runId: candidate.run.id, prospectId: candidate.run.prospect_id, value: candidate.value });
    }

    // 6. Record every allocation decision.
    for (const decision of decisions) {
      await logAction({
        organization_id: context.orgId,
        actor_type: "agent",
        actor_id: context.agentCode,
        action: `allocator.${decision.action}`,
        resource_type: "pil_research_runs",
        resource_id: String(decision.runId ?? context.runId),
        before_state: null,
        after_state: decision,
        policy_decision: null,
        ip_address: null,
      });
    }

    return {
      status: "completed",
      evidence: [],
      conclusions: {
        scored: scored.map((s) => ({ runId: s.run.id, prospectId: s.run.prospect_id, value: s.value, depthAchieved: s.depthAchieved, proximityToGoal: s.proximityToGoal, prospectScore: s.prospectScore })),
        constrained,
        decisions,
      },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * 0.00002,
      error: null,
    };
  }

  private isConstrained(budget: CostBudget | null): boolean {
    if (!budget || budget.budget_limit_usd <= 0) return false;
    const spentPct = (budget.spent_usd / budget.budget_limit_usd) * 100;
    return spentPct >= budget.alert_threshold_pct;
  }

  private async pauseRun(run: ResearchRun): Promise<void> {
    const { error } = await getPilClient()
      .from("pil_research_runs")
      .update({ structured_plan: { ...run.structured_plan, paused: true, priority: "low" } })
      .eq("id", run.id);
    if (error) throw error;
  }

  private async loadAgentRuns(orgId: string, researchRunIds: string[]): Promise<AgentRun[]> {
    const { data, error } = await getPilClient()
      .from("pil_agent_runs")
      .select("*")
      .eq("organization_id", orgId)
      .in("research_run_id", researchRunIds);
    if (error) throw error;
    return (data ?? []) as AgentRun[];
  }

  private async loadEvidenceByProspect(orgId: string, prospectIds: string[]): Promise<Map<string, EvidenceItem[]>> {
    const { data, error } = await getPilClient()
      .from("pil_evidence")
      .select("*")
      .eq("organization_id", orgId)
      .eq("entity_table", "pil_prospects")
      .in("entity_id", prospectIds);
    if (error) throw error;
    const rows = (data ?? []) as EvidenceItem[];
    const byProspect = new Map<string, EvidenceItem[]>();
    for (const row of rows) {
      const list = byProspect.get(row.entity_id) ?? [];
      list.push(row);
      byProspect.set(row.entity_id, list);
    }
    return byProspect;
  }

  private async tryUseTool(context: AgentContext, runner: AgentRunner, tool: string, units: number): Promise<number> {
    if (!context.tools.includes(tool)) return 0;
    try {
      await runner.useTool(context, tool, { unitCost: 0.00002, units, costType: "model_tokens" });
      return units;
    } catch {
      return 0;
    }
  }
}

export default ResearchPortfolioAllocator;
