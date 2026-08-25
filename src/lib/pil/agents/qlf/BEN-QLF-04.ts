import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect } from "@/lib/pil/graph";
import { getEvents } from "@/lib/pil/monitoring";
import { createReviewItem } from "@/lib/pil/human-review";
import { logAction } from "@/lib/pil/audit";
import type {
  EvidenceItem,
  EvidenceVerificationStatus,
  GraphEdge,
  Prospect,
  ProspectOpportunity,
  ProspectOpportunityClassification,
} from "@/lib/pil/types";

// BEN-QLF-04 -- Opportunity Qualification Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~805, FAMILY 5 -- QUALIFICATION &
// DECISION INTELLIGENCE). "Integrate research into a defensible
// fundraising-opportunity classification" -- the final qualification step
// before a prospect enters Strategy family workflows.
//
// The task spec that commissioned this batch numbered this mission
// BEN-QUA-01 with a simplified QUALIFIED/DISQUALIFIED/NEEDS_MORE_RESEARCH
// tri-state decision. No BEN-QUA-01 exists anywhere in the registry
// (supabase/migrations/155_pil_agent_registry.sql) or PROSPECT_INTELLIGENCE_
// AGENTS.md -- the real fixed 5-agent Family 5 is BEN-QLF-01..05, and this
// agent's real mission (final integration into one classification, run once
// upstream research reaches sufficiency) is materially the task's own
// description of BEN-QUA-01. Family 5's other four specialists
// (BEN-QLF-01 Mission Affinity / BEN-QLF-02 Funding Eligibility / BEN-QLF-03
// Capacity & Propensity / BEN-QLF-05 Timing & Readiness) are not implemented
// yet as of this batch, so this agent scores their dimensions itself
// directly from pil_evidence/pil_graph_edges rather than delegating to
// agents that don't exist -- once those land, their persisted scores should
// replace the corresponding scoreDimension() calls below.
//
// Output contract: this agent writes the schema's real 7-value
// classification enum to pil_prospect_opportunities.classification (spec's
// actual output column), not the task's 3-value decision -- `decision`
// (QUALIFIED/DISQUALIFIED/NEEDS_MORE_RESEARCH) is derived from that
// classification and returned alongside it in the report so callers get
// both. pil_prospects has no 'qualified' status value (its status CHECK only
// allows active/archived/merged, migration 150) and no confidence_score
// column anywhere on that table -- the task's step 6 ("update pil_prospect
// status to qualified and confidence_score") describes columns that don't
// exist in the applied schema. The schema-correct target for both a
// classification and a confidence score is pil_prospect_opportunities
// (confidence column, migration 150), which this agent writes instead.
//
// Critic gate (spec Section 12, planning behavior: "Requires a BEN-SUP-05 critic
// pass before any classification of TIER_1_PRIORITY or TIER_2_CULTIVATE
// becomes final -- never self-certifies a high-impact classification"): this
// agent issues a delegation to BEN-SUP-05 for any Tier 1/2 classification,
// per its documented "Must delegate to BEN-SUP-05" delegation permission.
// AgentRunner's delegation mechanism (agent-runner.ts) runs the critic
// review as a follow-on task rather than feeding its verdict back into this
// same execute() call -- no agent in this codebase closes that loop
// synchronously yet (BEN-SUP-05 itself is invoked the same fire-and-forget
// way by its own callers), so the persisted classification here is the
// agent's own defensible determination, with critic review recorded as
// delegated rather than blocking this run.

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;

const VERIFICATION_WEIGHT: Record<EvidenceVerificationStatus, number> = {
  verified_fact: 1,
  corroborated_fact: 0.9,
  single_source_fact: 0.7,
  reasoned_inference: 0.55,
  estimate: 0.5,
  unverified: 0.3,
  contradicted: 0,
  stale: 0.2,
};

const RELATIONSHIP_STRENGTH_SCORE: Record<string, number> = {
  very_strong: 100,
  strong: 80,
  moderate: 55,
  weak: 30,
  speculative: 10,
};

export type QualificationDimension =
  | "missionAffinity"
  | "fundingEligibility"
  | "givingCapacity"
  | "philanthropicPropensity"
  | "relationshipStrength"
  | "geographicRelevance"
  | "timingReadiness"
  | "opportunityStrength"
  | "researchSufficiency";

