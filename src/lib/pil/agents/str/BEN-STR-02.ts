import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { createReviewItem } from "@/lib/pil/human-review";
import { logAction } from "@/lib/pil/audit";
import { CLAIM_TYPES_BY_DIMENSION, VERIFICATION_WEIGHT } from "@/lib/pil/agents/qlf/BEN-QLF-04";
import { scoreRelationshipStrength } from "@/lib/pil/agents/qlf/BEN-QLF-04";
import type { EvidenceItem, ProspectOpportunity } from "@/lib/pil/types";

// BEN-STR-02 -- Best First Ask Agent
// (pil_agent_registry, migration 155 line 113, FAMILY 6 -- STRATEGY &
// NEXT-BEST-ACTION). Mission: "Recommend an appropriate initial ask or
// engagement objective." default_autonomy_level A2. cadence "On demand."
// human_boundary (verbatim, the one non-NULL human_boundary among all 4 STR
// agents): "H1, final solicitation decision always remains human."
//
// depends_on [BEN-QLF-03, BEN-QLF-04, BEN-STR-01, BEN-KNW-03], feeds
// [BEN-STR-03, BEN-APP-01, BEN-APP-03] per PIL_AGENT_DEPENDENCIES.yaml -- the
// APP family is not built in this codebase yet and is ignored here, same
// treatment BEN-STR-01's header gives to its own not-yet-built dependents.
//
// givingCapacity/philanthropicPropensity/missionAffinity are scored directly
// from pil_evidence here via BEN-QLF-04's exact scoreDimension() formula
// (max*0.6 + avg*0.4 of clamped-confidence*VERIFICATION_WEIGHT, per matched
// evidence item), replicated inline below because scoreDimension() itself is
// a private OpportunityQualificationAgent method and cannot be imported --
// unlike scoreRelationshipStrength(), which BEN-QLF-04 already promoted to a
// standalone exported function specifically so sibling agents could reuse it
// (see BEN-QLF-04.ts's own header), and which this agent reuses directly for
// Relationship Stage below rather than re-deriving the pil_graph_edges query
// a second time. This is now the second file (after BEN-STR-01) to call
// scoreRelationshipStrength for this exact purpose; a shared
// src/lib/pil/agents/str/shared.ts module (mirroring src/lib/pil/agents/rel/
// shared.ts's real precedent) is deliberately NOT created yet -- with only
// two callers there is nothing to extract beyond a single already-exported
// function. If BEN-STR-03/04 also need this same relationship-strength read
// later in this queue, that third call site is the actual signal to extract
// a shared module.
//
// Ask Type / Amount-Range are this file's own defensible thresholds, in the
// DISQUALIFY_SCORE_THRESHOLD-style named-constant convention BEN-QLF-04
// established -- documented alongside each constant below, not invented ad
// hoc inline.
//
// H1 enforcement: unlike every other agent in this family (BEN-QLF-04's
// conditional, score-threshold-gated createReviewItem; BEN-STR-01's
// conditional, risk-flag-gated createReviewItem), this agent calls
// createReviewItem() UNCONDITIONALLY on every completed run, regardless of
// askType or score -- this agent only ever writes a *recommendation*, never
// anything indicating an ask was made, sent, or accepted, so every
// recommendation it produces must surface for human sign-off before any
// solicitation happens.

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;

// Ask Type thresholds (Roster "Ask Type" dimension). Major-gift asks require
// both strong capacity AND strong propensity; propensity without strong
// capacity signals suggests a legacy/planned vehicle (a future bequest or
// trust) rather than a large current-cash ask, hence planned_gift_ask;
// anything below both floors gets no dollar ask at all, just a
// relationship-building meeting.
const MAJOR_GIFT_CAPACITY_THRESHOLD = 70;
const MAJOR_GIFT_PROPENSITY_THRESHOLD = 70;
const ANNUAL_GIFT_CAPACITY_THRESHOLD = 40;
const PLANNED_GIFT_PROPENSITY_THRESHOLD = 40;

export type AskType = "major_gift_ask" | "annual_gift_ask" | "planned_gift_ask" | "discovery_meeting_request";

// Fixed fallback ladder (Roster "Fallback Asks" dimension) -- every entry
// after the primary askType's position, capped at 2 entries.
const ASK_TYPE_LADDER: AskType[] = ["major_gift_ask", "annual_gift_ask", "planned_gift_ask", "discovery_meeting_request"];
const MAX_FALLBACK_ASKS = 2;

