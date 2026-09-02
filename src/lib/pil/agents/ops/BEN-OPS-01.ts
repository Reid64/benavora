import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { createReviewItem } from "@/lib/pil/human-review";
import { logAction } from "@/lib/pil/audit";
import type { AgentRun } from "@/lib/pil/types";

// BEN-OPS-01 -- Agent Fleet Performance & Learning Agent
// (supabase/migrations/155_pil_agent_registry.sql line 122, family
// operations_evaluation_learning -- the sole member of that family, closing
// it out at 1/1). "Continuously evaluate whether the Prospect Intelligence
// agent fleet is actually improving research outcomes and determine where
// behaviors, routing, tools, or research strategies should be adjusted."
//
// Autonomy note: the registry row's own comment explains the spec's real
// ceiling is a combined "A1/A2" (PIL_AGENT_COMPLETE_ROSTER.md /
// PIL_AGENT_DEPENDENCIES.yaml), but pil_agent_registry.default_autonomy_level
// only accepts a single enum value, so 'A1' is what is actually stored and
// enforced live by canDelegate() (policy.ts) against this agent's own
// delegations. Every delegation this agent issues therefore requests
// maxAutonomy "A1" -- requesting "A2" would make canDelegate() return false
// (AUTONOMY_ORDER["A2"] > AUTONOMY_ORDER["A1"]) and the whole AgentRunner.run()
// call would come back status "failed" the instant that delegation fired.
//
// Propose-only enforcement (human_boundary, quoted verbatim into every review
// summary below): "may recommend but may not independently increase
// autonomy, change security/privacy policy, modify canonical facts, remove
// safety controls, or rewrite production governance". This is the literal
// code-level version of that boundary -- this file's execute() and every
// private helper it calls never insert/update pil_agent_registry,
// pil_feature_flags, or pil_agent_runs. The only tables written here are
// pil_human_review_queue (via createReviewItem) and pil_audit_log (via
// logAction). No convenience "apply this recommendation" method is added.
//
// Delegation scope (PIL_AGENT_DEPENDENCIES.yaml): depends_on lists
// BEN-SUP-01/04/05/06 but the roster's own text explicitly omits BEN-SUP-02
// and BEN-SUP-03 from BEN-OPS-01's delegation set -- neither is delegated to
// here. "feeds: [BEN-SUP-03]" describes BEN-SUP-03 consuming this agent's
// *already-approved* output through a separate, later, governed channel
// ("BEN-OPS-01 proposals do not change production routing until governed
// deployment") -- not a same-run forward delegation, so no delegation to
// BEN-SUP-03 is issued either. The only delegation this file issues is to
// BEN-SUP-05 (independent critic review), and only for HIGH severity
// findings, per PIL_AGENT_DEPENDENCIES.yaml's "may never approve its own
// policy exception, autonomy increase, security exception, or consequential
// self-certification" -- the same self-certification invariant BEN-SUP-05
// exists fleet-wide to enforce (see BEN-SUP-07.ts's own SELF_APPROVAL_REVIEW_TYPES
// check, which would catch a self-approved finding from this agent if one
// ever slipped through).

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;

// A single agent_id's run volume must reach this size before it's compared
// against the fleet median cost or flagged as a failure-rate/cost outlier at
// all -- otherwise one expensive or unlucky one-off run for a low-volume
// agent could dominate the fleet median or falsely trip a threshold built
// for a meaningful sample. Deliberately excluded from both sides: low-volume
// agent_ids contribute nothing to fleetMedianCostUsd's calculation and can
// never themselves be flagged as HIGH failure-rate or MEDIUM cost-outlier
// (escalationCount flagging is the one exception -- see below).
const MIN_SAMPLE_SIZE_FOR_COST_COMPARISON = 5;

// failureRate > this, with runCount >= MIN_SAMPLE_SIZE_FOR_COST_COMPARISON,
// is a HIGH severity finding -- one in five runs failing over a meaningful
// sample window is a real fleet-health signal worth a human look.
const FAILURE_RATE_THRESHOLD = 0.2;

// avgCostUsd exceeding the fleet median by this multiple, with runCount >=
// MIN_SAMPLE_SIZE_FOR_COST_COMPARISON, is a MEDIUM severity finding -- 3x the
// rest of the fleet's per-run cost is disproportionate enough to warrant
// review without necessarily being a failure.
const COST_OUTLIER_MULTIPLIER = 3;