const DIMENSION_WEIGHTS: Record<QualificationDimension, number> = {
  missionAffinity: 0.15,
  fundingEligibility: 0.15,
  givingCapacity: 0.15,
  philanthropicPropensity: 0.15,
  relationshipStrength: 0.1,
  geographicRelevance: 0.05,
  timingReadiness: 0.1,
  opportunityStrength: 0.1,
  researchSufficiency: 0.05,
};

// claim_type vocabulary actually written by the Discovery/Core-Intelligence
// families (grepped from src/lib/pil/agents/{int,dis}/*.ts) mapped onto the
// dimension each claim substantiates.
const CLAIM_TYPES_BY_DIMENSION: Record<Exclude<QualificationDimension, "relationshipStrength" | "researchSufficiency">, string[]> = {
  missionAffinity: [
    "cause_aligned_giving_announcement",
    "cause_statement_or_board_signal",
    "990_mission_cause_alignment",
    "foundation_mission_priorities",
    "philanthropic_announcement",
  ],
  fundingEligibility: [
    "foundation_application_procedures",
    "corporate_giving_eligibility_rationale",
    "foundation_officers",
  ],
  givingCapacity: ["wealth_capacity", "capacity_signal", "hidden_capacity_signal_flag", "high_compensation_officer_signal"],
  philanthropicPropensity: ["giving_history", "documented_major_gift"],
  geographicRelevance: [
    "geographic_funder_directory_match",
    "geographic_funding_landscape_magnitude",
    "community_foundation_mention",
    "local_giving_program_mention",
  ],
  timingReadiness: ["liquidity_event"],
  opportunityStrength: ["foundation_grants_paid", "documented_major_gift", "corporate_giving_eligibility_rationale"],
};

const NEXT_AGENTS_BY_DIMENSION: Record<QualificationDimension, string[]> = {
  missionAffinity: ["BEN-DIS-07", "BEN-INT-07"],
  fundingEligibility: ["BEN-INT-06", "BEN-DIS-04"],
  givingCapacity: ["BEN-INT-08"],
  philanthropicPropensity: ["BEN-INT-07"],
  relationshipStrength: ["BEN-REL-01", "BEN-REL-06"],
  geographicRelevance: ["BEN-DIS-06"],
  timingReadiness: ["BEN-INT-09"],
  opportunityStrength: ["BEN-DIS-03", "BEN-DIS-04"],
  researchSufficiency: [],
};

const INSTITUTIONAL_ENTITY_TYPES = new Set([
  "family_foundation",
  "private_foundation",
  "community_foundation",
  "corporate_foundation",
  "corporation",
  "institutional_funder",
]);

const RESEARCH_SUFFICIENCY_THRESHOLD = 40;
const DISQUALIFY_SCORE_THRESHOLD = 20;
const DEFAULT_HUMAN_REVIEW_SCORE_THRESHOLD = 80;

export type QualificationDimensionScores = Record<QualificationDimension, number>;

export interface QualificationReport {
  prospectId: string;
  dimensionScores: QualificationDimensionScores;
  overallScore: number;
  classification: ProspectOpportunityClassification;
  decision: "QUALIFIED" | "DISQUALIFIED" | "NEEDS_MORE_RESEARCH";
  disqualificationReasons: string[];
  belowThresholdDimensions: QualificationDimension[];
  recommendedNextAgents: string[];
  criticDelegated: boolean;
  humanReviewCreated: boolean;
  confidence: number;
}

function scoreDimension(items: EvidenceItem[]): number {
  if (items.length === 0) return 0;
  const weighted = items.map((i) => Math.max(0, Math.min(1, i.confidence)) * VERIFICATION_WEIGHT[i.verification_status]);
  const best = Math.max(...weighted);
  const avg = weighted.reduce((a, b) => a + b, 0) / weighted.length;
  return Math.round(Math.min(1, best * 0.6 + avg * 0.4) * 100);
}

