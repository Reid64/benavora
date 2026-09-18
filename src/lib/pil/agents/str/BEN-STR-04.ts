import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getEvents } from "@/lib/pil/monitoring";
import { createReviewItem } from "@/lib/pil/human-review";
import { logAction } from "@/lib/pil/audit";
import { CLAIM_TYPES_BY_DIMENSION, scoreDimension, scoreRelationshipStrength, scoreTimingFromMonitoring } from "@/lib/pil/agents/qlf/BEN-QLF-04";
import type { CultivationPlan, EvidenceItem, ProspectOpportunity } from "@/lib/pil/types";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";

// BEN-STR-04 -- Next-Best-Action Agent
// (pil_agent_registry, migration 155 line 115, FAMILY 6 -- STRATEGY &
// NEXT-BEST-ACTION). Mission: "Continuously determine the most valuable next
// action for each qualified opportunity." default_autonomy_level A3 -- the
// only STR agent above A2. human_boundary NULL. cadence "Continuous, per
// active pil_prospect_opportunities row."
//
// depends_on [BEN-STR-01, BEN-STR-03, BEN-QLF-04, BEN-QLF-05, BEN-SUP-05] --
// the only STR agent naming a BEN-SUP-* dependency; feeds: [] -- this is a
// genuine terminal leaf in the 47-agent fleet (no other agent names
// BEN-STR-04 as its own delegation target), so the only fork left in this
// run is its own selective BEN-SUP-05 critic delegation (see below).
//
// Correction to a generic assumption: BEN-QLF-05 (Timing & Readiness Agent)
// IS implemented and registered (src/lib/pil/agents/qlf/BEN-QLF-05.ts,
// agents/index.ts's AGENT_FACTORIES) -- it is not the missing dependency it
// might appear to be from the registry alone. This agent still reads
// opportunity.timing_status defensively as nullable (never throws on its
// absence) since a given opportunity row may simply predate a BEN-QLF-05 run
// for that prospect, not because the agent itself is missing.
//
// Dual-mode branching (context.prospectId present vs null): this codebase's
// only real precedent for that exact ternary is BEN-SUP-01.ts (lines ~95,
// 211-230: `context.prospectId ? await this.loadRunsForProspect(...) : []`
// and `context.prospectId ?? "(portfolio-level)"` in delegation objective
// strings), BEN-SUP-02.ts (lines ~149-150, 189: same shape, `prospect ?
// await this.loadProspect(...) : null` / `?? "(none)"`), and BEN-SUP-05.ts
// (lines ~98, 106-107: `context.prospectId ? await getEvidence(...) : []`).
// In every one of those three, the org-wide/absent branch is a simple empty
// fallback (`[]`/`null`) -- none of them loop over every org-wide row and
// produce one output per row. No agent anywhere in src/lib/pil/agents/
// implements that fuller "gate on missing prospectId, then sweep every open
// row" shape: BEN-REL-04.ts's own org-wide pass is unconditional every run
// (not gated on a missing prospectId at all); BEN-KNW-03.ts hard-requires a
// single prospectId with no batch mode; BEN-KNW-02.ts takes an explicit list
// via context.plan.prospectIds, not a null-prospectId trigger. This agent's
// own registry cadence ("Continuously determine the most valuable next
// action for each qualified opportunity") is what forces the richer
// behavior: the org-wide branch below doesn't just fall back to an empty
// result the way the three SUP agents' ternaries do -- it iterates every
// open pil_prospect_opportunities row and produces one recommendation each.
// This is new precedent for that specific full-loop shape in this codebase,
// not a copy of an existing generic "batch-sweep" pattern.
//
// MAX_BATCH_SIZE caps the org-wide sweep at 200 opportunities per run so one
// invocation on a very large org can't spike cost/latency unbounded;
// conclusions.batchCapped tells a caller to re-run for the remainder. The
// query below fetches MAX_BATCH_SIZE + 1 rows specifically so it can detect
// "more rows exist beyond the cap" from a single query, rather than issuing
// a separate count() query.
//
// Per-opportunity synthesis (same logic single-prospect or looped org-wide):
// engagement_strategy (BEN-STR-01), recommended_ask_low/high (BEN-STR-02),
// timing_status (BEN-QLF-05), classification/confidence (BEN-QLF-04) are all
// columns already on the pil_prospect_opportunities row itself -- no extra
// per-agent query is needed to read them. The one additional read is
// pil_cultivation_plans (BEN-STR-03's table), wrapped in try/catch below
// (findActiveCultivationPlan/isMissingTableError) so a missing-table/relation
// error is treated as "no active plan" rather than crashing -- this queue's
// prompts may not all have executed yet in every environment this agent
// could run in.
//
// Decision order (exact enum "solicit_now" | "cultivate" | "research_more" |
// "monitor" | "wait" | "escalate_human_review"; "wait" is reserved for the
// not-open/nonexistent-opportunity early return, never chosen by
// decideAction below):
//   1. engagement_strategy starts with "solicit:" AND both recommended_ask_low
//      and recommended_ask_high are set -> "solicit_now"
//   2. else engagement_strategy starts with "cultivate:" OR an active
//      pil_cultivation_plans row was found -> "cultivate"
//   3. else opportunity.classification === "research_more" -> "research_more"
//   4. else an actionable monitoring event exists (status 'new'/'reviewed',
//      exactly BEN-QLF-04.scoreTimingFromMonitoring's own filter, via
//      getEvents()) -> "escalate_human_review"
//   5. else -> "monitor" (the safe default)
//
// Expected Information/Value Gain: reuses BEN-QLF-04's exact
// scoredDimensions/coveredCount researchSufficiency formula (fraction of the
// 8 scorable dimensions with a nonzero score, times 100), recomputed here as
// a proxy for how much a further research pass could still add, via the
// same exported building blocks BEN-STR-01/02/03 already reuse
// (CLAIM_TYPES_BY_DIMENSION, scoreDimension, scoreRelationshipStrength,
// scoreTimingFromMonitoring) rather than re-deriving BEN-QLF-04's full
// sibling hand-off chain a second time.
//
// Risk: reapplies BEN-STR-01's own cold-solicitation check (candidateAction
// is "solicit_now" AND scoreRelationshipStrength(orgId, prospectId) -- the
// same pil_graph_edges relationship-path query BEN-STR-01/02/03 all reuse --
// returns 0) as a fresh safety net, since relationship conditions may have
// changed since BEN-STR-01 last ran for this prospect.
//
// Cost: a coarse ordinal ("low"/"medium"/"high") mapped from candidateAction
// -- solicit_now/escalate_human_review = "high"; cultivate/research_more =
// "medium"; monitor/wait = "low". A simple ordinal proxy, not a real
// dollar-cost model (none exists elsewhere in this codebase to build on).
//
// Policy/Human Gates: createReviewItem() fires whenever candidateAction is
// "solicit_now" (review_type "high_impact_action", priority "urgent") or
// "escalate_human_review" (same review_type, priority "high") -- this
// reinforces the H1 lineage BEN-STR-02 already establishes, in case
// BEN-STR-04 is invoked directly (single-prospect ad hoc mode) without
// BEN-STR-02 ever having run for this specific opportunity.
//
// Delegation: a BEN-SUP-05 critic delegation (maxAutonomy "A2" -- safely
// below this agent's own A3 registry ceiling; canDelegate() in policy.ts
// checks a requested maxAutonomy against the DELEGATING agent's own ceiling,
// not the child's) fires specifically when candidateAction is "solicit_now",
// matching the same selective-critic-delegation convention BEN-QLF-04 and
// BEN-STR-02 already use for their own highest-tier outputs. Since this
// agent is a genuine terminal leaf (feeds: []), this is the last fork in the
// whole STR chain.
//
// Return shape: conclusions.recommendation (singular object) in
// single-prospect mode; conclusions.recommendations (array) plus
// conclusions.batchCapped in org-wide mode -- callers should branch on
// array-ness (or on context.prospectId, which they already have) rather than
// assuming one shape.
//
// tokensUsed scales with opportunities processed (TOKENS_PER_OPPORTUNITY
// each) but is hard-capped at MAX_TOKENS_PER_RUN regardless of batch size, to
// avoid an unbounded cost spike on a large org. logAction fires once per
// opportunity processed (action "next_best_action.recommended", resource_type
// "pil_prospect_opportunities", resource_id the opportunity id).

