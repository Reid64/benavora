import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { logAction } from "@/lib/pil/audit";
import { CLAIM_TYPES_BY_DIMENSION, scoreDimension, VERIFICATION_WEIGHT } from "@/lib/pil/agents/qlf/BEN-QLF-04";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";
import type {
  CapacityPropensityAssessment,
  EvidenceItem,
  Prospect,
  ProspectOpportunity,
} from "@/lib/pil/types";

// BEN-QLF-03 -- Philanthropic Capacity & Propensity Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~784, FAMILY 5 -- QUALIFICATION &
// DECISION INTELLIGENCE). Mission (pil_agent_registry, migration 155):
// "Combine capacity and behavior evidence without conflating them." Default
// autonomy A2. Cadence: "On demand, once capacity (BEN-INT-08) and giving
// history (BEN-INT-07) are available."
//
// Hard constraint (spec's planning/observation behavior + explicit failure
// criterion "Capacity and propensity are blended into an unexplained single
// score with no dimensional breakdown"): capacity and propensity are two
// separately calibrated outputs everywhere in this file and in the
// persisted row -- never averaged or blended into one number. Every field
// below is grouped and commented as either a capacity concern (wealth-
// derived, sourced only from BEN-INT-08 evidence) or a propensity concern
// (behavior-derived, sourced only from BEN-INT-07 evidence); cause relevance
// and uncertainty notes are shared supporting context, not a third blended
// score.
//
// No PIL_AGENT_DEPENDENCIES.yaml exists anywhere in this repo (grepped) --
// this file's real upstream evidence contract is instead read directly from
// BEN-INT-07.ts/BEN-INT-08.ts/BEN-INT-09.ts's own recordIntelligenceEvidence
// calls, matching this codebase's established "read the real writer, don't
// invent a claim_type" convention (see BEN-QLF-04's own header):
//
//   - BEN-INT-08 (Wealth & Capacity Intelligence) writes claim_type
//     "wealth_capacity" with evidence.value shaped
//     `{ wealth: {low,high}, liquidity, philanthropicCapacity: {low,high},
//     propensity, uncertainties, wealthIndicatorSources }`. philanthropicCapacity
//     -- not the raw wealth range -- is BEN-INT-08's own giving-capacity-scoped
//     estimate, so this agent's capacityEstimateLow/High reads that field
//     directly rather than re-deriving a capacity range from raw wealth.
//     BEN-DIS-02/BEN-DIS-08 additionally write capacity_signal/
//     hidden_capacity_signal_flag/high_compensation_officer_signal with a
//     bare `{title,url}` or `{compensation}` shape -- no numeric wealth
//     range -- so those only ever contribute to capacityConfidence's
//     evidence-weight blend, never to the numeric range itself.
//   - BEN-INT-07 (Giving History Intelligence) writes claim_type
//     "giving_history" with two real shapes: a press/web mention
//     `{ text, url }` (dollar figure, if any, embedded in the sibling
//     top-level `claim` string) and a foundation-trusteeship 990 rollup
//     `{ foundationLabel, ein, totalGrantsPaid, filingYear }` (a real numeric
//     amount and year). BEN-DIS-02 additionally writes "documented_major_gift"
//     with `{ title, url, publishedAt }`. Neither shape carries a distinct
//     giving-vehicle field (donor_advised_fund/direct_gift/foundation_grant
//     etc.) anywhere in this codebase -- grepped every INT/DIS agent file --
//     so vehicleUse is an honestly empty array with a documented reason
//     (giving_pattern_summary/uncertaintyNotes both note this) rather than an
//     invented taxonomy, mirroring BEN-QLF-01's own populationAlignmentScore
//     precedent for a dimension the schema has no evidence taxonomy for yet.
//   - BEN-INT-09 (Wealth Origin & Liquidity Event) writes claim_type
//     "liquidity_event" -- reused here only as a delegation-gap check
//     (BEN-QLF-04's own CLAIM_TYPES_BY_DIMENSION.timingReadiness claim-type
//     list), not as a scored dimension of this agent's own output.
//
// Private-company valuation uncertainty (task requirement, matching
// BEN-INT-03's own documented "Private-Company Uncertainty" dimension):
// BEN-INT-03 (Business Ownership Intelligence) never gets EDGAR/filing
// corroboration for an ownership stake (its own header: "filing-backed
// corroboration is therefore never available here"), so a "business_ownership"
// evidence row with source_type other than "sec_edgar" is this codebase's
// existing signal for an unfiled/private-company ownership claim.
// uncertaintyNotes calls this out by name whenever contributing capacity
// evidence exists alongside such a claim.
//
// Delegation (spec has "Delegation permissions: none" for THIS agent's own
// capacity/propensity determination, but -- mirroring BEN-QLF-01's identical
// documented precedent -- the commissioning task additionally specifies real
// upstream-evidence-gap delegations distinct from that no-self-certification
// rule): pushes to whichever of BEN-INT-07/BEN-INT-08/BEN-INT-09 has zero
// contributing evidence for this prospect, and to BEN-KNW-03 for evidence-
// quality verification when either capacityConfidence or propensityConfidence
// falls below 0.6.
//
// Cause relevance: reads BEN-QLF-01's persisted pil_mission_affinity_
// assessments.cause_alignment_score directly when a row computed within the
// last 30 days exists for this prospect; otherwise falls back to a direct
// scoreDimension() over the same three cause-alignment claim types BEN-QLF-01
// uses (the first three entries of BEN-QLF-04's own
// CLAIM_TYPES_BY_DIMENSION.missionAffinity) rather than duplicating BEN-QLF-01's
// full scoring logic (recency decay, counterevidence penalty, etc.).