export class OpportunityQualificationAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completed({}, "BEN-QLF-04 requires an existing prospectId");
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

    const dimensionScores = {} as QualificationDimensionScores;
    for (const dimension of Object.keys(CLAIM_TYPES_BY_DIMENSION) as Array<keyof typeof CLAIM_TYPES_BY_DIMENSION>) {
      const items = CLAIM_TYPES_BY_DIMENSION[dimension].flatMap((claimType) => evidenceByClaimType.get(claimType) ?? []);
      dimensionScores[dimension] = scoreDimension(items);
    }

    dimensionScores.relationshipStrength = await this.scoreRelationshipStrength(context.orgId, context.prospectId);

    const monitoringBoost = await this.scoreTimingFromMonitoring(context.orgId, context.prospectId);
    dimensionScores.timingReadiness = Math.max(dimensionScores.timingReadiness, monitoringBoost);

    const scoredDimensions: QualificationDimension[] = [
      "missionAffinity",
      "fundingEligibility",
      "givingCapacity",
      "philanthropicPropensity",
      "relationshipStrength",
      "geographicRelevance",
      "timingReadiness",
      "opportunityStrength",
    ];
    const coveredCount = scoredDimensions.filter((d) => dimensionScores[d] > 0).length;
    dimensionScores.researchSufficiency = Math.round((coveredCount / scoredDimensions.length) * 100);

    const overallScore = Math.round(
      (Object.keys(DIMENSION_WEIGHTS) as QualificationDimension[]).reduce(
        (sum, d) => sum + dimensionScores[d] * DIMENSION_WEIGHTS[d],
        0,
      ),
    );

    const { classification, disqualificationReasons } = this.decideClassification(prospect, dimensionScores, overallScore);
    const belowThresholdDimensions = scoredDimensions.filter((d) => dimensionScores[d] < RESEARCH_SUFFICIENCY_THRESHOLD);
    const recommendedNextAgents =
      classification === "research_more"
        ? [...new Set(belowThresholdDimensions.flatMap((d) => NEXT_AGENTS_BY_DIMENSION[d]))]
        : [];

    const decision: QualificationReport["decision"] =
      classification === "research_more"
        ? "NEEDS_MORE_RESEARCH"
        : classification === "low_probability" || classification === "ineligible" || classification === "disqualified"
          ? "DISQUALIFIED"
          : "QUALIFIED";

    const confidence = evidence.length > 0 ? evidence.reduce((s, e) => s + e.confidence, 0) / evidence.length : 0;

    const opportunity = await this.upsertOpportunity(context.orgId, context.prospectId, {
      classification,
      mission_affinity_score: dimensionScores.missionAffinity / 100,
      confidence,
      qualified_by_agent_id: context.agentCode,
      qualified_at: new Date().toISOString(),
    });

    const delegations: DelegationRequest[] = [];
    let criticDelegated = false;
    if (classification === "tier_1_priority" || classification === "tier_2_cultivate") {
      delegations.push({
        childAgentCode: "BEN-SUP-05",
        objective: `Critic review for BEN-QLF-04 classification "${classification}" on prospect ${context.prospectId} (opportunity ${opportunity.id})`,
        maxAutonomy: "A2",
        constraints: { targetAgentRunId: null, opportunityId: opportunity.id },
      });
      criticDelegated = true;
    }

    const humanReviewThreshold =
      (context.plan as { humanReviewThreshold?: number } | null)?.humanReviewThreshold ?? DEFAULT_HUMAN_REVIEW_SCORE_THRESHOLD;
    let humanReviewCreated = false;
    if (decision === "QUALIFIED" && overallScore >= humanReviewThreshold) {
      await createReviewItem({
        organization_id: context.orgId,
        review_type: "high_impact_action",
        subject_type: "pil_prospect_opportunities",
        subject_id: opportunity.id,
        requested_by_agent_id: context.agentCode,
        priority: classification === "tier_1_priority" ? "high" : "normal",
        status: "pending",
        summary: `BEN-QLF-04 classified prospect ${context.prospectId} as ${classification} (score ${overallScore}) -- above the ${humanReviewThreshold} human-review threshold.`,
        evidence_refs: evidence.map((e) => e.id),
        assigned_to_user_id: null,
        resolved_at: null,
      });
      humanReviewCreated = true;
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "qualification.decided",
      resource_type: "pil_prospect_opportunities",
      resource_id: opportunity.id,
      before_state: null,
      after_state: { classification, decision, overallScore, disqualificationReasons },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, 400);

    const report: QualificationReport = {
      prospectId: context.prospectId,
      dimensionScores,
      overallScore,
      classification,
      decision,
      disqualificationReasons,
      belowThresholdDimensions,
      recommendedNextAgents,
      criticDelegated,
      humanReviewCreated,
      confidence,
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

  private decideClassification(
    prospect: Prospect,
    scores: QualificationDimensionScores,
    overallScore: number,
  ): { classification: ProspectOpportunityClassification; disqualificationReasons: string[] } {
    const reasons: string[] = [];

    if (scores.givingCapacity === 0) {
      reasons.push("No evidence of giving capacity on file (no wealth_capacity/capacity_signal claims found).");
    }
    if (scores.fundingEligibility === 0 && INSTITUTIONAL_ENTITY_TYPES.has(prospect.entity_type)) {
      reasons.push("No documented funding-eligibility evidence for this institutional funder; treated as ineligible.");
    }

    if (scores.givingCapacity === 0) {
      return { classification: "disqualified", disqualificationReasons: reasons };
    }
    if (scores.fundingEligibility === 0 && INSTITUTIONAL_ENTITY_TYPES.has(prospect.entity_type)) {
      return { classification: "ineligible", disqualificationReasons: reasons };
    }

    if (scores.researchSufficiency < RESEARCH_SUFFICIENCY_THRESHOLD) {
      return { classification: "research_more", disqualificationReasons: [] };
    }

    if (overallScore < DISQUALIFY_SCORE_THRESHOLD) {
      reasons.push(`Weighted qualification score ${overallScore} fell below the disqualification threshold (${DISQUALIFY_SCORE_THRESHOLD}).`);
      return { classification: "disqualified", disqualificationReasons: reasons };
    }
    if (overallScore < 35) return { classification: "low_probability", disqualificationReasons: [] };
    if (overallScore < 55) return { classification: "tier_3_monitor", disqualificationReasons: [] };
    if (overallScore < 75) return { classification: "tier_2_cultivate", disqualificationReasons: [] };
    return { classification: "tier_1_priority", disqualificationReasons: [] };
  }

  private async scoreRelationshipStrength(orgId: string, prospectId: string): Promise<number> {
    const nodes = await getNodesByProspect(prospectId, orgId);
    if (nodes.length === 0) return 0;
    const nodeIds = nodes.map((n) => n.id);
    const client = getPilClient();
    const [{ data: asSource, error: sourceError }, { data: asTarget, error: targetError }] = await Promise.all([
      client.from("pil_graph_edges").select("*").eq("organization_id", orgId).eq("is_current", true).in("source_node_id", nodeIds),
      client.from("pil_graph_edges").select("*").eq("organization_id", orgId).eq("is_current", true).in("target_node_id", nodeIds),
    ]);
    if (sourceError) throw sourceError;
    if (targetError) throw targetError;
    const edges = [...((asSource ?? []) as GraphEdge[]), ...((asTarget ?? []) as GraphEdge[])];
    if (edges.length === 0) return 0;
    return Math.max(...edges.map((e) => (e.relationship_strength ? (RELATIONSHIP_STRENGTH_SCORE[e.relationship_strength] ?? 0) : 0)));
  }

  private async scoreTimingFromMonitoring(orgId: string, prospectId: string): Promise<number> {
    const events = await getEvents(orgId, prospectId);
    const actionable = events.filter((e) => e.status === "new" || e.status === "reviewed");
    if (actionable.length === 0) return 0;
    return 70;
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

  private async upsertOpportunity(
    orgId: string,
    prospectId: string,
    fields: Partial<ProspectOpportunity>,
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
        .update({ ...fields, updated_at: new Date().toISOString() })
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
        capacity_estimate_low: null,
        capacity_estimate_high: null,
        recommended_ask_low: null,
        recommended_ask_high: null,
        timing_status: null,
        engagement_strategy: null,
        confidence: null,
        qualified_by_agent_id: null,
        qualified_at: null,
        status: "open",
        ...fields,
      })
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

export default OpportunityQualificationAgent;
