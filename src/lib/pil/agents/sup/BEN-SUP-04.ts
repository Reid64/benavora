import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getActiveRuns } from "@/lib/pil/workflow";
import { getBudgetSummary } from "@/lib/pil/cost";
import { getAuditTrail, logAction } from "@/lib/pil/audit";
import { createReviewItem } from "@/lib/pil/human-review";
import type { AgentRun, CostBudget, EvidenceItem, ResearchRun } from "@/lib/pil/types";
import { serializePilError } from "@/lib/pil/serialize-error";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";

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
//
// PIL_AGENT_COMPLETE_ROSTER.md and PIL_AGENT_DEPENDENCIES.yaml (cited by the
// task that commissioned this extension) exist nowhere in this repo -- the
// only real spec for this agent is PROSPECT_INTELLIGENCE_AGENTS.md's
// BEN-SUP-04 section above, whose "Failure criteria" already calls for no
// candidate to "receive unbounded investigation" and for low-value
// candidates not to keep consuming budget without being suspended. The
// starvation/depth-ceiling guards and typed error prefixes below implement
// that intent directly; there is no richer document to reconcile against.
//
// Starvation guard: this agent has no pil_agent_run_events table to read
// (grepped -- doesn't exist anywhere in the schema). Its own prior
// pause/reallocate decisions are already durably recorded the same way
// every other decision here is -- as `allocator.pause` / `allocator.
// reallocate` rows in pil_audit_log (audit.ts) keyed by resource_type
// "pil_research_runs" / resource_id = run.id -- so getAuditTrail() against
// that same table/columns is the real prior-decision history, not a new
// table.

const LOW_YIELD_STEP_THRESHOLD = 5;
const LOW_YIELD_VALUE_THRESHOLD = 0.2;

// A run paused this many times inside the lookback window with no
// intervening `allocator.reallocate` targeting it is a starvation pattern:
// this agent stops pausing it and escalates to a human instead of pausing
// it again.
const STARVATION_LOOKBACK_HOURS = 24;
const STARVATION_PAUSE_LIMIT = 3;

