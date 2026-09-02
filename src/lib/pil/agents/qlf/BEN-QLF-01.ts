import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { logAction } from "@/lib/pil/audit";
import {
  CLAIM_TYPES_BY_DIMENSION,
  INSTITUTIONAL_ENTITY_TYPES,
  scoreDimension,
  VERIFICATION_WEIGHT,
} from "@/lib/pil/agents/qlf/BEN-QLF-04";
import type { EvidenceItem, MissionAffinityAssessment, Prospect, ProspectOpportunity } from "@/lib/pil/types";

// BEN-QLF-01 -- Mission Affinity Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~742, FAMILY 5 -- QUALIFICATION &
// DECISION INTELLIGENCE). Mission (pil_agent_registry, migration 155):
// "Determine how strongly documented philanthropic behavior aligns with the
// tenant mission." Default autonomy A2. Cadence: "On demand, once Family
// 3/4 research reaches sufficiency for a prospect."
//
// This is one of Family 5's four specialists BEN-QLF-04's own header
// comment names as not-yet-implemented placeholders it scores itself
// directly ("once those land, their persisted scores should replace the
// corresponding scoreDimension() calls below"). Landing this agent does not
// itself rewire BEN-QLF-04 -- that is a separate, later prompt in this same
// queue (pil-qlf-04-upgrade) -- but this file's output is deliberately
// shaped for that prompt to consume: a single blended score on
// pil_prospect_opportunities.mission_affinity_score (the same column
// BEN-QLF-04 already writes, so a future caller can simply stop
// self-scoring that column) plus a full per-dimension breakdown row in the
// new pil_mission_affinity_assessments table (migration 165) so the
// consuming prompt -- and any human reviewer -- can see which evidence
// drove the number, not just the number itself.
//
// Spec's six named dimensions (PROSPECT_INTELLIGENCE_AGENTS.md section
// BEN-QLF-01): Cause Alignment, Population Alignment, Program Alignment,
// Geographic Alignment, Recency, Counterevidence. This is the real
// difference from BEN-QLF-04's single blended `missionAffinity` number --
// BEN-QLF-04 folds cause/program signals into one dimension and has no
// notion of population alignment, recency decay, or a counterevidence
// penalty at all. BEN-QLF-01 scores each one individually:
//
//   - Cause Alignment: scoreDimension() over the 3 claim types BEN-QLF-04's
//     own CLAIM_TYPES_BY_DIMENSION.missionAffinity uses for direct
//     cause-giving signals (cause_aligned_giving_announcement,
//     cause_statement_or_board_signal, 990_mission_cause_alignment).
//   - Program Alignment: scoreDimension() over the remaining 2
//     missionAffinity claim types, which describe a funder's own stated
//     program priorities rather than a prospect's giving act
//     (foundation_mission_priorities, philanthropic_announcement).
//   - Geographic Alignment: scoreDimension() over BEN-QLF-04's
//     CLAIM_TYPES_BY_DIMENSION.geographicRelevance claim types verbatim.
//   - Recency: NOT an evidence-confidence score at all -- a decay curve
//     over the freshest contributing item's published_at (falling back to
//     retrieved_at), 100 at 0 days old down to 0 at 730 days old. The
//     freshest item, not the average, sets this dimension: one recent
//     signal is enough to say affinity information is current.
//   - Population Alignment: see the note below -- always unscored in this
//     build, deliberately, rather than fabricated.
//   - Counterevidence: not a fifth score to average in -- a penalty. Any
//     evidence item among the 5 real missionAffinity claim types (cause +
//     program combined) with contradiction_status='contradicted' costs the
//     overall score 10 points and is listed by id, mirroring the spec's
//     "Observation behavior: checks for contradicting evidence... before
//     finalizing."
//
// Population Alignment -- schema finding, not a placeholder gap: this
// agent's own instructions required checking whether a real tenant-declared
// target-population field exists before scoring against it.
// organizations.target_population (migration 001_initial_schema.sql line
// 113) DOES exist as a free-text column -- but grepping every claim_type
// string actually written by the Discovery/Core-Intelligence families
// (src/lib/pil/agents/{dis,int}/*.ts, the same vocabulary BEN-QLF-04's
// CLAIM_TYPES_BY_DIMENSION draws from) turns up zero claim types about
// population served, beneficiary demographics, or similar -- there is no
// pil_evidence-side taxonomy this agent could score a prospect against
// without inventing one from nothing. Per this build's standing rule
// against fabricating a taxonomy the schema doesn't have,
// populationAlignmentScore is always 0 here and always listed in
// `unscoredDimensions`, and is excluded from the overall-score average
// (mirroring BEN-QLF-04's own coveredCount/researchSufficiency pattern of a
// dynamic denominator over only the dimensions that actually have data) --
// not silently averaged in as a misleading 0.
//
// Delegation (spec has "Delegation permissions: none" for THIS agent's own
// classification decision, but the commissioning task additionally
// specifies real upstream-evidence-gap delegations distinct from that
// no-self-certification rule): pushes to BEN-KNW-03 (evidence-quality
// verification) when the VERIFICATION_WEIGHT-weighted average confidence
// across every item that contributed to a score is below 0.6; to BEN-INT-07
// when zero giving-history evidence exists for this prospect at all; and to
// BEN-INT-06 when zero foundation-adjacent evidence exists AND the prospect
// is one of BEN-QLF-04's INSTITUTIONAL_ENTITY_TYPES (an individual donor
// with no foundation evidence is not a gap; an un-researched foundation is).

