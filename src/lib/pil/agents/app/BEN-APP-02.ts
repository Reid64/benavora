import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect } from "@/lib/pil/graph";
import { createReviewItem } from "@/lib/pil/human-review";
import { logAction } from "@/lib/pil/audit";
import { CEO_TRANSITION_KEYWORDS, DENIAL_KEYWORDS, hasWarmIntroPath, scanEvidenceForKeywords } from "@/lib/pil/agents/app/BEN-APP-01";
import { scoreRelationshipStrength } from "@/lib/pil/agents/qlf/BEN-QLF-04";
import type {
  ApplicationProfile,
  ApplicationRecommendationStatus,
  CapacityPropensityAssessment,
  EvidenceItem,
  PriorityPercentile,
  PriorityRecommendation,
  PriorityScore,
  PriorityScoreBreakdown,
  Prospect,
  ProspectEntityType,
  ProspectOpportunity,
  RequestProfile,
  TimingReadinessAssessment,
} from "@/lib/pil/types";

// BEN-APP-02 -- Recommendation Priority Scorer
// (pil_agent_registry, migration 168, APP family agent 2 of 3: application /
// recommendation / executor). Mission: a tenant may have hundreds of
// BEN-APP-01-qualified prospects and capacity for only 10-20 outreach
// campaigns -- this agent ranks all of them by a single 0-100 priority score
// so staff know which to pursue first, rather than facing decision paralysis
// over an unordered list.
//
// Scope: org-wide, not per-prospect. Every other APP/QLF agent's
// AgentContext.prospectId scopes it to one prospect; this agent instead
// ignores prospectId and ranks every prospect in the org that has at least
// one pil_application_profiles row, because percentile tagging and "natural
// breakpoint" analysis are inherently whole-batch computations (a
// percentile/breakpoint over a single prospect is meaningless). This mirrors
// BEN-OPS-01's own org-wide, prospectId-agnostic scope for the same reason
// (fleet-wide aggregation cannot be computed one row at a time).
//
// Input source: the task spec's literal instruction was "Inputs:
// pil_prospect_dossiers with app_recommendations populated" -- but
// BEN-APP-01/migration 167 already established that app_recommendations
// live in pil_application_profiles, not a pil_prospect_dossiers column (that
// table has no such column and no UPDATE policy at all). This agent reads
// pil_application_profiles directly, the same real table BEN-APP-01 writes.
//
// Output destination: same migration-167 precedent recurs for THIS agent's
// own literal spec instruction ("Output: pil_prospect_dossiers.priority_score,
// priority_percentile, priority_recommendation") -- pil_prospect_dossiers is
// still append-only with no UPDATE policy, so those three fields cannot live
// there either. Output goes to the new pil_priority_scores table (migration
// 168), one row per prospect per run, found via
// (organization_id, prospect_id, computed_at DESC) exactly like every other
// APP/QLF detail table.
//
// Representative profile per prospect: a prospect can match multiple
// request_profiles in one BEN-APP-01 run ("Multi-profile queuing"). Priority
// is a per-PROSPECT resource-allocation decision (which prospect gets scarce
// outreach capacity), not a per-request-type one, so this agent scores
// exactly one representative pil_application_profiles row per prospect --
// the one BEN-APP-01 itself ranked highest (relationship_strategy.sequence
// === 1 within that prospect's own latest computed_at batch, falling back to
// the highest success_probability row if sequence is ever missing).
//
// Formula (spec-given, applied literally):
//   priority_score = success_prob*35 + capacity_score*25 + readiness_score*20
//                     + effort_efficiency*15 + strategic_bonus*5
// Two literal-vs-prose tensions in the spec's own formula, both resolved by
// following the literal formula (the executable artifact) over the prose
// gloss (the description), consistent with this build's standing rule of
// documenting -- not silently guessing past -- any such tension:
//   1. readiness_score/effort_efficiency are spec'd on a 0-100 scale (their
//      own breakdown lists 90/60/30/10) but success_prob/capacity_score are
//      spec'd 0.0-1.0 ("Realistic probability of success" as a probability,
//      "Capacity" as a 0-1-style confidence/fit score matching every sibling
//      APP-01/QLF dimension). Multiplying a 0-100 value by weight 20 or 15
//      directly would blow the 0-100 total budget by 20x/15x. This agent
//      therefore divides readiness_score/effort_efficiency by 100 before
//      applying their weights, so every term contributes on the same 0-1
//      normalized basis before its weight is applied -- the only reading
//      that keeps the five weights (35+25+20+15+5=100) summing to a genuine
//      0-100 scale, matching the spec's own explicit "Priority Score
//      (0.0-100.0)" statement.
//   2. strategic_bonus is described in prose as a "1.0-1.5x multiplier" (i.e.
//      something you multiply the total by) but the formula itself places it
//      as an ADDITIVE term with weight 5, alongside four other additive
//      terms. This agent implements the literal formula: the raw multiplier
//      value (1.0 when no bonus applies, up to 1.5) is used directly as the
//      term, weighted by 5 -- so a prospect with no strategic bonus still
//      contributes a 5.0-point baseline from this term (1.0*5), and the
//      maximum any prospect can gain from this term is 7.5 (1.5*5). Applying
//      it as a true multiplier over the whole sum instead would let a single
//      bonus swing the total by up to 50%, which is a materially different
//      and more volatile scoring behavior than the "5% of the weighted score"
//      the formula's own 5-point weight implies -- the literal formula was
//      trusted over the prose here.
// Max attainable (1*35 + 1*25 + 100/100*20 + 100/100*15 + 1.5*5 = 102.5) is
// clamped to 100.
//
// Readiness score (spec-given four-tier breakdown, checked in this order,
// first match wins -- a documented override, not a spec ambiguity): negative
// signal (denial/CEO-transition evidence) is checked BEFORE the warm-
// relationship tier, so a warm relationship with a denial or leadership
// transition on record still reads as a caution (10), not a green light
// (90). No structured schema column represents "prior decline"/"CEO
// transition" any more than it did for BEN-APP-01 (see that file's own
// header) -- reuses BEN-APP-01's exact same evidence-text keyword scan
// (DENIAL_KEYWORDS/CEO_TRANSITION_KEYWORDS, now exported from that file
// rather than duplicated here). "Known organization, no relationship" is
// read as "this prospect has at least one pil_evidence row" (DIS/INT
// families have actually researched it) with relationship maturity at or
// below the warm threshold; zero evidence at all is the literal "cold
// prospect" case.
//
// Capacity score / "major funder" / "new sector" bonuses are all
// batch-relative (computed against the min/max/quartile of THIS run's own
// ranked prospect set), never an absolute fabricated dollar threshold or
// "how many companies exist" claim this schema cannot support -- the same
// no-fabrication discipline BEN-APP-01/BEN-QLF-01 already apply to their own
// heuristics.
//
// Effort efficiency has no dedicated "minutes to submit" column anywhere in
// this schema; approximated from two real signals on the matched
// request_profiles row and this prospect's own field_mappings: the number of
// profile.specific_requirements keys (custom requirements imply custom
// documents) and the number of field_mappings values still
// "insufficient_data" (more manual research needed before submission), plus
// +1 when the profile has no pitch_template (a from-scratch pitch). A
// prospect whose request_profile can't be resolved at all falls back to the
// medium (60) tier rather than guessing at a complexity number with zero
// underlying signal -- this build's own "insufficient data -> confidence
// medium" convention, applied here to effort rather than probability.
//
// Delegation: no BEN-SUP-05 critic re-delegation here -- BEN-APP-01 already
// gates every "submit" recommendation through a critic review and human
// review item (migration 167); this agent only re-ORDERS already-gated
// recommendations, it does not introduce a new submit/no-submit decision, so
// re-triggering that same gate for every prospect in a hundreds-large batch
// would be pure duplication. What this agent does add: (1) one aggregate
// delegation to BEN-APP-01 (capped list, not one delegation per prospect)
// when a batch contains prospects whose underlying application-profile
// confidence is low, asking for a refresh rather than ranking on stale data
// forever; (2) one pil_human_review_queue item (review_type
// high_impact_action) summarizing the run's top "submit_now" picks (capped),
// since deciding where an org's scarce outreach capacity goes is exactly the
// kind of consequential, non-self-certified action this build's human_
// boundary convention exists to flag -- scaled from BEN-APP-01's
// per-prospect version of the same review type up to this agent's own
// batch-level output.

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;