const LOW_CONFIDENCE_DELEGATION_THRESHOLD = 0.6;
const CAUSE_ASSESSMENT_FRESHNESS_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const POINT_ESTIMATE_RANGE_PCT = 0.25;

interface GiftEvent {
  amount: number;
  date: string;
}

export interface GiftMagnitudePattern {
  count: number;
  medianAmount: number | null;
  trend: "increasing" | "decreasing" | "flat" | "insufficient_data";
}

export interface CapacityPropensityReport {
  prospectId: string;
  // Capacity dimension -- wealth-derived, BEN-INT-08 evidence only.
  capacityEstimateLow: number | null;
  capacityEstimateHigh: number | null;
  capacityConfidence: number;
  // Propensity dimension -- behavior-derived, BEN-INT-07 evidence only.
  propensityScore: number;
  propensityConfidence: number;
  giftMagnitudePattern: GiftMagnitudePattern;
  vehicleUse: string[];
  // Shared supporting context -- not a third blended score.
  causeRelevanceScore: number;
  causeRelevanceSource: "fresh_mission_affinity_assessment" | "direct_fallback";
  uncertaintyNotes: string | null;
  evidenceRefs: string[];
  delegatedToInt07: boolean;
  delegatedToInt08: boolean;
  delegatedToInt09: boolean;
  delegatedToKnw03: boolean;
}

function weightedConfidence(item: EvidenceItem): number {
  return Math.max(0, Math.min(1, item.confidence)) * VERIFICATION_WEIGHT[item.verification_status];
}

function averageWeightedConfidence(items: EvidenceItem[]): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, item) => sum + weightedConfidence(item), 0) / items.length;
}