const MAX_BATCH_SIZE = 200;
const MAX_TOKENS_PER_RUN = 5000;
const TOKENS_PER_OPPORTUNITY = 300;

export type NextBestAction = "solicit_now" | "cultivate" | "research_more" | "monitor" | "wait" | "escalate_human_review";
export type NextBestActionCost = "low" | "medium" | "high";

const COST_BY_ACTION: Record<NextBestAction, NextBestActionCost> = {
  solicit_now: "high",
  escalate_human_review: "high",
  cultivate: "medium",
  research_more: "medium",
  monitor: "low",
  wait: "low",
};

export interface NextBestActionRisk {
  flagged: boolean;
  reasons: string[];
}

export interface NextBestActionRecommendation {
  opportunityId: string;
  prospectId: string;
  action: NextBestAction;
  expectedValueGain: number;
  risk: NextBestActionRisk;
  cost: NextBestActionCost;
  reviewCreated: boolean;
}

function decideAction(opportunity: ProspectOpportunity, activePlan: CultivationPlan | null, actionableMonitoring: boolean): NextBestAction {
  const strategy = opportunity.engagement_strategy ?? "";
  const hasAskRange = opportunity.recommended_ask_low !== null && opportunity.recommended_ask_high !== null;
  if (strategy.startsWith("solicit:") && hasAskRange) return "solicit_now";
  if (strategy.startsWith("cultivate:") || activePlan !== null) return "cultivate";
  if (opportunity.classification === "research_more") return "research_more";
  if (actionableMonitoring) return "escalate_human_review";
  return "monitor";
}

