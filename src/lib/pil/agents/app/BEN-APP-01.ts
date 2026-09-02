import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect } from "@/lib/pil/graph";
import { createReviewItem } from "@/lib/pil/human-review";
import { logAction } from "@/lib/pil/audit";
import { scoreRelationshipStrength } from "@/lib/pil/agents/qlf/BEN-QLF-04";
import type {
  ApplicationProfile,
  ApplicationProfilePitchParameters,
  ApplicationProfileRelationshipStrategy,
  ApplicationProfileRiskFactor,
  ApplicationRecommendationStatus,
  CapacityPropensityAssessment,
  EvidenceItem,
  FundingEligibilityAssessment,
  GraphEdge,
  MissionAffinityAssessment,
  Prospect,
  ProspectEntityType,
  ProspectOpportunity,
  ProspectOpportunityTimingStatus,
  RequestProfile,
  RequestType,
  TimingReadinessAssessment,
} from "@/lib/pil/types";

// BEN-APP-01 -- Application Profile Orchestrator
// (pil_agent_registry, migration 167, new FAMILY "application" -- agent 1 of
// 3 in the APP family: application / recommendation / executor). Mission:
// consume a fully-enriched prospect (pil_prospect_opportunities plus
// BEN-QLF-01/02/03/05's own detail-assessment rows, migration 165) and
// synthesize which request type + request_profiles row fits best, an
// estimated success probability, and the strategic reasoning, field
// mappings, pitch parameters, risk factors, and relationship strategy an
// APP-02 (Recommendation)/APP-03 (Executor) can act on downstream. This
// agent never places an ask or submits anything itself.
//
// See migration 167's own header for the two schema decisions this agent's
// existence required and why: (1) a new "application" pil_agent_registry
// family, since neither "qualification" (BEN-QLF-* already owns scoring/
// classification) nor "strategy" (BEN-STR-* already owns cultivation/next-
// best-action for an already-qualified opportunity) fits a "which request
// type/profile should we even aim at" decision; (2) app_recommendations is
// persisted to a new dedicated pil_application_profiles table rather than a
// pil_prospect_dossiers.app_recommendations JSONB column (the task spec's
// literal instruction) -- that table has no UPDATE policy at all and is
// explicitly append-only-by-new-version-row, and a prospect can match more
// than one request_profiles row at once ("Multi-profile queuing... return
// all with ranked scores"), which one JSONB column on one dossier row can't
// hold as independently rankable rows anyway. pil_application_profiles
// mirrors pil_mission_affinity_assessments/pil_capacity_propensity_
// assessments/pil_timing_readiness_assessments' exact convention instead:
// one dedicated table, org-scoped SELECT/INSERT only, found via
// (organization_id, prospect_id, computed_at DESC) -- except here, on
// purpose, MULTIPLE rows can share the same computed_at value (every
// candidate profile matched in one execute() call is inserted with one
// explicit `nowIso` timestamp), so a caller groups "this run's full ranked
// set" by exact timestamp equality rather than taking a single latest row.
//
// This agent does NOT parse pil_prospect_dossiers.dossier (BEN-SUP-08's
// narrative-synthesis jsonb blob) as its primary input, for the same reason
// BEN-STR-04 reads pil_prospect_opportunities directly rather than a
// dossier: the machine-readable per-dimension scores this agent's formula
// needs live on pil_prospect_opportunities and the BEN-QLF-01/03/05 detail
// tables, not inside a loosely-typed narrative blob meant for human/LLM
// narrative consumption.
//
// Formula (spec-given, applied exactly as the four-term weighted base
// score before any per-profile adjustment):
//   baseScore = capacity*0.3 + affinity*0.3 + relationship*0.2 + timing*0.2
// Each of the four 0-1 dimension inputs prefers a fresh sibling assessment
// over a same-agent-family fallback, in this order, mirroring BEN-QLF-04's
// own graceful-degradation hand-off chain:
//   affinity:     pil_mission_affinity_assessments.overall_score/100
//                 -> pil_prospect_opportunities.mission_affinity_score
//                 -> 0.5 fallback (delegates to BEN-QLF-01)
//   capacity:     pil_capacity_propensity_assessments.capacity_confidence
//                 -> 0.6 if pil_prospect_opportunities has a capacity range
//                    but no sibling detail row (a range exists, just not the
//                    full breakdown -- a real signal, not a fabrication)
//                 -> 0.5 fallback (delegates to BEN-QLF-03)
//   relationship: pil_timing_readiness_assessments.relationship_maturity_score/100
//                 -> BEN-QLF-04's own exported scoreRelationshipStrength()
//                    (pil_graph_edges.relationship_strength)
//                 -> 0.5 fallback (delegates to BEN-REL-06)
//   timing:       pil_timing_readiness_assessments.timing_status
//                 -> pil_prospect_opportunities.timing_status
//                 -> 0.5 fallback (delegates to BEN-QLF-05)
// Per constraint "If data insufficient for probability: use 0.5 with
// confidence=medium": no literal low/medium/high confidence enum exists
// anywhere in this schema (every sibling table uses a 0-1 numeric
// `confidence`, e.g. MissionAffinityAssessment.confidence,
// CapacityPropensityAssessment.capacity_confidence) -- so "medium" is
// represented the same way every sibling agent represents its own
// confidence: a numeric value, here `confidence = 1 - fallbackCount/4*0.5`,
// which is exactly 0.5 when all four dimensions fell back (the literal
// "insufficient data" case) and rises toward 1.0 as more dimensions are
// backed by real sibling data.
//
// Per-profile ranking ("Multi-profile queuing... return all with ranked
// scores"): baseScore alone is profile-agnostic (it says nothing about
// *this* profile's ask-size fit), so each matched request_profiles row gets
// its own successProbability = baseScore * capacityFitMultiplier(profile),
// where the multiplier checks whether pil_prospect_opportunities'
// capacity_estimate_low/high range overlaps the profile's own
// min_value/max_value (1.0 if it overlaps or the profile has no value
// bounds, 0.6 if it provably doesn't, 0.85 if capacity isn't estimated yet
// at all -- a documented heuristic discount, not a fabricated fact).
// Recommendations are then rank-ordered by this per-profile
// successProbability, descending, and relationship_strategy.sequence is
// that rank (1-based).
//
// Key logic / recommendation_status decision order (exactly the three rules
// given, checked in this order, first match wins; "submit" is the
// fallthrough):
//   1. successProbability < 0.5                              -> "monitor"
//   2. relationship < 0.3 AND no warm-introduction path found -> "research_more"
//   3. capacity >= 0.6 AND a denial-style claim is on record  -> "manual_review"
//   4. else                                                    -> "submit"
// "Warm-introduction path" is checked the only way this schema can answer
// it without fabricating a signal: a pil_graph_edges row with edge_type
// 'introduces_to' touching one of this prospect's own graph nodes
// (BEN-REL-05's own output edge_type). "Recent denial" / "CEO transition"
// risk factors have no dedicated schema column anywhere in this codebase
// (no MonitoringTriggerType value represents either), so both are detected
// by a keyword scan over this prospect's own pil_evidence claim/excerpt
// text -- documented explicitly here as an evidence-text heuristic, not a
// structured field, matching this file's "never fabricate, always trace to
// evidence" constraint (every risk factor traces to either a real evidence
// row's id, via evidence_refs, or a real dimension score computed above).
//
// request_profiles matching: request_profiles.request_type/
// target_funder_categories/target_funder_types are unconstrained free text
// (migration 051) -- normalizeRequestType() lower-cases/underscores a
// profile's request_type and only keeps it as a candidate if it lands on
// one of the real 8-value enum this agent's own output is CHECK-constrained
// to (monetary/land/in_kind/volunteer/service/partnership/sponsorship/
// facility); a profile whose request_type doesn't map to that enum is
// silently excluded rather than forced into an invalid output row.
// ProspectEntityType (migration 150) is lower_snake_case
// (individual/family_foundation/private_foundation/.../corporation/...),
// not the PERSON/COMPANY/FOUNDATION vocabulary this task's own framing used
// -- ENTITY_TYPE_TO_FUNDER_CATEGORY below maps every real entity_type value
// onto a coarse ("individual"/"foundation"/"corporation"/"other") category a
// request_profile's target_funder_types/target_funder_categories text
// arrays can reasonably be expected to use.
//
// Delegation: BEN-SUP-05 critic review fires for every "submit"
// recommendation (never self-certified, per this agent's own
// human_boundary in migration 167), matching BEN-QLF-04/BEN-STR-04's
// identical selective-critic-delegation convention. A createReviewItem()
// (review_type "high_impact_action") additionally fires for any "submit"
// recommendation at or above HUMAN_REVIEW_PROBABILITY_THRESHOLD. A
// BEN-REL-05 delegation fires when "research_more" was driven specifically
// by the low-relationship/no-warm-path rule. Any dimension that fell back
// to its 0.5 default delegates to the sibling that could supply a fresher
// assessment next run (BEN-QLF-01/03/05, BEN-REL-06), the same additive
// hand-off-delegation convention BEN-QLF-04 established.

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;
const FALLBACK_DIMENSION_SCORE = 0.5;
const CAPACITY_WEIGHT = 0.3;
const AFFINITY_WEIGHT = 0.3;
const RELATIONSHIP_WEIGHT = 0.2;
const TIMING_WEIGHT = 0.2;
const SUBMIT_THRESHOLD = 0.5;
const LOW_RELATIONSHIP_THRESHOLD = 0.3;
const HIGH_CAPACITY_THRESHOLD = 0.6;
const HUMAN_REVIEW_PROBABILITY_THRESHOLD = 0.75;
const CAPACITY_RANGE_WITHOUT_ASSESSMENT_SCORE = 0.6;
const UNKNOWN_CAPACITY_FIT_MULTIPLIER = 0.85;
const NON_OVERLAPPING_CAPACITY_FIT_MULTIPLIER = 0.6;
const TOKENS_PER_RECOMMENDATION = 250;