const MODEL_TOKEN_UNIT_COST_USD = 0.00002;
const RECENCY_DECAY_WINDOW_DAYS = 730;
const LOW_CONFIDENCE_DELEGATION_THRESHOLD = 0.6;
const COUNTEREVIDENCE_PENALTY_PER_ITEM = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface MissionAffinityReport {
  prospectId: string;
  causeAlignmentScore: number;
  populationAlignmentScore: number;
  programAlignmentScore: number;
  geographicAlignmentScore: number;
  recencyScore: number;
  overallScore: number;
  counterevidence: string[];
  unscoredDimensions: string[];
  evidenceRefs: string[];
  confidence: number;
  delegatedToKnw03: boolean;
  delegatedToInt07: boolean;
  delegatedToInt06: boolean;
}

function recencyOf(item: EvidenceItem): number {
  const dateStr = item.published_at ?? item.retrieved_at;
  const ageMs = Date.now() - new Date(dateStr).getTime();
  const ageDays = ageMs / MS_PER_DAY;
  if (ageDays <= 0) return 100;
  if (ageDays >= RECENCY_DECAY_WINDOW_DAYS) return 0;
  return Math.round(100 - (ageDays / RECENCY_DECAY_WINDOW_DAYS) * 100);
}

function weightedConfidence(item: EvidenceItem): number {
  return Math.max(0, Math.min(1, item.confidence)) * VERIFICATION_WEIGHT[item.verification_status];
}