// PROSPECT_INTELLIGENCE_AGENTS.md's own worked example puts even a
// high-value major-donor prospect at 15-25 total agent invocations; past
// that, further "deepen research" delegations on the same run stop
// compounding value. RESEARCH_DEPTH_CEILING caps totalSteps before this
// agent will push another deepening delegation on a run.
const RESEARCH_DEPTH_CEILING = 20;

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
    if (!context.orgId) {
      return this.inputInvalid("BEN-SUP-04 requires context.orgId");
    }

    // 1. Load all active research runs for the org.
    const activeRuns = await getActiveRuns(context.orgId);

    // 2. Load budget state. A query failure here is a materially different
    // condition from "org legitimately has no budget row configured" --
    // isConstrained(null) already treats the latter as unconstrained by
    // design, so a thrown error must not silently fall through to that same
    // path and get treated as "no constraint".
    let budgets: CostBudget[];
    try {
      budgets = await getBudgetSummary(context.orgId);
    } catch (err) {
      return this.estimatorUnavailable(serializePilError(err));
    }
    const orgBudget = budgets.find((b) => b.scope_type === "org" && b.scope_id === context.orgId) ?? null;

    const runIds = activeRuns.map((r) => r.id);
    const prospectIds = Array.from(new Set(activeRuns.map((r) => r.prospect_id).filter((id): id is string => id !== null)));

    const agentRuns = runIds.length > 0 ? await this.loadAgentRuns(context.orgId, runIds) : [];

    // Corrupted/ambiguous allocation input: do not let a failed evidence
    // load silently default to an empty map and score every run as if it
    // had zero evidence -- that would produce confidently wrong
    // pause/reallocate decisions. Route to BEN-SUP-06 (Research Recovery
    // Investigator) and skip allocation entirely this cycle instead.
    let evidenceByProspect: Map<string, EvidenceItem[]>;
    try {
      evidenceByProspect =
        prospectIds.length > 0 ? await this.loadEvidenceByProspect(context.orgId, prospectIds) : new Map<string, EvidenceItem[]>();
    } catch (err) {
      const message = serializePilError(err);
      return {
        status: "completed",
        evidence: [],
        conclusions: { allocationSkippedThisCycle: true, reason: message, failedProspectIds: prospectIds },
        delegations: [
          {
            childAgentCode: "BEN-SUP-06",
            objective: `Corrupted allocation input for BEN-SUP-04: evidence load failed for prospect(s) ${prospectIds.join(", ")} -- ${message}`,
            maxAutonomy: "A2",
          },
        ],
        tokensUsed: 0,
        costUsd: 0,
        error: null,
      };
    }

    // 3. Score each active run by expected fundraising intelligence value.
    const scored = activeRuns.map((run) => scoreRun(run, agentRuns, evidenceByProspect));

    const tokensUsed = await this.tryUseTool(context, runner, "T-COST", 20);

    const decisions: Record<string, unknown>[] = [];
    const delegations: DelegationRequest[] = [];

    // 4. When budget is constrained: pause the lowest-value run and
    // reallocate by deepening research on the highest-value one -- guarded
    // against starvation (repeatedly pausing the same run) and unlimited
    // investigation (repeatedly deepening the same run past a depth
    // ceiling).
    const constrained = this.isConstrained(orgBudget);
    if (constrained && scored.length > 0) {
      const ranked = [...scored].sort((a, b) => a.value - b.value);
      const lowest = ranked[0];
      const highest = ranked[ranked.length - 1];

      if (lowest && highest) {
        const priorPauses = await this.countConsecutivePauses(context.orgId, lowest.run.id);
        if (priorPauses >= STARVATION_PAUSE_LIMIT) {
          await createReviewItem({
            organization_id: context.orgId,
            review_type: "critic_block",
            subject_type: "pil_research_runs",
            subject_id: lowest.run.id,
            requested_by_agent_id: context.agentCode,
            priority: "normal",
            status: "pending",
            summary: `Prospect ${lowest.run.prospect_id ?? lowest.run.id} has been paused ${priorPauses} times in the last ${STARVATION_LOOKBACK_HOURS}h without an intervening reallocation -- starvation pattern detected. Recommend a human decide whether to terminate or protect this prospect's research.`,
            evidence_refs: [],
            assigned_to_user_id: null,
            resolved_at: null,
          });
          decisions.push({ action: "starvation_flagged", runId: lowest.run.id, prospectId: lowest.run.prospect_id, value: lowest.value });
        } else {
          await this.pauseRun(lowest.run);
          decisions.push({ action: "pause", runId: lowest.run.id, prospectId: lowest.run.prospect_id, value: lowest.value });
        }

        if (highest.run.id !== lowest.run.id) {
          if (highest.totalSteps >= RESEARCH_DEPTH_CEILING) {
            delegations.push({
              childAgentCode: "BEN-SUP-05",
              objective: `Independent critic review of research sufficiency for prospect ${highest.run.prospect_id} -- already at the research-depth ceiling`,
              maxAutonomy: "A2",
            });
            decisions.push({ action: "depth_ceiling_reached", runId: highest.run.id, prospectId: highest.run.prospect_id, value: highest.value });
          } else {
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
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts; recording it again here would double-count the same tokens.
      error: null,
    };
  }

  private isConstrained(budget: CostBudget | null): boolean {
    if (!budget || budget.budget_limit_usd <= 0) return false;
    const spentPct = (budget.spent_usd / budget.budget_limit_usd) * 100;
    return spentPct >= budget.alert_threshold_pct;
  }

  // Counts how many `allocator.pause` decisions this agent has logged
  // against this exact run within STARVATION_LOOKBACK_HOURS, resetting the
  // count whenever an `allocator.reallocate` targeting the same run
  // intervenes -- that reallocation is proof the run wasn't simply starved,
  // so only a consecutive run of pauses since the last reallocation counts
  // toward the starvation limit.
  private async countConsecutivePauses(orgId: string, runId: string): Promise<number> {
    const trail = await getAuditTrail(orgId, "pil_research_runs", runId);
    const cutoffMs = Date.now() - STARVATION_LOOKBACK_HOURS * 60 * 60 * 1000;
    let count = 0;
    for (const entry of trail) {
      if (new Date(entry.created_at).getTime() < cutoffMs) continue;
      if (entry.action === "allocator.pause") count++;
      else if (entry.action === "allocator.reallocate") count = 0;
    }
    return count;
  }

  private inputInvalid(message: string): AgentResult {
    return {
      status: "failed",
      evidence: [],
      conclusions: {},
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: `INPUT_INVALID: ${message}`,
    };
  }

  private estimatorUnavailable(message: string): AgentResult {
    return {
      status: "failed",
      evidence: [],
      conclusions: {},
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: `ESTIMATOR_UNAVAILABLE: ${message}`,
    };
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
      const rate = await pilBlendedTokenRateUsd();
      await runner.useTool(context, tool, { unitCost: rate, units, costType: "model_tokens", model: PIL_AGENT_MODEL });
      return units;
    } catch {
      return 0;
    }
  }
}

export default ResearchPortfolioAllocator;