// Amount/Range Rationale (Roster "Amount/Range Rationale" dimension):
// directional capacity-score-tier bands, NOT precise valuations -- a rough
// solicitation range for the human fundraiser to calibrate against, not a
// number to quote the prospect. Below the lowest tier there is no dollar
// figure at all (askType is discovery_meeting_request).
const ASK_AMOUNT_BANDS: Array<{ minCapacityScore: number; low: number; high: number }> = [
  { minCapacityScore: 90, low: 25_000, high: 100_000 },
  { minCapacityScore: 70, low: 10_000, high: 25_000 },
  { minCapacityScore: 40, low: 2_500, high: 10_000 },
];

export interface BestFirstAskReport {
  prospectId: string;
  opportunityId: string;
  askType: AskType;
  capacityScore: number;
  propensityScore: number;
  missionAffinityScore: number;
  recommendedAskLow: number | null;
  recommendedAskHigh: number | null;
  relationshipStage: number;
  fallbackAsks: AskType[];
  humanReviewCreated: boolean;
}

// Replicates BEN-QLF-04's scoreDimension() formula verbatim (that function is
// a private OpportunityQualificationAgent method and cannot be imported):
// max*0.6 + avg*0.4 of each matched evidence item's clamped-confidence *
// VERIFICATION_WEIGHT[verification_status].
function scoreDimension(items: EvidenceItem[]): number {
  if (items.length === 0) return 0;
  const weighted = items.map((i) => Math.max(0, Math.min(1, i.confidence)) * VERIFICATION_WEIGHT[i.verification_status]);
  const best = Math.max(...weighted);
  const avg = weighted.reduce((a, b) => a + b, 0) / weighted.length;
  return Math.round(Math.min(1, best * 0.6 + avg * 0.4) * 100);
}

function decideAskType(capacityScore: number, propensityScore: number): AskType {
  if (capacityScore >= MAJOR_GIFT_CAPACITY_THRESHOLD && propensityScore >= MAJOR_GIFT_PROPENSITY_THRESHOLD) {
    return "major_gift_ask";
  }
  if (capacityScore >= ANNUAL_GIFT_CAPACITY_THRESHOLD) {
    return "annual_gift_ask";
  }
  if (propensityScore >= PLANNED_GIFT_PROPENSITY_THRESHOLD && capacityScore < ANNUAL_GIFT_CAPACITY_THRESHOLD) {
    return "planned_gift_ask";
  }
  return "discovery_meeting_request";
}

function decideAskRange(capacityScore: number): { low: number | null; high: number | null } {
  const band = ASK_AMOUNT_BANDS.find((b) => capacityScore >= b.minCapacityScore);
  if (!band) return { low: null, high: null };
  return { low: band.low, high: band.high };
}

function decideFallbackAsks(askType: AskType): AskType[] {
  const primaryIndex = ASK_TYPE_LADDER.indexOf(askType);
  return ASK_TYPE_LADDER.slice(primaryIndex + 1, primaryIndex + 1 + MAX_FALLBACK_ASKS);
}