const SUCCESS_PROBABILITY_WEIGHT = 35;
const CAPACITY_WEIGHT = 25;
const READINESS_WEIGHT = 20;
const EFFORT_EFFICIENCY_WEIGHT = 15;
const STRATEGIC_BONUS_WEIGHT = 5;

const FALLBACK_CAPACITY_SCORE = 0.5;
const FALLBACK_RELATIONSHIP_SCORE = 0.5;

const READINESS_WARM_RELATIONSHIP = 90;
const READINESS_KNOWN_NO_RELATIONSHIP = 60;
const READINESS_COLD = 30;
const READINESS_NEGATIVE_SIGNAL = 10;
const WARM_RELATIONSHIP_THRESHOLD = 0.7;

const EFFORT_SIMPLE = 90;
const EFFORT_MEDIUM = 60;
const EFFORT_COMPLEX = 30;
const EFFORT_EXTREMELY_COMPLEX = 10;
const FALLBACK_EFFORT_EFFICIENCY = EFFORT_MEDIUM;

const FIRST_GIFT_MAJOR_FUNDER_MULTIPLIER = 1.5;
const SEQUENTIAL_OPPORTUNITY_MULTIPLIER = 1.4;
const NEW_SECTOR_MULTIPLIER = 1.3;
const BOARD_MEMBER_FOUNDATION_MULTIPLIER = 1.25;
const NO_STRATEGIC_BONUS_MULTIPLIER = 1.0;