/** Extracts a dollar figure from a claim's structured value or, failing that, its free-text claim string (e.g. "$1.2 million"). Never fabricates an amount when neither source has one. */
function parseDollarAmount(text: string): number | null {
  const match = text.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(million|thousand|billion|k|m|b)?/i);
  if (!match) return null;
  const raw = parseFloat(match[1]!.replace(/,/g, ""));
  if (Number.isNaN(raw)) return null;
  const suffix = match[2]?.toLowerCase();
  let multiplier = 1;
  if (suffix === "million" || suffix === "m") multiplier = 1_000_000; // ok: parses a grant-claim dollar amount, not a token-cost rate
  else if (suffix === "thousand" || suffix === "k") multiplier = 1_000;
  else if (suffix === "billion" || suffix === "b") multiplier = 1_000_000_000; // ok: parses a grant-claim dollar amount, not a token-cost rate
  return Math.round(raw * multiplier);
}

function extractGiftAmount(item: EvidenceItem): number | null {
  const value = item.value as { totalGrantsPaid?: unknown } | null;
  if (value && typeof value.totalGrantsPaid === "number") return value.totalGrantsPaid;
  return parseDollarAmount(item.claim);
}

function extractGiftDate(item: EvidenceItem): string | null {
  const value = item.value as { publishedAt?: unknown; filingYear?: unknown } | null;
  if (value && typeof value.publishedAt === "string") return value.publishedAt;
  if (value && typeof value.filingYear === "number") return `${value.filingYear}-01-01T00:00:00.000Z`;
  return item.published_at ?? item.retrieved_at ?? null;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Reads BEN-INT-08's philanthropicCapacity {low,high} shape off a wealth_capacity item's value, with a documented +/-25% fallback if it's ever a bare point estimate, or null if no numeric wealth data exists on the item at all. */
function deriveCapacityRange(item: EvidenceItem): { low: number; high: number } | null {
  const value = item.value as { philanthropicCapacity?: unknown; wealth?: unknown } | null;
  if (!value) return null;

  const capacity = value.philanthropicCapacity as { low?: unknown; high?: unknown } | number | undefined;
  if (capacity && typeof capacity === "object" && typeof capacity.low === "number" && typeof capacity.high === "number") {
    return { low: capacity.low, high: capacity.high };
  }
  if (typeof capacity === "number") {
    return { low: Math.round(capacity * (1 - POINT_ESTIMATE_RANGE_PCT)), high: Math.round(capacity * (1 + POINT_ESTIMATE_RANGE_PCT)) };
  }

  // Fallback: no philanthropicCapacity field at all on this item -- use the
  // raw wealth range/point-estimate rather than leaving a usable number unread.
  const wealth = value.wealth as { low?: unknown; high?: unknown } | number | undefined;
  if (wealth && typeof wealth === "object" && typeof wealth.low === "number" && typeof wealth.high === "number") {
    return { low: wealth.low, high: wealth.high };
  }
  if (typeof wealth === "number") {
    return { low: Math.round(wealth * (1 - POINT_ESTIMATE_RANGE_PCT)), high: Math.round(wealth * (1 + POINT_ESTIMATE_RANGE_PCT)) };
  }
  return null;
}

export class PhilanthropicCapacityPropensityAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completed({}, "BEN-QLF-03 requires an existing prospectId");
    }

    const prospect = await this.loadProspect(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completed({}, `Prospect ${context.prospectId} not found`);
    }

    const evidence = await getEvidence(context.prospectId, context.orgId);
    const evidenceByClaimType = new Map<string, EvidenceItem[]>();
    for (const item of evidence) {
      const list = evidenceByClaimType.get(item.claim_type) ?? [];
      list.push(item);
      evidenceByClaimType.set(item.claim_type, list);
    }
    const byClaimTypes = (claimTypes: string[]): EvidenceItem[] =>
      claimTypes.flatMap((claimType) => evidenceByClaimType.get(claimType) ?? []);

    // --- Capacity dimension (BEN-INT-08 evidence only) ------------------
    const capacityItems = byClaimTypes(CLAIM_TYPES_BY_DIMENSION.givingCapacity);
    const capacityConfidence = averageWeightedConfidence(capacityItems);

    const wealthCapacityItems = (evidenceByClaimType.get("wealth_capacity") ?? [])
      .slice()
      .sort((a, b) => new Date(b.retrieved_at).getTime() - new Date(a.retrieved_at).getTime());
    let capacityEstimateLow: number | null = null;
    let capacityEstimateHigh: number | null = null;
    for (const item of wealthCapacityItems) {
      const range = deriveCapacityRange(item);
      if (range) {
        capacityEstimateLow = range.low;
        capacityEstimateHigh = range.high;
        break;
      }
    }

    const capacityBasis = capacityItems.map((item) => ({
      evidenceId: item.id,
      claimType: item.claim_type,
      verificationStatus: item.verification_status,
      confidence: item.confidence,
    }));

    // --- Propensity dimension (BEN-INT-07 evidence only) -----------------
    const propensityItems = byClaimTypes(CLAIM_TYPES_BY_DIMENSION.philanthropicPropensity);
    const propensityScore = scoreDimension(propensityItems);
    const propensityConfidence = averageWeightedConfidence(propensityItems);

    const giftEvents: GiftEvent[] = propensityItems
      .map((item) => ({ amount: extractGiftAmount(item), date: extractGiftDate(item) }))
      .filter((g): g is GiftEvent => g.amount !== null && g.date !== null)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    let trend: GiftMagnitudePattern["trend"] = "insufficient_data";
    if (giftEvents.length >= 2) {
      const [mostRecent, priorMostRecent] = giftEvents;
      if (mostRecent!.amount > priorMostRecent!.amount * 1.05) trend = "increasing";
      else if (mostRecent!.amount < priorMostRecent!.amount * 0.95) trend = "decreasing";
      else trend = "flat";
    }
    const giftMagnitudePattern: GiftMagnitudePattern = {
      count: giftEvents.length,
      medianAmount: giftEvents.length > 0 ? median(giftEvents.map((g) => g.amount)) : null,
      trend,
    };

    // No giving-vehicle taxonomy exists anywhere in this schema's evidence
    // value shapes yet (grepped every INT/DIS writer) -- an honestly empty
    // array with a documented reason, never an invented vehicle type.
    const vehicleUse: string[] = [];

    // --- Shared supporting context ----------------------------------------
    const { score: causeRelevanceScore, source: causeRelevanceSource } = await this.scoreCauseRelevance(
      context.orgId,
      context.prospectId,
      evidenceByClaimType,
    );

    const businessOwnershipEvidence = evidenceByClaimType.get("business_ownership") ?? [];
    const hasPrivateCompanyOwnershipClaim = businessOwnershipEvidence.some((e) => e.source_type !== "sec_edgar");
    const uncertaintyParts: string[] = [];
    if (capacityEstimateLow === null || capacityEstimateHigh === null) {
      uncertaintyParts.push(
        "No numeric wealth data present in wealth_capacity evidence for this prospect -- capacity range left unset rather than fabricated.",
      );
    }
    if (capacityItems.length > 0 && hasPrivateCompanyOwnershipClaim) {
      uncertaintyParts.push(
        "Contributing capacity evidence traces to a private (non-public) company ownership claim -- BEN-INT-08's own documented 'Private-Company Uncertainty' limitation applies: no filing-backed valuation is available for this stake.",
      );
    }
    if (propensityItems.length === 0) {
      uncertaintyParts.push(
        "No giving-history evidence is on file for this prospect -- propensity score reflects a documented absence of behavior evidence, not a confirmed low propensity.",
      );
    }
    uncertaintyParts.push(
      "vehicleUse is intentionally empty: no giving-vehicle taxonomy (donor_advised_fund/direct_gift/foundation_grant, etc.) exists yet in this schema's evidence.value shapes.",
    );
    const uncertaintyNotes = uncertaintyParts.join(" ");

    const evidenceRefs = [...new Set([...capacityItems, ...propensityItems].map((item) => item.id))];

    const opportunity = await this.upsertCapacityEstimate(context.orgId, context.prospectId, capacityEstimateLow, capacityEstimateHigh);

    const assessment: Omit<CapacityPropensityAssessment, "id" | "created_at"> = {
      organization_id: context.orgId,
      prospect_id: context.prospectId,
      opportunity_id: opportunity.id,
      capacity_estimate_low: capacityEstimateLow,
      capacity_estimate_high: capacityEstimateHigh,
      capacity_confidence: capacityConfidence,
      capacity_basis: capacityBasis,
      propensity_score: propensityScore,
      propensity_confidence: propensityConfidence,
      giving_pattern_summary: { ...giftMagnitudePattern },
      vehicle_use: vehicleUse,
      cause_relevance_score: causeRelevanceScore,
      uncertainty_notes: uncertaintyNotes,
      evidence_refs: evidenceRefs,
      computed_by_agent_id: context.agentCode,
      computed_at: new Date().toISOString(),
    };
    await this.insertAssessment(assessment);

    // --- Delegation-gap analysis -------------------------------------------
    const delegations: DelegationRequest[] = [];
    const delegatedToInt08 = capacityItems.length === 0;
    if (delegatedToInt08) {
      delegations.push({
        childAgentCode: "BEN-INT-08",
        objective: `No wealth-capacity evidence exists for prospect ${context.prospectId}; BEN-QLF-03 cannot compute a capacity estimate without it.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId },
      });
    }
    const delegatedToInt07 = propensityItems.length === 0;
    if (delegatedToInt07) {
      delegations.push({
        childAgentCode: "BEN-INT-07",
        objective: `No giving-history evidence exists for prospect ${context.prospectId}; BEN-QLF-03 cannot compute a propensity score without it.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId },
      });
    }
    const liquidityItems = byClaimTypes(CLAIM_TYPES_BY_DIMENSION.timingReadiness);
    const delegatedToInt09 = liquidityItems.length === 0;
    if (delegatedToInt09) {
      delegations.push({
        childAgentCode: "BEN-INT-09",
        objective: `No liquidity-event evidence exists for prospect ${context.prospectId}; BEN-QLF-03's capacity/propensity determination has no wealth-origin corroborant to draw on.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId },
      });
    }
    const delegatedToKnw03 = capacityConfidence < LOW_CONFIDENCE_DELEGATION_THRESHOLD || propensityConfidence < LOW_CONFIDENCE_DELEGATION_THRESHOLD;
    if (delegatedToKnw03) {
      delegations.push({
        childAgentCode: "BEN-KNW-03",
        objective: `Evidence-quality verification for prospect ${context.prospectId}: capacity confidence ${capacityConfidence.toFixed(2)} / propensity confidence ${propensityConfidence.toFixed(2)}, below the ${LOW_CONFIDENCE_DELEGATION_THRESHOLD} trust threshold.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId, capacityConfidence, propensityConfidence },
      });
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "capacity_propensity.scored",
      resource_type: "pil_prospect_opportunities",
      resource_id: opportunity.id,
      before_state: null,
      after_state: { capacityEstimateLow, capacityEstimateHigh, capacityConfidence, propensityScore, propensityConfidence, causeRelevanceScore },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, 350);

    const report: CapacityPropensityReport = {
      prospectId: context.prospectId,
      capacityEstimateLow,
      capacityEstimateHigh,
      capacityConfidence,
      propensityScore,
      propensityConfidence,
      giftMagnitudePattern,
      vehicleUse,
      causeRelevanceScore,
      causeRelevanceSource,
      uncertaintyNotes,
      evidenceRefs,
      delegatedToInt07,
      delegatedToInt08,
      delegatedToInt09,
      delegatedToKnw03,
    };

    return {
      status: "completed",
      evidence: [],
      conclusions: { report },
      delegations,
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts; recording it again here would double-count the same tokens.
      error: null,
    };
  }

  /** Prefers a fresh (<=30 days old) BEN-QLF-01 pil_mission_affinity_assessments.cause_alignment_score for this prospect; otherwise falls back to a direct scoreDimension() over the same 3 cause-alignment claim types BEN-QLF-01 uses, without duplicating its recency/counterevidence logic. */
  private async scoreCauseRelevance(
    orgId: string,
    prospectId: string,
    evidenceByClaimType: Map<string, EvidenceItem[]>,
  ): Promise<{ score: number; source: "fresh_mission_affinity_assessment" | "direct_fallback" }> {
    const { data, error } = await getPilClient()
      .from("pil_mission_affinity_assessments")
      .select("*")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    const assessment = data as { cause_alignment_score: number; computed_at: string } | null;
    if (assessment) {
      const ageDays = (Date.now() - new Date(assessment.computed_at).getTime()) / MS_PER_DAY;
      if (ageDays <= CAUSE_ASSESSMENT_FRESHNESS_DAYS) {
        return { score: assessment.cause_alignment_score, source: "fresh_mission_affinity_assessment" };
      }
    }

    const [causeType, causeStatementType, mission990Type] = CLAIM_TYPES_BY_DIMENSION.missionAffinity;
    const causeItems = [causeType!, causeStatementType!, mission990Type!].flatMap((claimType) => evidenceByClaimType.get(claimType) ?? []);
    return { score: scoreDimension(causeItems), source: "direct_fallback" };
  }

  private async loadProspect(orgId: string, prospectId: string): Promise<Prospect | null> {
    const { data, error } = await getPilClient()
      .from("pil_prospects")
      .select("*")
      .eq("organization_id", orgId)
      .eq("id", prospectId)
      .maybeSingle();
    if (error) throw error;
    return (data as Prospect | null) ?? null;
  }

  // Scoped find-or-insert helper touching only capacity_estimate_low/high --
  // BEN-QLF-04's own upsertOpportunity() is a private class method covering
  // additional qualification fields this agent has no basis to set, so it
  // can't be imported and shouldn't be forked wholesale (same rationale as
  // BEN-QLF-01's upsertMissionAffinityScore).
  private async upsertCapacityEstimate(
    orgId: string,
    prospectId: string,
    low: number | null,
    high: number | null,
  ): Promise<ProspectOpportunity> {
    const client = getPilClient();
    const { data: existing, error: findError } = await client
      .from("pil_prospect_opportunities")
      .select("*")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .maybeSingle();
    if (findError) throw findError;

    if (existing) {
      const { data, error } = await client
        .from("pil_prospect_opportunities")
        .update({ capacity_estimate_low: low, capacity_estimate_high: high, updated_at: new Date().toISOString() })
        .eq("id", (existing as ProspectOpportunity).id)
        .select("*")
        .single();
      if (error) throw error;
      return data as ProspectOpportunity;
    }

    const { data, error } = await client
      .from("pil_prospect_opportunities")
      .insert({
        organization_id: orgId,
        prospect_id: prospectId,
        classification: "research_more",
        mission_affinity_score: null,
        capacity_estimate_low: low,
        capacity_estimate_high: high,
        recommended_ask_low: null,
        recommended_ask_high: null,
        timing_status: null,
        engagement_strategy: null,
        confidence: null,
        qualified_by_agent_id: null,
        qualified_at: null,
        status: "open",
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as ProspectOpportunity;
  }

  private async insertAssessment(assessment: Omit<CapacityPropensityAssessment, "id" | "created_at">): Promise<void> {
    const { error } = await getPilClient().from("pil_capacity_propensity_assessments").insert(assessment);
    if (error) throw error;
  }

  private async tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
    if (!context.tools.includes("T-MODEL")) return 0;
    try {
      const rate = await pilBlendedTokenRateUsd();
      await runner.useTool(context, "T-MODEL", { unitCost: rate, units, costType: "model_tokens", model: PIL_AGENT_MODEL });
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

export default PhilanthropicCapacityPropensityAgent;