// Recomputes BEN-QLF-04's exact scoredDimensions/coveredCount
// researchSufficiency formula (see this file's header) via BEN-QLF-04's own
// exported building blocks, rather than re-deriving its full sibling
// hand-off chain.
async function computeExpectedValueGain(orgId: string, prospectId: string, evidence: EvidenceItem[]): Promise<number> {
  const evidenceByClaimType = new Map<string, EvidenceItem[]>();
  for (const item of evidence) {
    const list = evidenceByClaimType.get(item.claim_type) ?? [];
    list.push(item);
    evidenceByClaimType.set(item.claim_type, list);
  }

  const dimensionScores: number[] = [];
  for (const dimension of Object.keys(CLAIM_TYPES_BY_DIMENSION) as Array<keyof typeof CLAIM_TYPES_BY_DIMENSION>) {
    const items = CLAIM_TYPES_BY_DIMENSION[dimension].flatMap((claimType) => evidenceByClaimType.get(claimType) ?? []);
    let score = scoreDimension(items);
    if (dimension === "timingReadiness") {
      score = Math.max(score, await scoreTimingFromMonitoring(orgId, prospectId));
    }
    dimensionScores.push(score);
  }
  dimensionScores.push(await scoreRelationshipStrength(orgId, prospectId));

  const coveredCount = dimensionScores.filter((score) => score > 0).length;
  return Math.round((coveredCount / dimensionScores.length) * 100);
}