// Exported for BEN-APP-02's reuse (same "known real schema has no dedicated
// column for this signal" evidence-text-keyword-scan heuristic, applied to a
// different downstream decision -- see that file's own header).
export const DENIAL_KEYWORDS = ["denied", "declined", "rejected", "turned down"];
export const CEO_TRANSITION_KEYWORDS = [
  "ceo transition",
  "stepping down",
  "new ceo",
  "interim ceo",
  "leadership transition",
  "incoming ceo",
  "outgoing ceo",
];

export const VALID_REQUEST_TYPES: ReadonlySet<RequestType> = new Set<RequestType>([
  "monetary",
  "land",
  "in_kind",
  "volunteer",
  "service",
  "partnership",
  "sponsorship",
  "facility",
]);

const ENTITY_TYPE_TO_FUNDER_CATEGORY: Record<ProspectEntityType, string> = {
  individual: "individual",
  executive: "individual",
  business_owner: "individual",
  board_member: "individual",
  trustee: "individual",
  wealth_holder: "individual",
  community_leader: "individual",
  family_foundation: "foundation",
  private_foundation: "foundation",
  community_foundation: "foundation",
  corporate_foundation: "foundation",
  institutional_funder: "foundation",
  corporation: "corporation",
  other: "other",
};

const TIMING_STATUS_SCORE: Record<ProspectOpportunityTimingStatus, number> = {
  approach_now: 1,
  monitor: 0.7,
  cultivate_first: 0.4,
  defer: 0.1,
};