export class BestFirstAskAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completed({}, "BEN-STR-02 requires an existing prospectId");
    }

    const opportunity = await this.findOpportunity(context.orgId, context.prospectId);
    if (!opportunity) {
      return this.completed(
        {},
        `No pil_prospect_opportunities row exists yet for prospect ${context.prospectId}; BEN-QLF-04 must qualify this prospect before BEN-STR-02 can recommend an ask.`,
      );
    }

    const evidence = await getEvidence(context.prospectId, context.orgId);
    const evidenceByClaimType = new Map<string, EvidenceItem[]>();
    for (const item of evidence) {
      const list = evidenceByClaimType.get(item.claim_type) ?? [];
      list.push(item);
      evidenceByClaimType.set(item.claim_type, list);
    }
    const evidenceFor = (claimTypes: string[]): EvidenceItem[] => claimTypes.flatMap((claimType) => evidenceByClaimType.get(claimType) ?? []);

    const capacityEvidence = evidenceFor(CLAIM_TYPES_BY_DIMENSION.givingCapacity);
    const propensityEvidence = evidenceFor(CLAIM_TYPES_BY_DIMENSION.philanthropicPropensity);
    const missionAffinityEvidence = evidenceFor(CLAIM_TYPES_BY_DIMENSION.missionAffinity);

    const capacityScore = scoreDimension(capacityEvidence);
    const propensityScore = scoreDimension(propensityEvidence);
    const missionAffinityScore = scoreDimension(missionAffinityEvidence);

    const askType = decideAskType(capacityScore, propensityScore);
    const { low: recommendedAskLow, high: recommendedAskHigh } = decideAskRange(capacityScore);
    const fallbackAsks = decideFallbackAsks(askType);

    const relationshipStage = await scoreRelationshipStrength(context.orgId, context.prospectId);

    const updatedOpportunity = await this.updateAskRange(opportunity.id, recommendedAskLow, recommendedAskHigh);

    const evidenceRefs = [...capacityEvidence, ...propensityEvidence, ...missionAffinityEvidence].map((item) => item.id);

    // H1 enforcement -- unconditional, no threshold gate. Contrast with
    // BEN-QLF-04's createReviewItem, which only fires above a score/
    // classification threshold (see BEN-QLF-04.ts around its
    // DEFAULT_HUMAN_REVIEW_SCORE_THRESHOLD check): this agent's own
    // human_boundary (H1) means every recommendation it produces -- no
    // matter how low-confidence or low-stakes -- must reach a human before
    // any solicitation happens, so this call has no `if` around it.
    await createReviewItem({
      organization_id: context.orgId,
      review_type: "high_impact_action",
      subject_type: "pil_prospect_opportunities",
      subject_id: opportunity.id,
      requested_by_agent_id: context.agentCode,
      priority: askType === "major_gift_ask" ? "high" : "normal",
      status: "pending",
      summary: "BEN-STR-02 recommendation only -- H1, final solicitation decision always remains human.",
      evidence_refs: evidenceRefs,
      assigned_to_user_id: null,
      resolved_at: null,
    });

    const delegations: DelegationRequest[] = [];
    if (askType === "major_gift_ask") {
      delegations.push({
        childAgentCode: "BEN-SUP-05",
        objective: `Critic review for BEN-STR-02 "major_gift_ask" recommendation on prospect ${context.prospectId} (opportunity ${opportunity.id})`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId, opportunityId: opportunity.id },
      });
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "ask_recommendation.created",
      resource_type: "pil_prospect_opportunities",
      resource_id: opportunity.id,
      before_state: null,
      after_state: {
        askType,
        recommended_ask_low: recommendedAskLow,
        recommended_ask_high: recommendedAskHigh,
        fallbackAsks,
      },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, 350);

    const report: BestFirstAskReport = {
      prospectId: context.prospectId,
      opportunityId: updatedOpportunity.id,
      askType,
      capacityScore,
      propensityScore,
      missionAffinityScore,
      recommendedAskLow,
      recommendedAskHigh,
      relationshipStage,
      fallbackAsks,
      humanReviewCreated: true,
    };

    return {
      status: "completed",
      evidence: [],
      conclusions: { report },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private async findOpportunity(orgId: string, prospectId: string): Promise<ProspectOpportunity | null> {
    const { data, error } = await getPilClient()
      .from("pil_prospect_opportunities")
      .select("*")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .maybeSingle();
    if (error) throw error;
    return (data as ProspectOpportunity | null) ?? null;
  }

  // Update-only, per this agent's persistence contract -- BEN-QLF-04 owns
  // creating the pil_prospect_opportunities row; this agent only ever
  // updates recommended_ask_low/recommended_ask_high on an existing one
  // (findOpportunity above already early-returns if none exists). Never
  // touches engagement_strategy (BEN-STR-01's column) or
  // classification/status.
  private async updateAskRange(opportunityId: string, low: number | null, high: number | null): Promise<ProspectOpportunity> {
    const { data, error } = await getPilClient()
      .from("pil_prospect_opportunities")
      .update({ recommended_ask_low: low, recommended_ask_high: high, updated_at: new Date().toISOString() })
      .eq("id", opportunityId)
      .select("*")
      .single();
    if (error) throw error;
    return data as ProspectOpportunity;
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

  private completed(conclusions: Record<string, unknown>, reason: string): AgentResult {
    return {
      status: "completed",
      evidence: [],
      conclusions: { skipped: true, reason, ...conclusions },
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: null,
    };
  }
}

export default BestFirstAskAgent;