// escalationCount >= this in the evaluation window is a MEDIUM severity
// finding regardless of runCount -- unlike the two thresholds above, a
// single agent_id generating repeated escalations deserves a look even at
// low sample size, since each escalation already represents an agent
// exceeding its own authority (agent-runner.ts's depth<=0 => "escalated"
// path), not merely a routine failure.
const ESCALATION_COUNT_THRESHOLD = 3;

export type FleetPerformanceMode = "nightly" | "weekly";

export interface LearningProposal {
  agentCode: string;
  issue: string;
  recommendation: string;
  severity: "high" | "medium";
}

interface AgentRunAggregate {
  agentCode: string;
  runCount: number;
  failedCount: number;
  failureRate: number;
  totalCostUsd: number;
  avgCostUsd: number;
  totalTokens: number;
  avgTokens: number;
  escalationCount: number;
  mostRecentFailedRunId: string | null;
  mostRecentAnyRunId: string | null;
}

export class AgentFleetPerformanceAndLearningAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const mode = this.resolveMode(context.plan);
    const windowDays = mode === "weekly" ? 30 : 7;
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const runs = await this.loadRunsInWindow(context.orgId, windowStart);

    const runsByAgent = new Map<string, AgentRun[]>();
    for (const run of runs) {
      const list = runsByAgent.get(run.agent_id) ?? [];
      list.push(run);
      runsByAgent.set(run.agent_id, list);
    }

    const aggregates = new Map<string, AgentRunAggregate>();
    for (const [agentCode, agentRuns] of runsByAgent) {
      aggregates.set(agentCode, this.aggregate(agentCode, agentRuns));
    }

    // pil_agent_run_events has no organization_id column of its own -- scope
    // to this org's window by first collecting every run id already loaded
    // above, then filtering events by agent_run_id IN (that list). Querying
    // pil_agent_run_events.organization_id directly would hit a nonexistent
    // column.
    const allRunIds = runs.map((r) => r.id);
    if (allRunIds.length > 0) {
      const runIdToAgentCode = new Map(runs.map((r) => [r.id, r.agent_id]));
      const escalationEvents = await this.loadEscalationEvents(allRunIds);
      for (const event of escalationEvents) {
        const agentCode = runIdToAgentCode.get(event.agent_run_id);
        if (!agentCode) continue;
        const aggregate = aggregates.get(agentCode);
        if (aggregate) aggregate.escalationCount += 1;
      }
    }

    const eligibleForCostComparison = [...aggregates.values()].filter(
      (a) => a.runCount >= MIN_SAMPLE_SIZE_FOR_COST_COMPARISON,
    );
    const fleetMedianCostUsd = this.median(eligibleForCostComparison.map((a) => a.avgCostUsd));

    const proposals: LearningProposal[] = [];
    for (const aggregate of aggregates.values()) {
      const meetsSampleSize = aggregate.runCount >= MIN_SAMPLE_SIZE_FOR_COST_COMPARISON;
      const issues: string[] = [];
      let severity: "high" | "medium" | null = null;

      if (meetsSampleSize && aggregate.failureRate > FAILURE_RATE_THRESHOLD) {
        issues.push(
          `failureRate ${aggregate.failureRate.toFixed(2)} exceeds ${FAILURE_RATE_THRESHOLD.toFixed(2)} threshold over ${aggregate.runCount} runs`,
        );
        severity = "high";
      }

      if (meetsSampleSize && aggregate.avgCostUsd > fleetMedianCostUsd * COST_OUTLIER_MULTIPLIER) {
        issues.push(
          `avgCostUsd ${aggregate.avgCostUsd.toFixed(4)} exceeds ${COST_OUTLIER_MULTIPLIER}x the fleet median (${fleetMedianCostUsd.toFixed(4)}) over ${aggregate.runCount} runs`,
        );
        if (severity !== "high") severity = "medium";
      }

      if (aggregate.escalationCount >= ESCALATION_COUNT_THRESHOLD) {
        issues.push(`escalationCount ${aggregate.escalationCount} meets or exceeds ${ESCALATION_COUNT_THRESHOLD} in the window`);
        if (severity !== "high") severity = "medium";
      }

      if (severity && issues.length > 0) {
        proposals.push({
          agentCode: aggregate.agentCode,
          issue: issues.join("; "),
          recommendation: `Review ${aggregate.agentCode}'s recent runs for a common root cause before any routing or autonomy change.`,
          severity,
        });
      }
    }

    const delegations: DelegationRequest[] = [];
    for (const proposal of proposals) {
      const aggregate = aggregates.get(proposal.agentCode)!;
      const subjectId = aggregate.mostRecentFailedRunId ?? aggregate.mostRecentAnyRunId;
      if (!subjectId) continue; // no real run id to attach the review to -- should not happen, defensive only

      await createReviewItem({
        organization_id: context.orgId,
        review_type: "policy_exception",
        subject_type: "pil_agent_runs",
        subject_id: subjectId,
        requested_by_agent_id: context.agentCode,
        priority: proposal.severity === "high" ? "high" : "normal",
        status: "pending",
        summary: `${proposal.issue}. BEN-OPS-01 may recommend but may not independently increase autonomy, change security/privacy policy, modify canonical facts, remove safety controls, or rewrite production governance -- this finding requires human review before any change is made.`,
        evidence_refs: [],
        assigned_to_user_id: null,
        resolved_at: null,
      });

      if (proposal.severity === "high") {
        delegations.push({
          childAgentCode: "BEN-SUP-05",
          objective: `Independent critic review of BEN-OPS-01's fleet-performance finding for ${proposal.agentCode}: ${proposal.issue}`,
          maxAutonomy: "A1",
          constraints: { flaggedAgentCode: proposal.agentCode, mode },
        });
      }
    }

    const tokensUsed = await this.tryModelTokens(context, runner, 500);

    const agentsEvaluated = aggregates.size;
    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "fleet_performance.evaluated",
      resource_type: "pil_agent_registry",
      resource_id: context.runId,
      before_state: null,
      after_state: { mode, windowDays, agentsEvaluated, flaggedCount: proposals.length },
      policy_decision: null,
      ip_address: null,
    });

    return {
      status: "completed",
      evidence: [],
      conclusions: { mode, windowDays, agentsEvaluated, proposals, fleetMedianCostUsd },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private resolveMode(plan: Record<string, unknown>): FleetPerformanceMode {
    const requested = (plan as { mode?: unknown } | null)?.mode;
    return requested === "weekly" ? "weekly" : "nightly";
  }

  private aggregate(agentCode: string, runs: AgentRun[]): AgentRunAggregate {
    const runCount = runs.length;
    const failedCount = runs.filter((r) => r.status === "failed").length;
    const totalCostUsd = runs.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
    const totalTokens = runs.reduce((sum, r) => sum + (r.tokens_consumed ?? 0), 0);

    const sortedByCreatedAtDesc = [...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const mostRecentFailed = sortedByCreatedAtDesc.find((r) => r.status === "failed") ?? null;
    const mostRecentAny = sortedByCreatedAtDesc[0] ?? null;

    return {
      agentCode,
      runCount,
      failedCount,
      failureRate: runCount > 0 ? failedCount / runCount : 0,
      totalCostUsd,
      avgCostUsd: totalCostUsd / Math.max(runCount, 1),
      totalTokens,
      avgTokens: totalTokens / Math.max(runCount, 1),
      escalationCount: 0,
      mostRecentFailedRunId: mostRecentFailed?.id ?? null,
      mostRecentAnyRunId: mostRecentAny?.id ?? null,
    };
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
    return sorted[mid]!;
  }

  private async loadRunsInWindow(orgId: string, windowStart: string): Promise<AgentRun[]> {
    const { data, error } = await getPilClient()
      .from("pil_agent_runs")
      .select("*")
      .eq("organization_id", orgId)
      .gte("created_at", windowStart);
    if (error) throw error;
    return (data ?? []) as AgentRun[];
  }

  private async loadEscalationEvents(agentRunIds: string[]): Promise<Array<{ agent_run_id: string }>> {
    const { data, error } = await getPilClient()
      .from("pil_agent_run_events")
      .select("*")
      .in("agent_run_id", agentRunIds)
      .eq("event_type", "escalation");
    if (error) throw error;
    return (data ?? []) as Array<{ agent_run_id: string }>;
  }

  private async tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
    if (!context.tools.includes("T-MODEL")) return 0;
    try {
      await runner.useTool(context, "T-MODEL", { unitCost: MODEL_TOKEN_UNIT_COST_USD, units, costType: "model_tokens" });
      return units;
    } catch {
      return 0;
    }
  }
}

export default AgentFleetPerformanceAndLearningAgent;