const TIMING_LABEL: Record<ProspectOpportunityTimingStatus, string> = {
  approach_now: "immediate",
  monitor: "monitor_ongoing",
  cultivate_first: "after_cultivation",
  defer: "deferred",
};

const FALLBACK_DELEGATION_TARGET: Record<string, string> = {
  affinity: "BEN-QLF-01",
  capacity: "BEN-QLF-03",
  relationship: "BEN-REL-06",
  timing: "BEN-QLF-05",
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// Exported for BEN-APP-02's reuse -- same evidence-text-keyword-scan
// convention this file established, applied there to a different keyword set.
export function scanEvidenceForKeywords(evidence: EvidenceItem[], keywords: string[]): boolean {
  return evidence.some((item) => {
    const haystack = `${item.claim} ${item.evidence_excerpt ?? ""}`.toLowerCase();
    return keywords.some((k) => haystack.includes(k));
  });
}

// Exported for BEN-APP-02's reuse -- identical 'introduces_to' edge query
// this file's own decideStatus()/relationship_strategy.first_contact logic
// already relies on, needed there for its own board-member-foundation
// strategic-bonus detector (see that file's header for why).
export async function hasWarmIntroPath(orgId: string, nodeIds: string[]): Promise<boolean> {
  if (nodeIds.length === 0) return false;
  const client = getPilClient();
  const [{ data: asSource, error: sourceError }, { data: asTarget, error: targetError }] = await Promise.all([
    client.from("pil_graph_edges").select("*").eq("organization_id", orgId).eq("is_current", true).eq("edge_type", "introduces_to").in("source_node_id", nodeIds),
    client.from("pil_graph_edges").select("*").eq("organization_id", orgId).eq("is_current", true).eq("edge_type", "introduces_to").in("target_node_id", nodeIds),
  ]);
  if (sourceError) throw sourceError;
  if (targetError) throw targetError;
  return ((asSource ?? []) as GraphEdge[]).length > 0 || ((asTarget ?? []) as GraphEdge[]).length > 0;
}

function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code: unknown }).code) : "";
  const message = "message" in err ? String((err as { message: unknown }).message) : "";
  return code === "42P01" || /relation .* does not exist/i.test(message) || /does not exist/i.test(message);
}