async function assessRisk(orgId: string, prospectId: string, action: NextBestAction): Promise<NextBestActionRisk> {
  if (action !== "solicit_now") return { flagged: false, reasons: [] };
  const relationshipPathScore = await scoreRelationshipStrength(orgId, prospectId);
  if (relationshipPathScore === 0) {
    return {
      flagged: true,
      reasons: [
        `Candidate action "solicit_now" recommended with no relationship pathway on record (relationshipPathScore 0) -- cold solicitation risk, re-checked fresh by BEN-STR-04.`,
      ],
    };
  }
  return { flagged: false, reasons: [] };
}

function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code: unknown }).code) : "";
  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  return code === "42P01" || /relation .* does not exist/i.test(message) || /does not exist/i.test(message);
}

export class NextBestActionAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (context.prospectId) {
      return this.executeSingleProspect(context, context.prospectId, runner);
    }
    return this.executeOrgWide(context, runner);
  }

  private async executeSingleProspect(context: AgentContext, prospectId: string, runner: AgentRunner): Promise<AgentResult> {
    const opportunity = await this.findOpenOpportunity(context.orgId, prospectId);
    if (!opportunity) {
      return this.waitResult(prospectId);
    }

    const recommendation = await this.synthesizeRecommendation(context, opportunity);
    const delegations = this.delegationsFor(recommendation);
    const tokensUsed = await this.tryModelTokens(context, runner, this.tokenUnitsFor(1));

    return {
      status: "completed",
      evidence: [],
      conclusions: { recommendation },
      delegations,
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts; recording it again here would double-count the same tokens.
      error: null,
    };
  }

  private async executeOrgWide(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const { opportunities, batchCapped } = await this.findOpenOpportunitiesOrgWide(context.orgId);

    const recommendations: NextBestActionRecommendation[] = [];
    const delegations: DelegationRequest[] = [];
    for (const opportunity of opportunities) {
      const recommendation = await this.synthesizeRecommendation(context, opportunity);
      recommendations.push(recommendation);
      delegations.push(...this.delegationsFor(recommendation));
    }

    const tokensUsed = await this.tryModelTokens(context, runner, this.tokenUnitsFor(recommendations.length));

    return {
      status: "completed",
      evidence: [],
      conclusions: { recommendations, batchCapped },
      delegations,
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts; recording it again here would double-count the same tokens.
      error: null,
    };
  }

  // Shared by both modes -- see this file's header for the full per-field
  // rationale (Decision order / Expected Value Gain / Risk / Cost / Policy
  // gates).
  private async synthesizeRecommendation(context: AgentContext, opportunity: ProspectOpportunity): Promise<NextBestActionRecommendation> {
    const prospectId = opportunity.prospect_id;

    const evidence = await getEvidence(prospectId, context.orgId);
    const activePlan = await this.findActiveCultivationPlan(context.orgId, prospectId);
    const events = await getEvents(context.orgId, prospectId);
    const actionableMonitoring = events.some((e) => e.status === "new" || e.status === "reviewed");

    const action = decideAction(opportunity, activePlan, actionableMonitoring);
    const expectedValueGain = await computeExpectedValueGain(context.orgId, prospectId, evidence);
    const risk = await assessRisk(context.orgId, prospectId, action);
    const cost = COST_BY_ACTION[action];

    let reviewCreated = false;
    if (action === "solicit_now" || action === "escalate_human_review") {
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "high_impact_action",
        subject_type: "pil_prospect_opportunities",
        subject_id: opportunity.id,
        requested_by_agent_id: context.agentCode,
        priority: action === "solicit_now" ? "urgent" : "high",
        status: "pending",
        summary: `BEN-STR-04 recommends "${action}" for prospect ${prospectId} (opportunity ${opportunity.id}).`,
        evidence_refs: evidence.map((item) => item.id),
        assigned_to_user_id: null,
        resolved_at: null,
      });
      reviewCreated = true;
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "next_best_action.recommended",
      resource_type: "pil_prospect_opportunities",
      resource_id: opportunity.id,
      before_state: null,
      after_state: { action, expectedValueGain, risk, cost },
      policy_decision: null,
      ip_address: null,
    });

    return { opportunityId: opportunity.id, prospectId, action, expectedValueGain, risk, cost, reviewCreated };
  }

  private delegationsFor(recommendation: NextBestActionRecommendation): DelegationRequest[] {
    if (recommendation.action !== "solicit_now") return [];
    return [
      {
        childAgentCode: "BEN-SUP-05",
        objective: `Critic review for BEN-STR-04 "solicit_now" recommendation on prospect ${recommendation.prospectId} (opportunity ${recommendation.opportunityId})`,
        maxAutonomy: "A2",
        constraints: { prospectId: recommendation.prospectId, opportunityId: recommendation.opportunityId },
      },
    ];
  }

  private tokenUnitsFor(opportunitiesProcessed: number): number {
    return Math.min(MAX_TOKENS_PER_RUN, opportunitiesProcessed * TOKENS_PER_OPPORTUNITY);
  }

  private waitResult(prospectId: string): AgentResult {
    return {
      status: "completed",
      evidence: [],
      conclusions: {
        recommendation: {
          opportunityId: null,
          prospectId,
          action: "wait" as NextBestAction,
          expectedValueGain: 0,
          risk: { flagged: false, reasons: [] } satisfies NextBestActionRisk,
          cost: "low" as NextBestActionCost,
          reviewCreated: false,
        },
        reason: `No open pil_prospect_opportunities row exists for prospect ${prospectId}; nothing to act on yet.`,
      },
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: null,
    };
  }

  private async findOpenOpportunity(orgId: string, prospectId: string): Promise<ProspectOpportunity | null> {
    const { data, error } = await getPilClient()
      .from("pil_prospect_opportunities")
      .select("*")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .eq("status", "open")
      .maybeSingle();
    if (error) throw error;
    return (data as ProspectOpportunity | null) ?? null;
  }

  // Fetches MAX_BATCH_SIZE + 1 rows so "more rows exist beyond the cap" can
  // be detected from this single query, rather than a separate count() call.
  private async findOpenOpportunitiesOrgWide(orgId: string): Promise<{ opportunities: ProspectOpportunity[]; batchCapped: boolean }> {
    const { data, error } = await getPilClient()
      .from("pil_prospect_opportunities")
      .select("*")
      .eq("organization_id", orgId)
      .eq("status", "open")
      .limit(MAX_BATCH_SIZE + 1);
    if (error) throw error;
    const rows = (data ?? []) as ProspectOpportunity[];
    const batchCapped = rows.length > MAX_BATCH_SIZE;
    return { opportunities: batchCapped ? rows.slice(0, MAX_BATCH_SIZE) : rows, batchCapped };
  }

  // Wrapped per this file's header: a missing-table/relation error is
  // treated as "no active plan" rather than crashing, since this queue's
  // prompts may not all have executed yet in every environment this agent
  // could run in.
  private async findActiveCultivationPlan(orgId: string, prospectId: string): Promise<CultivationPlan | null> {
    try {
      const { data, error } = await getPilClient()
        .from("pil_cultivation_plans")
        .select("*")
        .eq("organization_id", orgId)
        .eq("prospect_id", prospectId)
        .eq("status", "active")
        .maybeSingle();
      if (error) {
        if (isMissingTableError(error)) return null;
        throw error;
      }
      return (data as CultivationPlan | null) ?? null;
    } catch (err) {
      if (isMissingTableError(err)) return null;
      throw err;
    }
  }

  private async tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
    if (units <= 0 || !context.tools.includes("T-MODEL")) return 0;
    try {
      const rate = await pilBlendedTokenRateUsd();
      await runner.useTool(context, "T-MODEL", { unitCost: rate, units, costType: "model_tokens", model: PIL_AGENT_MODEL });
      return units;
    } catch {
      return 0;
    }
  }
}

export default NextBestActionAgent;