export class MissionAffinityAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completed({}, "BEN-QLF-01 requires an existing prospectId");
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

    const [missionCauseType, missionCauseStatementType, mission990Type, missionProgramType, missionAnnouncementType] =
      CLAIM_TYPES_BY_DIMENSION.missionAffinity;

    const causeClaimTypes = [missionCauseType!, missionCauseStatementType!, mission990Type!];
    const programClaimTypes = [missionProgramType!, missionAnnouncementType!];
    const geographicClaimTypes = CLAIM_TYPES_BY_DIMENSION.geographicRelevance;

    const causeItems = byClaimTypes(causeClaimTypes);
    const programItems = byClaimTypes(programClaimTypes);
    const geographicItems = byClaimTypes(geographicClaimTypes);
    const missionAffinityItems = byClaimTypes(CLAIM_TYPES_BY_DIMENSION.missionAffinity);

    const causeAlignmentScore = scoreDimension(causeItems);
    const programAlignmentScore = scoreDimension(programItems);
    const geographicAlignmentScore = scoreDimension(geographicItems);

    const contributingItems = [...causeItems, ...programItems, ...geographicItems];
    const recencyScore = contributingItems.length === 0 ? 0 : Math.max(...contributingItems.map(recencyOf));

    // Population Alignment -- always unscored in this build; see header
    // comment for the full schema-vs-taxonomy finding.
    const populationAlignmentScore = 0;
    const unscoredDimensions: string[] = [
      "populationAlignmentScore unscored -- organizations.target_population exists as a free-text tenant field, but no pil_evidence claim_type or population-alignment taxonomy exists in this schema to score prospect evidence against it without fabrication.",
    ];

    const counterevidence = missionAffinityItems
      .filter((item) => item.contradiction_status === "contradicted")
      .map((item) => item.id);

    const averagedDimensions = [causeAlignmentScore, programAlignmentScore, geographicAlignmentScore, recencyScore];
    if (!unscoredDimensions.length) {
      // Reserved for when a real population-alignment taxonomy lands --
      // mirrors BEN-QLF-04's coveredCount/researchSufficiency pattern of a
      // denominator that only counts dimensions actually scored.
      averagedDimensions.push(populationAlignmentScore);
    }
    const averageScore = averagedDimensions.reduce((a, b) => a + b, 0) / averagedDimensions.length;
    const overallScore = Math.max(
      0,
      Math.min(100, Math.round(averageScore) - counterevidence.length * COUNTEREVIDENCE_PENALTY_PER_ITEM),
    );

    const evidenceRefs = [...new Set([...contributingItems, ...missionAffinityItems].map((item) => item.id))];
    const confidence =
      contributingItems.length === 0
        ? 0
        : contributingItems.reduce((sum, item) => sum + Math.max(0, Math.min(1, item.confidence)), 0) / contributingItems.length;

    const opportunity = await this.upsertMissionAffinityScore(context.orgId, context.prospectId, overallScore / 100);

    const assessment: Omit<MissionAffinityAssessment, "id" | "created_at"> = {
      organization_id: context.orgId,
      prospect_id: context.prospectId,
      opportunity_id: opportunity.id,
      cause_alignment_score: causeAlignmentScore,
      population_alignment_score: null,
      program_alignment_score: programAlignmentScore,
      geographic_alignment_score: geographicAlignmentScore,
      recency_score: recencyScore,
      overall_score: overallScore,
      counterevidence,
      unscored_dimensions: unscoredDimensions,
      evidence_refs: evidenceRefs,
      confidence,
      computed_by_agent_id: context.agentCode,
      computed_at: new Date().toISOString(),
    };
    await this.insertAssessment(assessment);

    const delegations: DelegationRequest[] = [];

    const avgWeightedConfidence =
      contributingItems.length === 0
        ? 0
        : contributingItems.reduce((sum, item) => sum + weightedConfidence(item), 0) / contributingItems.length;
    const delegatedToKnw03 = avgWeightedConfidence < LOW_CONFIDENCE_DELEGATION_THRESHOLD;
    if (delegatedToKnw03) {
      delegations.push({
        childAgentCode: "BEN-KNW-03",
        objective: `Evidence-quality verification for prospect ${context.prospectId}: mission-affinity claim types [${[...causeClaimTypes, ...programClaimTypes, ...geographicClaimTypes].join(", ")}] carry a weighted-confidence average of ${avgWeightedConfidence.toFixed(2)}, below the ${LOW_CONFIDENCE_DELEGATION_THRESHOLD} trust threshold for BEN-QLF-01's mission-affinity score.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId, claimTypes: [...causeClaimTypes, ...programClaimTypes, ...geographicClaimTypes] },
      });
    }

    const givingHistoryItems = byClaimTypes(CLAIM_TYPES_BY_DIMENSION.philanthropicPropensity);
    const delegatedToInt07 = givingHistoryItems.length === 0;
    if (delegatedToInt07) {
      delegations.push({
        childAgentCode: "BEN-INT-07",
        objective: `No giving-history evidence exists for prospect ${context.prospectId}; BEN-QLF-01 cannot assess sustained/recent cause-giving patterns without it.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId },
      });
    }

    const foundationItems = byClaimTypes(CLAIM_TYPES_BY_DIMENSION.fundingEligibility);
    const delegatedToInt06 = foundationItems.length === 0 && INSTITUTIONAL_ENTITY_TYPES.has(prospect.entity_type);
    if (delegatedToInt06) {
      delegations.push({
        childAgentCode: "BEN-INT-06",
        objective: `Prospect ${context.prospectId} is an institutional funder (${prospect.entity_type}) with no foundation-adjacent evidence on file; BEN-QLF-01 cannot assess its stated program/mission priorities without it.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId },
      });
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "mission_affinity.scored",
      resource_type: "pil_prospect_opportunities",
      resource_id: opportunity.id,
      before_state: null,
      after_state: { overallScore, causeAlignmentScore, programAlignmentScore, geographicAlignmentScore, recencyScore, counterevidence, unscoredDimensions },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, 350);

    const report: MissionAffinityReport = {
      prospectId: context.prospectId,
      causeAlignmentScore,
      populationAlignmentScore,
      programAlignmentScore,
      geographicAlignmentScore,
      recencyScore,
      overallScore,
      counterevidence,
      unscoredDimensions,
      evidenceRefs,
      confidence,
      delegatedToKnw03,
      delegatedToInt07,
      delegatedToInt06,
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

  // Scoped find-or-insert helper touching only mission_affinity_score --
  // BEN-QLF-04's own upsertOpportunity() is a private class method and
  // covers additional qualification fields this agent has no basis to set
  // (classification, confidence, qualified_by_agent_id), so it can't be
  // imported and shouldn't be forked wholesale.
  private async upsertMissionAffinityScore(orgId: string, prospectId: string, score: number): Promise<ProspectOpportunity> {
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
        .update({ mission_affinity_score: score, updated_at: new Date().toISOString() })
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
        mission_affinity_score: score,
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
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as ProspectOpportunity;
  }

  private async insertAssessment(assessment: Omit<MissionAffinityAssessment, "id" | "created_at">): Promise<void> {
    const { error } = await getPilClient().from("pil_mission_affinity_assessments").insert(assessment);
    if (error) throw error;
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

export default MissionAffinityAgent;