export interface ApplicationRecommendation {
  requestType: RequestType;
  requestProfileId: string;
  requestProfileName: string;
  successProbability: number;
  recommendationStatus: ApplicationRecommendationStatus;
  strategicReasoning: string;
  fieldMappings: Record<string, string>;
  pitchParameters: ApplicationProfilePitchParameters;
  riskFactors: ApplicationProfileRiskFactor[];
  relationshipStrategy: ApplicationProfileRelationshipStrategy;
  confidence: number;
  sequence: number;
}

export interface ApplicationProfileReport {
  prospectId: string;
  entityType: string;
  recommendations: ApplicationRecommendation[];
  dimensionScores: { capacity: number; affinity: number; relationship: number; timing: number };
  fallbackDimensions: string[];
  reviewsCreated: number;
}

export class ApplicationProfileOrchestratorAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completed({}, "BEN-APP-01 requires an existing prospectId");
    }
    const prospectId = context.prospectId;

    const prospect = await this.loadProspect(context.orgId, prospectId);
    if (!prospect) {
      return this.completed({}, `Prospect ${prospectId} not found`);
    }

    const activeProfiles = await this.loadActiveRequestProfiles(context.orgId);
    if (activeProfiles.length === 0) {
      return this.completed(
        { prospectId, recommendations: [] },
        "Organization has no active request_profiles rows to match against",
      );
    }

    const opportunity = await this.findOpportunity(context.orgId, prospectId);
    const evidence = await getEvidence(prospectId, context.orgId);

    const missionAffinity = await this.loadLatestAssessment<MissionAffinityAssessment>(
      "pil_mission_affinity_assessments",
      context.orgId,
      prospectId,
    );
    const fundingEligibility = await this.loadLatestAssessment<FundingEligibilityAssessment>(
      "pil_funding_eligibility_assessments",
      context.orgId,
      prospectId,
    );
    const capacityPropensity = await this.loadLatestAssessment<CapacityPropensityAssessment>(
      "pil_capacity_propensity_assessments",
      context.orgId,
      prospectId,
    );
    const timingReadiness = await this.loadLatestAssessment<TimingReadinessAssessment>(
      "pil_timing_readiness_assessments",
      context.orgId,
      prospectId,
    );

    const fallbackDimensions: string[] = [];

    let affinity = FALLBACK_DIMENSION_SCORE;
    if (missionAffinity) {
      affinity = clamp01(missionAffinity.overall_score / 100);
    } else if (opportunity?.mission_affinity_score != null) {
      affinity = clamp01(opportunity.mission_affinity_score);
    } else {
      fallbackDimensions.push("affinity");
    }

    let capacity = FALLBACK_DIMENSION_SCORE;
    if (capacityPropensity) {
      capacity = clamp01(capacityPropensity.capacity_confidence);
    } else if (opportunity?.capacity_estimate_low != null && opportunity?.capacity_estimate_high != null) {
      capacity = CAPACITY_RANGE_WITHOUT_ASSESSMENT_SCORE;
    } else {
      fallbackDimensions.push("capacity");
    }

    const nodes = await getNodesByProspect(prospectId, context.orgId);
    const warmIntroPath = nodes.length > 0 ? await hasWarmIntroPath(context.orgId, nodes.map((n) => n.id)) : false;

    let relationship = FALLBACK_DIMENSION_SCORE;
    if (timingReadiness?.relationship_maturity_score != null) {
      relationship = clamp01(timingReadiness.relationship_maturity_score / 100);
    } else {
      const relationshipStrengthScore = await scoreRelationshipStrength(context.orgId, prospectId);
      if (relationshipStrengthScore > 0) {
        relationship = clamp01(relationshipStrengthScore / 100);
      } else {
        fallbackDimensions.push("relationship");
      }
    }

    const timingStatus: ProspectOpportunityTimingStatus | null = timingReadiness?.timing_status ?? opportunity?.timing_status ?? null;
    let timing = FALLBACK_DIMENSION_SCORE;
    if (timingStatus) {
      timing = TIMING_STATUS_SCORE[timingStatus];
    } else {
      fallbackDimensions.push("timing");
    }

    const baseScore = clamp01(
      capacity * CAPACITY_WEIGHT + affinity * AFFINITY_WEIGHT + relationship * RELATIONSHIP_WEIGHT + timing * TIMING_WEIGHT,
    );
    const confidence = clamp01(1 - (fallbackDimensions.length / 4) * 0.5);

    const denialFlag = scanEvidenceForKeywords(evidence, DENIAL_KEYWORDS);
    const ceoTransitionFlag = scanEvidenceForKeywords(evidence, CEO_TRANSITION_KEYWORDS);
    const staleOrContradicted = evidence.filter((e) => e.freshness_status === "stale" || e.verification_status === "contradicted");

    const matchedProfiles = this.matchRequestProfiles(prospect.entity_type, activeProfiles);
    if (matchedProfiles.length === 0) {
      return this.completed(
        {
          prospectId,
          recommendations: [],
          dimensionScores: { capacity, affinity, relationship, timing },
          fallbackDimensions,
        },
        "No active request_profiles matched this prospect's entity_type/funder category",
      );
    }

    const ranked = matchedProfiles
      .map((profile) => ({
        profile,
        successProbability: Math.round(clamp01(baseScore * this.capacityFitMultiplier(opportunity, profile)) * 100) / 100,
      }))
      .sort((a, b) => b.successProbability - a.successProbability);

    const recommendations: ApplicationRecommendation[] = [];
    const rowsToInsert: Array<Omit<ApplicationProfile, "id" | "created_at">> = [];
    const nowIso = new Date().toISOString();

    for (let index = 0; index < ranked.length; index++) {
      const { profile, successProbability } = ranked[index]!;
      const sequence = index + 1;
      const requestType = this.normalizeRequestType(profile.request_type);
      if (!requestType) continue;

      const recommendationStatus = this.decideStatus({ successProbability, relationship, warmIntroPath, capacity, denialFlag });
      const riskFactors = this.buildRiskFactors({
        capacityPropensity,
        relationship,
        warmIntroPath,
        denialFlag,
        ceoTransitionFlag,
        staleOrContradicted,
      });
      const pitchParameters = this.buildPitchParameters({ affinity, relationship, timing, capacity, warmIntroPath, fundingEligibility, missionAffinity });
      const fieldMappings = this.buildFieldMappings({ prospect, opportunity, warmIntroPath, missionAffinity });
      const relationshipStrategy: ApplicationProfileRelationshipStrategy = {
        sequence,
        timing: timingStatus ? TIMING_LABEL[timingStatus] : "insufficient_data",
        first_contact: warmIntroPath ? "board_member_warm_intro" : "staff_direct_outreach",
        escalation_path: ["program_director", "executive_director", "cfo"],
      };
      const strategicReasoning = this.buildStrategicReasoning({ prospect, profile, successProbability, capacity, affinity, relationship, timing, opportunity });

      recommendations.push({
        requestType,
        requestProfileId: profile.id,
        requestProfileName: profile.name,
        successProbability,
        recommendationStatus,
        strategicReasoning,
        fieldMappings,
        pitchParameters,
        riskFactors,
        relationshipStrategy,
        confidence,
        sequence,
      });

      rowsToInsert.push({
        organization_id: context.orgId,
        prospect_id: prospectId,
        opportunity_id: opportunity?.id ?? null,
        request_type: requestType,
        request_profile_id: profile.id,
        success_probability: successProbability,
        recommendation_status: recommendationStatus,
        strategic_reasoning: strategicReasoning,
        field_mappings: fieldMappings,
        pitch_parameters: pitchParameters,
        risk_factors: riskFactors,
        relationship_strategy: relationshipStrategy,
        evidence_refs: evidence.map((e) => e.id),
        confidence,
        computed_by_agent_id: context.agentCode,
        computed_at: nowIso,
      });
    }

    await this.insertApplicationProfiles(rowsToInsert);

    const delegations: DelegationRequest[] = [];
    for (const dimension of fallbackDimensions) {
      const sibling = FALLBACK_DELEGATION_TARGET[dimension];
      if (sibling) {
        delegations.push({
          childAgentCode: sibling,
          objective: `No fresh assessment available for prospect ${prospectId}'s ${dimension} dimension; BEN-APP-01 fell back to a default ${FALLBACK_DIMENSION_SCORE} score this run.`,
          maxAutonomy: "A2",
          constraints: { prospectId, dimension },
        });
      }
    }

    let reviewsCreated = 0;
    for (const rec of recommendations) {
      if (rec.recommendationStatus === "submit") {
        delegations.push({
          childAgentCode: "BEN-SUP-05",
          objective: `Critic review for BEN-APP-01 "submit" recommendation (${rec.requestType}, profile ${rec.requestProfileId}) on prospect ${prospectId}`,
          maxAutonomy: "A2",
          constraints: { prospectId, requestProfileId: rec.requestProfileId },
        });
        if (rec.successProbability >= HUMAN_REVIEW_PROBABILITY_THRESHOLD) {
          await createReviewItem({
            organization_id: context.orgId,
            review_type: "high_impact_action",
            subject_type: "pil_application_profiles",
            subject_id: prospectId,
            requested_by_agent_id: context.agentCode,
            priority: "high",
            status: "pending",
            summary: `BEN-APP-01 recommends "submit" for prospect ${prospectId} via request_profile "${rec.requestProfileName}" (success_probability ${rec.successProbability}).`,
            evidence_refs: evidence.map((e) => e.id),
            assigned_to_user_id: null,
            resolved_at: null,
          });
          reviewsCreated++;
        }
      }
      if (rec.recommendationStatus === "research_more" && relationship < LOW_RELATIONSHIP_THRESHOLD && !warmIntroPath) {
        delegations.push({
          childAgentCode: "BEN-REL-05",
          objective: `Prospect ${prospectId} has low relationship maturity and no known warm-introduction path; BEN-APP-01 recommends research before outreach.`,
          maxAutonomy: "A2",
          constraints: { prospectId },
        });
      }
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "application_profile.recommended",
      resource_type: "pil_application_profiles",
      resource_id: prospectId,
      before_state: null,
      after_state: {
        recommendations: recommendations.map((r) => ({ requestType: r.requestType, status: r.recommendationStatus, successProbability: r.successProbability })),
      },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, recommendations.length * TOKENS_PER_RECOMMENDATION);

    const report: ApplicationProfileReport = {
      prospectId,
      entityType: prospect.entity_type,
      recommendations,
      dimensionScores: { capacity, affinity, relationship, timing },
      fallbackDimensions,
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

  private decideStatus(params: {
    successProbability: number;
    relationship: number;
    warmIntroPath: boolean;
    capacity: number;
    denialFlag: boolean;
  }): ApplicationRecommendationStatus {
    const { successProbability, relationship, warmIntroPath, capacity, denialFlag } = params;
    if (successProbability < SUBMIT_THRESHOLD) return "monitor";
    if (relationship < LOW_RELATIONSHIP_THRESHOLD && !warmIntroPath) return "research_more";
    if (capacity >= HIGH_CAPACITY_THRESHOLD && denialFlag) return "manual_review";
    return "submit";
  }

  private capacityFitMultiplier(opportunity: ProspectOpportunity | null, profile: RequestProfile): number {
    if (opportunity?.capacity_estimate_low == null || opportunity?.capacity_estimate_high == null) {
      return UNKNOWN_CAPACITY_FIT_MULTIPLIER;
    }
    if (profile.min_value == null && profile.max_value == null) return 1;
    const min = profile.min_value ?? 0;
    const max = profile.max_value ?? Number.POSITIVE_INFINITY;
    const overlaps = opportunity.capacity_estimate_high >= min && opportunity.capacity_estimate_low <= max;
    return overlaps ? 1 : NON_OVERLAPPING_CAPACITY_FIT_MULTIPLIER;
  }

  private buildRiskFactors(params: {
    capacityPropensity: CapacityPropensityAssessment | null;
    relationship: number;
    warmIntroPath: boolean;
    denialFlag: boolean;
    ceoTransitionFlag: boolean;
    staleOrContradicted: EvidenceItem[];
  }): ApplicationProfileRiskFactor[] {
    const { capacityPropensity, relationship, warmIntroPath, denialFlag, ceoTransitionFlag, staleOrContradicted } = params;
    const factors: ApplicationProfileRiskFactor[] = [];

    if (!capacityPropensity || capacityPropensity.propensity_score === 0) {
      factors.push({
        factor: "no_giving_history",
        mitigation: warmIntroPath
          ? "No documented giving history, but a warm introduction path exists -- proceed via that relationship rather than a cold ask."
          : "No documented giving history and no known warm introduction path -- cultivate before soliciting.",
      });
    }
    if (relationship < LOW_RELATIONSHIP_THRESHOLD && !warmIntroPath) {
      factors.push({
        factor: "weak_relationship_no_warm_path",
        mitigation: "Establish a relationship (BEN-REL-05 warm-introduction pathfinding) before any direct outreach.",
      });
    }
    if (denialFlag) {
      factors.push({
        factor: "prior_denial_on_record",
        mitigation: "Evidence on file references a prior denial/decline -- reassess eligibility and timing before resubmitting.",
      });
    }
    if (ceoTransitionFlag) {
      factors.push({
        factor: "leadership_transition_pending",
        mitigation: "Evidence on file references a pending leadership transition -- wait for the transition to settle before outreach.",
      });
    }
    if (staleOrContradicted.length > 0) {
      factors.push({
        factor: "stale_or_contradicted_evidence",
        mitigation: "Some supporting evidence is stale or contradicted -- delegate to BEN-KNW-04 for a freshness/contradiction re-check before relying on it.",
      });
    }
    return factors;
  }

  private buildPitchParameters(params: {
    affinity: number;
    relationship: number;
    timing: number;
    capacity: number;
    warmIntroPath: boolean;
    fundingEligibility: FundingEligibilityAssessment | null;
    missionAffinity: MissionAffinityAssessment | null;
  }): ApplicationProfilePitchParameters {
    const { affinity, relationship, timing, capacity, warmIntroPath, fundingEligibility, missionAffinity } = params;
    const emphasis: string[] = [];
    if (affinity >= HIGH_CAPACITY_THRESHOLD) emphasis.push("mission_alignment");
    if (capacity >= HIGH_CAPACITY_THRESHOLD) emphasis.push("capacity_fit");
    if (relationship >= HIGH_CAPACITY_THRESHOLD) emphasis.push("existing_relationship");
    if (timing >= HIGH_CAPACITY_THRESHOLD) emphasis.push("timing_urgency");
    if (emphasis.length === 0) emphasis.push("general_impact");

    const avoid: string[] = [...(fundingEligibility?.disqualifying_reasons ?? []), ...(missionAffinity?.counterevidence ?? [])];
    const tone = relationship >= HIGH_CAPACITY_THRESHOLD ? "partnership, not transaction" : warmIntroPath ? "warm introduction" : "formal, evidence-led approach";

    return { emphasis, avoid, tone };
  }

  private buildFieldMappings(params: {
    prospect: Prospect;
    opportunity: ProspectOpportunity | null;
    warmIntroPath: boolean;
    missionAffinity: MissionAffinityAssessment | null;
  }): Record<string, string> {
    const { prospect, opportunity, warmIntroPath, missionAffinity } = params;
    return {
      entity_type: prospect.entity_type,
      donation_amount:
        opportunity?.capacity_estimate_low != null && opportunity?.capacity_estimate_high != null
          ? `${opportunity.capacity_estimate_low}-${opportunity.capacity_estimate_high}`
          : "insufficient_data",
      contact_strategy: warmIntroPath ? "warm_intro_via_board_or_network_connection" : "insufficient_data",
      mission_alignment_summary:
        missionAffinity && missionAffinity.overall_score > 0 ? `Overall mission-affinity score ${missionAffinity.overall_score}/100` : "insufficient_data",
    };
  }

  private buildStrategicReasoning(params: {
    prospect: Prospect;
    profile: RequestProfile;
    successProbability: number;
    capacity: number;
    affinity: number;
    relationship: number;
    timing: number;
    opportunity: ProspectOpportunity | null;
  }): string {
    const { prospect, profile, successProbability, capacity, affinity, relationship, timing, opportunity } = params;
    const capacityText =
      opportunity?.capacity_estimate_low != null && opportunity?.capacity_estimate_high != null
        ? `estimated capacity $${opportunity.capacity_estimate_low}-$${opportunity.capacity_estimate_high}`
        : "capacity not yet established";
    return `${prospect.display_name} (${prospect.entity_type}) matched against request_profile "${profile.name}" (${profile.request_type}): ${capacityText}, mission-affinity ${Math.round(
      affinity * 100,
    )}/100, relationship ${Math.round(relationship * 100)}/100, timing ${Math.round(timing * 100)}/100, capacity ${Math.round(
      capacity * 100,
    )}/100 -> weighted success_probability ${successProbability}.`;
  }

  private normalizeRequestType(raw: string): RequestType | null {
    const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
    return VALID_REQUEST_TYPES.has(normalized as RequestType) ? (normalized as RequestType) : null;
  }

  private matchRequestProfiles(entityType: ProspectEntityType, profiles: RequestProfile[]): RequestProfile[] {
    const category = ENTITY_TYPE_TO_FUNDER_CATEGORY[entityType];
    return profiles.filter((profile) => {
      if (!this.normalizeRequestType(profile.request_type)) return false;
      const typesMatch =
        !profile.target_funder_types ||
        profile.target_funder_types.length === 0 ||
        profile.target_funder_types.some((t) => t.toLowerCase() === entityType || t.toLowerCase() === category);
      const categoriesMatch =
        !profile.target_funder_categories || profile.target_funder_categories.length === 0 || profile.target_funder_categories.some((c) => c.toLowerCase() === category);
      return typesMatch && categoriesMatch;
    });
  }

  private async loadProspect(orgId: string, prospectId: string): Promise<Prospect | null> {
    const { data, error } = await getPilClient().from("pil_prospects").select("*").eq("organization_id", orgId).eq("id", prospectId).maybeSingle();
    if (error) throw error;
    return (data as Prospect | null) ?? null;
  }

  private async findOpportunity(orgId: string, prospectId: string): Promise<ProspectOpportunity | null> {
    const { data, error } = await getPilClient().from("pil_prospect_opportunities").select("*").eq("organization_id", orgId).eq("prospect_id", prospectId).maybeSingle();
    if (error) throw error;
    return (data as ProspectOpportunity | null) ?? null;
  }

  private async loadActiveRequestProfiles(orgId: string): Promise<RequestProfile[]> {
    const { data, error } = await getPilClient().from("request_profiles").select("*").eq("organization_id", orgId).eq("active", true);
    if (error) throw error;
    return (data ?? []) as RequestProfile[];
  }

  // Shared by all four sibling detail-assessment reads, same "latest row for
  // this prospect" query BEN-QLF-04/BEN-QLF-03/BEN-QLF-05 already use for
  // their own cross-sibling reads.
  private async loadLatestAssessment<T>(table: string, orgId: string, prospectId: string): Promise<T | null> {
    const { data, error } = await getPilClient().from(table).select("*").eq("organization_id", orgId).eq("prospect_id", prospectId).order("computed_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return (data as T | null) ?? null;
  }

  // Wrapped per BEN-STR-04's convention: a missing-table/relation error is
  // treated as a no-op rather than crashing, since this queue's prompts may
  // not all have executed yet in every environment this agent could run in.
  private async insertApplicationProfiles(rows: Array<Omit<ApplicationProfile, "id" | "created_at">>): Promise<void> {
    if (rows.length === 0) return;
    try {
      const { error } = await getPilClient().from("pil_application_profiles").insert(rows);
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

export default ApplicationProfileOrchestratorAgent;