const MAJOR_FUNDER_CAPACITY_QUANTILE = 0.75;

const SUBMIT_NOW_THRESHOLD = 70;
const SUBMIT_NEXT_QUARTER_THRESHOLD = 50;

const LOW_CONFIDENCE_REFRESH_THRESHOLD = 0.6;
const MAX_REFRESH_DELEGATION_PROSPECTS = 15;
const HUMAN_REVIEW_TOP_N = 10;

const BREAKPOINT_VALUE_SHARE = 0.7;

const TOP_10_PERCENTILE = 0.1;
const TOP_25_PERCENTILE = 0.25;
const TOP_50_PERCENTILE = 0.5;

// No schema-side "prior gift, now asking for more" column exists -- same
// evidence-text-keyword-scan discipline as DENIAL_KEYWORDS/CEO_TRANSITION_KEYWORDS.
const SEQUENTIAL_ASK_KEYWORDS = [
  "increased gift",
  "increased ask",
  "renewed funding",
  "follow-up gift",
  "follow up gift",
  "second grant",
  "larger gift",
  "expand support",
  "expanded support",
  "additional funding round",
  "repeat gift",
];

const FOUNDATION_ENTITY_TYPES = new Set<ProspectEntityType>([
  "family_foundation",
  "private_foundation",
  "community_foundation",
  "corporate_foundation",
]);

const NEW_SECTOR_ENTITY_TYPES = new Set<ProspectEntityType>(["corporation", "corporate_foundation"]);

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clampScore(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)) * 100) / 100;
}

function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code: unknown }).code) : "";
  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  return code === "42P01" || /relation .* does not exist/i.test(message) || /does not exist/i.test(message);
}

interface StrategicBonusResult {
  multiplier: number;
  reasons: string[];
}

interface ScoredProspect {
  prospectId: string;
  prospect: Prospect;
  profile: ApplicationProfile;
  requestProfile: RequestProfile | null;
  priorityScore: number;
  breakdown: PriorityScoreBreakdown;
  strategicBonus: StrategicBonusResult;
  capacityMidpoint: number | null;
  evidenceRefs: string[];
  underlyingStatus: ApplicationRecommendationStatus;
  negativeSignal: boolean;
}

export interface PriorityRankingReport {
  totalRanked: number;
  ranked: Array<{
    prospectId: string;
    displayName: string;
    priorityScore: number;
    priorityPercentile: PriorityPercentile;
    priorityRecommendation: PriorityRecommendation;
    scoreBreakdown: PriorityScoreBreakdown;
    reasoning: string;
    nextStep: string;
  }>;
  naturalBreakpoint: string;
  lowConfidenceRefreshCount: number;
  reviewsCreated: number;
}

export class RecommendationPriorityScorerAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const profiles = await this.loadApplicationProfiles(context.orgId);
    if (profiles.length === 0) {
      return this.completed({ ranked: [] }, "Organization has no pil_application_profiles rows to rank yet");
    }

    const representative = this.pickRepresentativeProfiles(profiles);
    const prospectIds = [...representative.keys()];

    const [prospects, opportunities, capacityAssessments, timingAssessments] = await Promise.all([
      this.loadProspects(context.orgId, prospectIds),
      this.loadOpportunities(context.orgId, prospectIds),
      this.loadLatestByProspect<CapacityPropensityAssessment>("pil_capacity_propensity_assessments", context.orgId, prospectIds),
      this.loadLatestByProspect<TimingReadinessAssessment>("pil_timing_readiness_assessments", context.orgId, prospectIds),
    ]);

    const requestProfileIds = [...new Set([...representative.values()].map((p) => p.request_profile_id).filter((id): id is string => id != null))];
    const requestProfiles = await this.loadRequestProfiles(context.orgId, requestProfileIds);

    const evidenceByProspect = new Map<string, EvidenceItem[]>();
    const nodesByProspect = new Map<string, string[]>();
    await Promise.all(
      prospectIds.map(async (prospectId) => {
        const [evidence, nodes] = await Promise.all([getEvidence(prospectId, context.orgId), getNodesByProspect(prospectId, context.orgId)]);
        evidenceByProspect.set(prospectId, evidence);
        nodesByProspect.set(prospectId, nodes.map((n) => n.id));
      }),
    );
    const warmIntroByProspect = new Map<string, boolean>();
    await Promise.all(
      prospectIds.map(async (prospectId) => {
        const nodeIds = nodesByProspect.get(prospectId) ?? [];
        warmIntroByProspect.set(prospectId, nodeIds.length > 0 ? await hasWarmIntroPath(context.orgId, nodeIds) : false);
      }),
    );

    // Batch-relative capacity normalization -- see this file's header for why
    // a fixed dollar threshold would be a fabricated signal this schema
    // cannot support.
    const capacityMidpointByProspect = new Map<string, number | null>();
    for (const prospectId of prospectIds) {
      capacityMidpointByProspect.set(
        prospectId,
        this.resolveCapacityMidpoint(capacityAssessments.get(prospectId) ?? null, opportunities.get(prospectId) ?? null),
      );
    }
    const capacityValues = [...capacityMidpointByProspect.values()].filter((v): v is number => v != null);
    const maxCapacityMidpoint = capacityValues.length > 0 ? Math.max(...capacityValues) : 0;
    const majorFunderThreshold = this.quantile(capacityValues, MAJOR_FUNDER_CAPACITY_QUANTILE);

    const entityTypeCounts = new Map<ProspectEntityType, number>();
    for (const prospectId of prospectIds) {
      const entityType = prospects.get(prospectId)?.entity_type;
      if (!entityType) continue;
      entityTypeCounts.set(entityType, (entityTypeCounts.get(entityType) ?? 0) + 1);
    }

    const scored: ScoredProspect[] = [];
    const lowConfidenceProspectIds: string[] = [];

    for (const prospectId of prospectIds) {
      const profile = representative.get(prospectId);
      const prospect = prospects.get(prospectId);
      if (!profile || !prospect) continue;

      if (profile.confidence < LOW_CONFIDENCE_REFRESH_THRESHOLD && lowConfidenceProspectIds.length < MAX_REFRESH_DELEGATION_PROSPECTS) {
        lowConfidenceProspectIds.push(prospectId);
      }

      const evidence = evidenceByProspect.get(prospectId) ?? [];
      const capacityAssessment = capacityAssessments.get(prospectId) ?? null;
      const timingAssessment = timingAssessments.get(prospectId) ?? null;
      const requestProfile = profile.request_profile_id ? requestProfiles.get(profile.request_profile_id) ?? null : null;
      const capacityMidpoint = capacityMidpointByProspect.get(prospectId) ?? null;
      const warmIntroPath = warmIntroByProspect.get(prospectId) ?? false;

      const successProb = clamp01(profile.success_probability);

      const capacityScore =
        capacityMidpoint != null && maxCapacityMidpoint > 0
          ? clamp01(capacityMidpoint / maxCapacityMidpoint)
          : clamp01(capacityAssessment?.capacity_confidence ?? FALLBACK_CAPACITY_SCORE);

      const relationshipMaturity = await this.resolveRelationshipMaturity(context.orgId, prospectId, timingAssessment);

      const denialFlag = scanEvidenceForKeywords(evidence, DENIAL_KEYWORDS);
      const ceoTransitionFlag = scanEvidenceForKeywords(evidence, CEO_TRANSITION_KEYWORDS);
      const negativeSignal = denialFlag || ceoTransitionFlag;

      const readinessScore = this.computeReadinessScore({ negativeSignal, relationshipMaturity, hasEvidence: evidence.length > 0 });
      const effortEfficiency = this.computeEffortEfficiency(profile, requestProfile);

      const hasGivingHistory = (capacityAssessment?.propensity_score ?? 0) > 0;
      const sequentialAskSignal = scanEvidenceForKeywords(evidence, SEQUENTIAL_ASK_KEYWORDS);
      const isFirstOfEntityTypeInBatch = (entityTypeCounts.get(prospect.entity_type) ?? 0) === 1;

      const strategicBonus = this.computeStrategicBonus({
        entityType: prospect.entity_type,
        capacityMidpoint,
        majorFunderThreshold,
        hasGivingHistory,
        sequentialAskSignal,
        isFirstOfEntityTypeInBatch,
        warmIntroPath,
      });

      const priorityScore = clampScore(
        successProb * SUCCESS_PROBABILITY_WEIGHT +
          capacityScore * CAPACITY_WEIGHT +
          (readinessScore / 100) * READINESS_WEIGHT +
          (effortEfficiency / 100) * EFFORT_EFFICIENCY_WEIGHT +
          strategicBonus.multiplier * STRATEGIC_BONUS_WEIGHT,
      );

      const breakdown: PriorityScoreBreakdown = {
        success_probability: Math.round(successProb * 100),
        capacity_contribution: Math.round(capacityScore * 100),
        readiness_score: readinessScore,
        effort_efficiency: effortEfficiency,
        strategic_bonus_multiplier: strategicBonus.multiplier,
      };

      scored.push({
        prospectId,
        prospect,
        profile,
        requestProfile,
        priorityScore,
        breakdown,
        strategicBonus,
        capacityMidpoint,
        evidenceRefs: evidence.map((e) => e.id),
        underlyingStatus: profile.recommendation_status,
        negativeSignal,
      });
    }

    scored.sort((a, b) => b.priorityScore - a.priorityScore);

    const total = scored.length;
    const nowIso = new Date().toISOString();
    const rowsToInsert: Array<Omit<PriorityScore, "id" | "created_at">> = [];
    const reportRanked: PriorityRankingReport["ranked"] = [];

    for (let index = 0; index < scored.length; index++) {
      const entry = scored[index]!;
      const rank = index + 1;
      const percentile = this.assignPercentile(rank, total);
      const recommendation = this.decidePriorityRecommendation(entry.underlyingStatus, entry.priorityScore, entry.negativeSignal);
      const reasoning = this.buildReasoning(entry);
      const nextStep = this.buildNextStep(entry, recommendation);

      rowsToInsert.push({
        organization_id: context.orgId,
        prospect_id: entry.prospectId,
        application_profile_id: entry.profile.id,
        priority_score: entry.priorityScore,
        priority_percentile: percentile,
        priority_recommendation: recommendation,
        score_breakdown: entry.breakdown,
        reasoning,
        next_step: nextStep,
        evidence_refs: entry.evidenceRefs,
        computed_by_agent_id: context.agentCode,
        computed_at: nowIso,
      });

      reportRanked.push({
        prospectId: entry.prospectId,
        displayName: entry.prospect.display_name,
        priorityScore: entry.priorityScore,
        priorityPercentile: percentile,
        priorityRecommendation: recommendation,
        scoreBreakdown: entry.breakdown,
        reasoning,
        nextStep,
      });
    }

    await this.insertPriorityScores(rowsToInsert);

    const naturalBreakpoint = this.findNaturalBreakpoint(scored);

    const delegations: DelegationRequest[] = [];
    if (lowConfidenceProspectIds.length > 0) {
      delegations.push({
        childAgentCode: "BEN-APP-01",
        objective: `${lowConfidenceProspectIds.length} prospect(s) in BEN-APP-02's latest ranked batch carry application-profile confidence below ${LOW_CONFIDENCE_REFRESH_THRESHOLD}; refresh their application profiles before the next priority-ranking run.`,
        maxAutonomy: "A2",
        constraints: { prospectIds: lowConfidenceProspectIds },
      });
    }

    let reviewsCreated = 0;
    const submitNowPicks = reportRanked.filter((r) => r.priorityRecommendation === "submit_now").slice(0, HUMAN_REVIEW_TOP_N);
    if (submitNowPicks.length > 0) {
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "high_impact_action",
        subject_type: "pil_priority_scores",
        subject_id: context.runId,
        requested_by_agent_id: context.agentCode,
        priority: "high",
        status: "pending",
        summary: `BEN-APP-02 ranked ${total} prospect(s) this run; top ${submitNowPicks.length} "submit_now" pick(s): ${submitNowPicks.map((p) => `${p.displayName} (${p.priorityScore})`).join(", ")}. Confirm before scarce outreach capacity is committed.`,
        evidence_refs: [],
        assigned_to_user_id: null,
        resolved_at: null,
      });
      reviewsCreated = 1;
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "priority_score.ranked",
      resource_type: "pil_priority_scores",
      resource_id: context.runId,
      before_state: null,
      after_state: { totalRanked: total, submitNowCount: submitNowPicks.length, naturalBreakpoint },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, total * 200);

    const report: PriorityRankingReport = {
      totalRanked: total,
      ranked: reportRanked,
      naturalBreakpoint,
      lowConfidenceRefreshCount: lowConfidenceProspectIds.length,
      reviewsCreated,
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

  private pickRepresentativeProfiles(profiles: ApplicationProfile[]): Map<string, ApplicationProfile> {
    const byProspect = new Map<string, ApplicationProfile[]>();
    for (const profile of profiles) {
      const list = byProspect.get(profile.prospect_id) ?? [];
      list.push(profile);
      byProspect.set(profile.prospect_id, list);
    }

    const representative = new Map<string, ApplicationProfile>();
    for (const [prospectId, group] of byProspect) {
      const latestComputedAt = group.reduce((latest, p) => (p.computed_at > latest ? p.computed_at : latest), group[0]!.computed_at);
      const latestBatch = group.filter((p) => p.computed_at === latestComputedAt);
      const bySequence = latestBatch.find((p) => p.relationship_strategy?.sequence === 1);
      const best =
        bySequence ?? latestBatch.reduce((top, p) => (p.success_probability > top.success_probability ? p : top), latestBatch[0]!);
      representative.set(prospectId, best);
    }
    return representative;
  }

  private computeReadinessScore(params: { negativeSignal: boolean; relationshipMaturity: number; hasEvidence: boolean }): number {
    const { negativeSignal, relationshipMaturity, hasEvidence } = params;
    if (negativeSignal) return READINESS_NEGATIVE_SIGNAL;
    if (relationshipMaturity > WARM_RELATIONSHIP_THRESHOLD) return READINESS_WARM_RELATIONSHIP;
    if (hasEvidence) return READINESS_KNOWN_NO_RELATIONSHIP;
    return READINESS_COLD;
  }

  private computeEffortEfficiency(profile: ApplicationProfile, requestProfile: RequestProfile | null): number {
    if (!requestProfile) return FALLBACK_EFFORT_EFFICIENCY;
    const specificRequirementsKeyCount = Object.keys(requestProfile.specific_requirements ?? {}).length;
    const unresolvedFieldMappingsCount = Object.values(profile.field_mappings ?? {}).filter((v) => v === "insufficient_data").length;
    const pitchTemplateMissing = requestProfile.pitch_template == null;
    const complexity = specificRequirementsKeyCount + unresolvedFieldMappingsCount + (pitchTemplateMissing ? 1 : 0);
    if (complexity === 0) return EFFORT_SIMPLE;
    if (complexity <= 2) return EFFORT_MEDIUM;
    if (complexity <= 4) return EFFORT_COMPLEX;
    return EFFORT_EXTREMELY_COMPLEX;
  }

  private computeStrategicBonus(params: {
    entityType: ProspectEntityType;
    capacityMidpoint: number | null;
    majorFunderThreshold: number;
    hasGivingHistory: boolean;
    sequentialAskSignal: boolean;
    isFirstOfEntityTypeInBatch: boolean;
    warmIntroPath: boolean;
  }): StrategicBonusResult {
    const { entityType, capacityMidpoint, majorFunderThreshold, hasGivingHistory, sequentialAskSignal, isFirstOfEntityTypeInBatch, warmIntroPath } = params;

    const candidates: Array<{ multiplier: number; reason: string }> = [];

    if (capacityMidpoint != null && majorFunderThreshold > 0 && capacityMidpoint >= majorFunderThreshold && !hasGivingHistory) {
      candidates.push({
        multiplier: FIRST_GIFT_MAJOR_FUNDER_MULTIPLIER,
        reason: "first gift from a major funder (no prior giving history on record; capacity ranks in this run's top quartile)",
      });
    }
    if (sequentialAskSignal) {
      candidates.push({
        multiplier: SEQUENTIAL_OPPORTUNITY_MULTIPLIER,
        reason: "sequential opportunity (evidence references an increased/follow-up ask)",
      });
    }
    if (NEW_SECTOR_ENTITY_TYPES.has(entityType) && isFirstOfEntityTypeInBatch) {
      candidates.push({
        multiplier: NEW_SECTOR_MULTIPLIER,
        reason: `demonstrates a new sector (only ${entityType.replace("_", " ")} prospect in this run's ranked batch)`,
      });
    }
    if (FOUNDATION_ENTITY_TYPES.has(entityType) && warmIntroPath) {
      candidates.push({
        multiplier: BOARD_MEMBER_FOUNDATION_MULTIPLIER,
        reason: "board member's foundation (warm-introduction path into a foundation-type prospect)",
      });
    }

    if (candidates.length === 0) return { multiplier: NO_STRATEGIC_BONUS_MULTIPLIER, reasons: [] };
    const best = candidates.reduce((top, c) => (c.multiplier > top.multiplier ? c : top), candidates[0]!);
    return { multiplier: best.multiplier, reasons: [best.reason] };
  }

  private decidePriorityRecommendation(
    underlyingStatus: ApplicationRecommendationStatus,
    priorityScore: number,
    negativeSignal: boolean,
  ): PriorityRecommendation {
    if (underlyingStatus === "research_more") return "research_more";
    if (underlyingStatus === "monitor" || underlyingStatus === "manual_review") return "monitor";
    // underlyingStatus === "submit" from here -- BEN-APP-01 already cleared
    // it for submission; this agent only decides WHEN, never whether.
    if (negativeSignal) return "monitor";
    if (priorityScore >= SUBMIT_NOW_THRESHOLD) return "submit_now";
    if (priorityScore >= SUBMIT_NEXT_QUARTER_THRESHOLD) return "submit_next_quarter";
    return "monitor";
  }

  private assignPercentile(rank: number, total: number): PriorityPercentile {
    if (rank <= Math.ceil(total * TOP_10_PERCENTILE)) return "top_10";
    if (rank <= Math.ceil(total * TOP_25_PERCENTILE)) return "top_25";
    if (rank <= Math.ceil(total * TOP_50_PERCENTILE)) return "top_50";
    return "bottom_50";
  }

  private buildReasoning(entry: ScoredProspect): string {
    const capacityText = entry.capacityMidpoint != null ? `~$${Math.round(entry.capacityMidpoint).toLocaleString("en-US")}` : "not yet estimated";
    const bonusText = entry.strategicBonus.reasons.length > 0 ? `, strategic bonus: ${entry.strategicBonus.reasons.join("; ")} (x${entry.strategicBonus.multiplier})` : "";
    return `${entry.prospect.display_name} (${entry.prospect.entity_type}): success probability ${entry.breakdown.success_probability}%, capacity ${capacityText} (relative capacity score ${entry.breakdown.capacity_contribution}/100), readiness ${entry.breakdown.readiness_score}/100, effort efficiency ${entry.breakdown.effort_efficiency}/100${bonusText} -> priority_score ${entry.priorityScore}.`;
  }

  private buildNextStep(entry: ScoredProspect, recommendation: PriorityRecommendation): string {
    switch (recommendation) {
      case "submit_now":
        return entry.requestProfile
          ? `Submit via request_profile "${entry.requestProfile.name}" this cycle.`
          : "Submit this cycle once a matching request_profile is confirmed.";
      case "submit_next_quarter":
        return "Queue for next-quarter submission; re-run BEN-APP-02 as readiness/capacity signals improve.";
      case "research_more":
        return "Hold for further research before any outreach (carried over from BEN-APP-01's own recommendation).";
      case "monitor":
      default:
        return entry.negativeSignal
          ? "Monitor -- evidence on file references a prior decline or leadership transition; reassess before outreach."
          : "Monitor for improved timing or relationship signal before committing outreach capacity.";
    }
  }

  private findNaturalBreakpoint(scored: ScoredProspect[]): string {
    const withCapacity = scored.filter((s) => s.capacityMidpoint != null && s.capacityMidpoint > 0);
    const totalValue = withCapacity.reduce((sum, s) => sum + (s.capacityMidpoint ?? 0), 0);
    if (totalValue <= 0) {
      return "Insufficient capacity data across this run's ranked prospects to compute a value-based breakpoint.";
    }
    let cumulative = 0;
    let count = 0;
    for (const entry of scored) {
      count++;
      cumulative += entry.capacityMidpoint ?? 0;
      if (cumulative / totalValue >= BREAKPOINT_VALUE_SHARE) break;
    }
    const pct = Math.round((cumulative / totalValue) * 100);
    return `Top ${count} of ${scored.length} ranked prospect(s) account for ~${pct}% of this run's total estimated capacity value.`;
  }

  private quantile(values: number[], q: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
    return sorted[index]!;
  }

  private resolveCapacityMidpoint(capacityAssessment: CapacityPropensityAssessment | null, opportunity: ProspectOpportunity | null): number | null {
    if (capacityAssessment?.capacity_estimate_low != null && capacityAssessment?.capacity_estimate_high != null) {
      return (capacityAssessment.capacity_estimate_low + capacityAssessment.capacity_estimate_high) / 2;
    }
    if (opportunity?.capacity_estimate_low != null && opportunity?.capacity_estimate_high != null) {
      return (opportunity.capacity_estimate_low + opportunity.capacity_estimate_high) / 2;
    }
    return null;
  }

  private async resolveRelationshipMaturity(orgId: string, prospectId: string, timingAssessment: TimingReadinessAssessment | null): Promise<number> {
    if (timingAssessment?.relationship_maturity_score != null) {
      return clamp01(timingAssessment.relationship_maturity_score / 100);
    }
    const relationshipStrengthScore = await scoreRelationshipStrength(orgId, prospectId);
    return relationshipStrengthScore > 0 ? clamp01(relationshipStrengthScore / 100) : FALLBACK_RELATIONSHIP_SCORE;
  }

  // No LIMIT applied -- supabase-js's query builder has no server-side
  // "latest row per group" capability without raw SQL (which this codebase
  // does not use elsewhere either), so every pil_application_profiles row
  // for the org is fetched and reduced to "latest batch per prospect" in JS,
  // mirroring BEN-OPS-01's own full-window fetch-then-aggregate pattern.
  private async loadApplicationProfiles(orgId: string): Promise<ApplicationProfile[]> {
    const { data, error } = await getPilClient().from("pil_application_profiles").select("*").eq("organization_id", orgId);
    if (error) throw error;
    return (data ?? []) as ApplicationProfile[];
  }

  private async loadProspects(orgId: string, prospectIds: string[]): Promise<Map<string, Prospect>> {
    if (prospectIds.length === 0) return new Map();
    const { data, error } = await getPilClient().from("pil_prospects").select("*").eq("organization_id", orgId).in("id", prospectIds);
    if (error) throw error;
    return new Map(((data ?? []) as Prospect[]).map((p) => [p.id, p]));
  }

  private async loadOpportunities(orgId: string, prospectIds: string[]): Promise<Map<string, ProspectOpportunity>> {
    if (prospectIds.length === 0) return new Map();
    const { data, error } = await getPilClient().from("pil_prospect_opportunities").select("*").eq("organization_id", orgId).in("prospect_id", prospectIds);
    if (error) throw error;
    return new Map(((data ?? []) as ProspectOpportunity[]).map((o) => [o.prospect_id, o]));
  }

  private async loadRequestProfiles(orgId: string, ids: string[]): Promise<Map<string, RequestProfile>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await getPilClient().from("request_profiles").select("*").eq("organization_id", orgId).in("id", ids);
    if (error) throw error;
    return new Map(((data ?? []) as RequestProfile[]).map((p) => [p.id, p]));
  }

  // Shared "latest row per prospect" reducer for the two detail-assessment
  // tables this agent reads (pil_capacity_propensity_assessments,
  // pil_timing_readiness_assessments) -- fetched newest-first so the first
  // row seen per prospect_id is already its latest.
  private async loadLatestByProspect<T extends { prospect_id: string; computed_at: string }>(
    table: string,
    orgId: string,
    prospectIds: string[],
  ): Promise<Map<string, T>> {
    if (prospectIds.length === 0) return new Map();
    const { data, error } = await getPilClient()
      .from(table)
      .select("*")
      .eq("organization_id", orgId)
      .in("prospect_id", prospectIds)
      .order("computed_at", { ascending: false });
    if (error) throw error;
    const map = new Map<string, T>();
    for (const row of (data ?? []) as T[]) {
      if (!map.has(row.prospect_id)) map.set(row.prospect_id, row);
    }
    return map;
  }

  // Wrapped per BEN-APP-01's own convention: a missing-table/relation error
  // is treated as a no-op rather than crashing, since this queue's prompts
  // may not all have executed yet in every environment this agent could run in.
  private async insertPriorityScores(rows: Array<Omit<PriorityScore, "id" | "created_at">>): Promise<void> {
    if (rows.length === 0) return;
    try {
      const { error } = await getPilClient().from("pil_priority_scores").insert(rows);
      if (error && !isMissingTableError(error)) throw error;
    } catch (err) {
      if (!isMissingTableError(err)) throw err;
    }
  }

  private async tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
    if (units <= 0 || !context.tools.includes("T-MODEL")) return 0;
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

export default RecommendationPriorityScorerAgent;
