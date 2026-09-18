import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect } from "@/lib/pil/graph";
import { getEvents } from "@/lib/pil/monitoring";
import { logAction } from "@/lib/pil/audit";
import { CLAIM_TYPES_BY_DIMENSION, VERIFICATION_WEIGHT, scoreRelationshipStrength } from "@/lib/pil/agents/qlf/BEN-QLF-04";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";
import type {
  EvidenceItem,
  FundingEligibilityAssessment,
  GraphEdge,
  Prospect,
  ProspectOpportunity,
  ProspectOpportunityTimingStatus,
  TimingReadinessAssessment,
} from "@/lib/pil/types";

// BEN-QLF-05 -- Timing and Readiness Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~826, FAMILY 5 -- QUALIFICATION &
// DECISION INTELLIGENCE). Mission (pil_agent_registry, migration 155):
// "Determine whether the opportunity should be approached now, cultivated
// first, monitored, or deferred." Default autonomy A2. Cadence: "On demand +
// monitoring-triggered re-evaluation."
//
// This is the last of Family 5's four specialists BEN-QLF-04's own header
// comment names as not-yet-implemented placeholders it scores itself
// directly via its timingReadiness dimension (scoreTimingFromMonitoring()).
// Landing this agent does not itself rewire BEN-QLF-04 -- that remains a
// separate future prompt, same as BEN-QLF-01/02/03 before it -- but this
// agent's output is shaped the same way: a single blended status on
// pil_prospect_opportunities.timing_status (the column BEN-QLF-04 leaves
// null in its own insert defaults today) plus a full per-dimension
// breakdown row in the new pil_timing_readiness_assessments table.
//
// PIL_SPEC_WORKING_DIR's BEN-QLF-05-timing-and-readiness.md is the generic
// enterprise-constitution template applied to every agent in that tree
// (GOAL/OBSERVE/PLAN/AUTHORIZE/ACT/COLLECT/EVALUATE loop, typed
// Goal/Decision contracts, PIL-SVC-NN deterministic services) -- it carries
// no BEN-QLF-05-specific scoring logic beyond naming the same six dimensions
// PROSPECT_INTELLIGENCE_AGENTS.md's concrete spec already names, and is
// marked FINAL_SPECIFICATION_PENDING_IMPLEMENTATION_EVIDENCE with no
// implementation evidence of its own -- design input only, same as every
// other agent file in this codebase that cites this same paper-spec tree
// (see BEN-REL-06.ts's header for the precedent). PROSPECT_INTELLIGENCE_
// AGENTS.md's concrete section BEN-QLF-05 is the grounding used here.
//
// Dependency anomaly, preserved deliberately per the commissioning task: this
// agent's real depends_on is [BEN-KNW-04, BEN-REL-06, BEN-QLF-02] --
// BEN-KNW-04 (Contradiction & Freshness Investigator), not BEN-KNW-03
// (Evidence & Provenance Verification), unlike every other QLF agent in this
// fleet (BEN-QLF-01/02 both delegate stale/low-confidence evidence to
// BEN-KNW-03). BEN-KNW-04 has no implementation yet as of this file
// (tracked separately, queue-pil-knw-agents.yaml's pil-knw-04-build prompt,
// which may land before or after this one) -- delegating to it by agent_id
// regardless is safe and intentional: unregistered agent_ids resolve
// gracefully to NotImplementedAgent (src/lib/pil/agents/index.ts), the same
// established forward-delegation pattern BEN-KNW-01.ts already relies on for
// its own BEN-KNW-04 delegation.
//
// Six named dimensions (PROSPECT_INTELLIGENCE_AGENTS.md section BEN-QLF-05,
// inputs list): Application Window, Trigger Recency, Relationship Maturity,
// Tenant Readiness, Document Readiness, Staleness And Monitor Conditions.
//
//   - Application Window: if a fresh (computed within
//     ASSESSMENT_FRESHNESS_DAYS) pil_funding_eligibility_assessments row
//     exists for this prospect (BEN-QLF-02's table), its deadline_window_pass
//     value is read directly rather than re-parsed from evidence. Otherwise
//     falls back to a direct parse of foundation_application_procedures
//     evidence.value for a deadline date, the same DEADLINE_VALUE_KEYS/
//     bare-YYYY-MM-DD heuristic BEN-QLF-02.ts's own (unexported) parseDeadline
//     uses -- duplicated here rather than imported since BEN-QLF-02 does not
//     export it.
//   - Trigger Recency: days since the more recent of the latest getEvents()
//     entry for this prospect or the latest liquidity_event evidence item's
//     published_at/retrieved_at. Null if neither signal exists.
//   - Relationship Maturity: BEN-QLF-04's own exported scoreRelationshipStrength()
//     (the same pil_graph_edges.relationship_strength/RELATIONSHIP_STRENGTH_SCORE
//     read BEN-QLF-04 does for its relationshipStrength dimension), reused
//     directly rather than re-derived. BEN-REL-06.ts is this schema's only
//     writer of relationship_strength.
//   - Tenant Readiness: organizations has no gift-officer-availability/
//     fundraising-staff-capacity field -- `total_staff`/`total_volunteers`
//     (001_initial_schema.sql) are raw organization-wide headcounts with no
//     per-prospect engagement-capacity semantics, not a readiness-to-engage
//     signal this agent could score against without fabricating a meaning
//     the column doesn't carry (same schema-gap pattern BEN-QLF-01 documents
//     for its own populationAlignmentScore). Always a neutral 50 here,
//     always listed in `unscoredDimensions`, per this build's standing rule
//     against fabricating a taxonomy the schema doesn't have.
//   - Document Readiness: if a fresh pil_funding_eligibility_assessments row
//     exists, its prerequisites_pass is read as a 100/true, 0/false, or
//     null/unscored signal. Null (unscored) whenever no fresh assessment
//     exists at all.
//   - Staleness And Monitor Conditions: evidence ids among the timing-relevant
//     claim types (CLAIM_TYPES_BY_DIMENSION.timingReadiness's liquidity_event
//     plus foundation_application_procedures, the evidence backing Application
//     Window) with freshness_status==='stale', plus any getEvents() entries
//     with status IN ('new','reviewed') -- the same actionable-event filter
//     BEN-QLF-04's own scoreTimingFromMonitoring() uses. Persisted as two
//     separate columns (staleness_flags / monitor_conditions per the detail
//     table) but combined for the decision rule below.
//
// Decision rule (`timingStatus`, exactly the schema's
// ProspectOpportunityTimingStatus enum): "defer" if applicationWindowOpen
// is explicitly false (a hard external deadline is a forcing constraint
// above soft readiness signals, per spec's planning-behavior note); else
// "approach_now" if applicationWindowOpen===true AND relationshipMaturityScore
// >= 55 (BEN-QLF-04's own RELATIONSHIP_STRENGTH_SCORE "moderate" tier
// threshold) AND (documentReadinessScore===null OR >= 70); else "monitor"
// if applicationWindowOpen===null (genuinely unknown, not a hard "no") OR
// any staleness/monitor condition fired; else "cultivate_first" (relationship
// not yet mature enough, but nothing forcing monitor/defer).
//
// Delegation wiring (feeds [BEN-QLF-04, BEN-INT-10, BEN-STR-03] per the
// dependency graph -- those are downstream consumers of the timing_status
// column this agent writes, not agents this run delegates to; the registry's
// depends_on/feeds split is documentation of the dependency graph, not a
// second delegations list). Real runtime delegations, per depends_on
// [BEN-KNW-04, BEN-REL-06, BEN-QLF-02]:
//   - BEN-KNW-04 whenever any timing-relevant evidence item is stale or
//     contradicted -- the freshness/contradiction signal this agent's own
//     Staleness dimension already surfaces is exactly BEN-KNW-04's canonical
//     reasoning boundary (spec §7).
//   - BEN-REL-06 whenever this prospect has graph edges but none of them
//     carry a non-null relationship_strength yet -- relationship data exists
//     but has never been scored, so BEN-QLF-04's own scoreRelationshipStrength()
//     (reused above) would otherwise silently return 0 for "unscored" the
//     same way it returns 0 for "no relationship at all."
//   - BEN-QLF-02 whenever no pil_funding_eligibility_assessments row exists
//     yet for this prospect at all -- forward-looking only, matching this
//     codebase's established graceful-degradation convention (this run still
//     completes its own determination from the evidence fallback).

const ASSESSMENT_FRESHNESS_DAYS = 30;
const RELATIONSHIP_MATURITY_APPROACH_THRESHOLD = 55;
const DOCUMENT_READINESS_APPROACH_THRESHOLD = 70;
const NEUTRAL_TENANT_READINESS_SCORE = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Duplicated from BEN-QLF-02.ts's own (unexported, private-scope) DEADLINE_VALUE_KEYS/
// parseDeadline -- see header comment for why this isn't imported instead.
const DEADLINE_VALUE_KEYS = ["deadline", "application_deadline", "submission_deadline", "due_date", "window_end", "close_date"];

function parseDeadlineFromEvidence(item: EvidenceItem): Date | null {
  const raw = item.value;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of DEADLINE_VALUE_KEYS) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "string") {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) return d;
      }
    }
  }
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const dateMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(`${item.claim} ${item.evidence_excerpt ?? ""}`);
  if (dateMatch) {
    const d = new Date(dateMatch[1]!);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function evaluateApplicationWindowOpenFromEvidence(applicationProcedureItems: EvidenceItem[]): boolean | null {
  const parsed = applicationProcedureItems
    .map((item) => ({ item, date: parseDeadlineFromEvidence(item) }))
    .filter((p): p is { item: EvidenceItem; date: Date } => p.date !== null);
  if (parsed.length === 0) return null;
  return parsed.some((p) => p.date.getTime() > Date.now());
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / MS_PER_DAY));
}

function weightedConfidence(item: EvidenceItem): number {
  return Math.max(0, Math.min(1, item.confidence)) * VERIFICATION_WEIGHT[item.verification_status];
}

export interface TimingReadinessReport {
  prospectId: string;
  timingStatus: ProspectOpportunityTimingStatus;
  applicationWindowOpen: boolean | null;
  triggerRecencyDays: number | null;
  relationshipMaturityScore: number;
  tenantReadinessScore: number;
  documentReadinessScore: number | null;
  monitorConditions: string[];
  stalenessFlags: string[];
  unscoredDimensions: string[];
  evidenceRefs: string[];
  confidence: number;
  delegatedToKnw04: boolean;
  delegatedToRel06: boolean;
  delegatedToQlf02: boolean;
}

export class TimingReadinessAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completed({}, "BEN-QLF-05 requires an existing prospectId");
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
    const byClaimTypes = (types: string[]) => types.flatMap((t) => evidenceByClaimType.get(t) ?? []);

    const liquidityItems = byClaimTypes(CLAIM_TYPES_BY_DIMENSION.timingReadiness);
    const applicationProcedureItems = evidenceByClaimType.get("foundation_application_procedures") ?? [];
    const timingRelevantItems = [...liquidityItems, ...applicationProcedureItems];

    const events = await getEvents(context.orgId, context.prospectId);

    const latestEligibilityAssessment = await this.loadLatestEligibilityAssessment(context.orgId, context.prospectId);
    const hasEligibilityAssessment = latestEligibilityAssessment !== null;
    const freshEligibilityAssessment =
      latestEligibilityAssessment && (Date.now() - Date.parse(latestEligibilityAssessment.computed_at)) / MS_PER_DAY <= ASSESSMENT_FRESHNESS_DAYS
        ? latestEligibilityAssessment
        : null;

    // --- Application Window ---
    const applicationWindowOpen = freshEligibilityAssessment
      ? freshEligibilityAssessment.deadline_window_pass
      : evaluateApplicationWindowOpenFromEvidence(applicationProcedureItems);

    // --- Trigger Recency ---
    const latestEventAt = events.length === 0 ? null : events.reduce((latest, e) => (Date.parse(e.detected_at) > Date.parse(latest) ? e.detected_at : latest), events[0]!.detected_at);
    const latestLiquidityAt = liquidityItems.reduce<string | null>((latest, item) => {
      const itemDate = item.published_at ?? item.retrieved_at;
      return !latest || Date.parse(itemDate) > Date.parse(latest) ? itemDate : latest;
    }, null);
    const mostRecentTriggerIso = [latestEventAt, latestLiquidityAt]
      .filter((v): v is string => v !== null)
      .reduce<string | null>((latest, iso) => (!latest || Date.parse(iso) > Date.parse(latest) ? iso : latest), null);
    const triggerRecencyDays = mostRecentTriggerIso ? daysSince(mostRecentTriggerIso) : null;

    // --- Relationship Maturity ---
    const relationshipMaturityScore = await scoreRelationshipStrength(context.orgId, context.prospectId);
    const hasUnscoredRelationshipData = await this.hasUnscoredRelationshipData(context.orgId, context.prospectId);

    // --- Tenant Readiness (schema gap; see header comment) ---
    const tenantReadinessScore = NEUTRAL_TENANT_READINESS_SCORE;
    const unscoredDimensions: string[] = [
      "tenantReadinessScore unscored -- no tenant-readiness/gift-officer-availability field exists on organizations; total_staff/total_volunteers are raw org-wide headcounts with no per-prospect engagement-capacity semantics, so a neutral 50 is used rather than fabricating a readiness signal the schema doesn't have.",
    ];

    // --- Document Readiness ---
    let documentReadinessScore: number | null = null;
    if (freshEligibilityAssessment) {
      documentReadinessScore =
        freshEligibilityAssessment.prerequisites_pass === true ? 100 : freshEligibilityAssessment.prerequisites_pass === false ? 0 : null;
    }
    if (documentReadinessScore === null) {
      unscoredDimensions.push(
        freshEligibilityAssessment
          ? "documentReadinessScore unscored -- the fresh pil_funding_eligibility_assessments row on file has a null prerequisites_pass (no prerequisite evidence found either way)."
          : "documentReadinessScore unscored -- no fresh (within 30 days) pil_funding_eligibility_assessments row exists yet for this prospect.",
      );
    }

    // --- Staleness And Monitor Conditions ---
    const stalenessFlags = timingRelevantItems.filter((i) => i.freshness_status === "stale").map((i) => i.id);
    const monitorConditions = events.filter((e) => e.status === "new" || e.status === "reviewed").map((e) => e.id);
    const stalenessAndMonitorConditions = [...stalenessFlags, ...monitorConditions];

    // --- Decision ---
    const timingStatus = this.decideTimingStatus(
      applicationWindowOpen,
      relationshipMaturityScore,
      documentReadinessScore,
      stalenessAndMonitorConditions,
    );

    const evidenceRefs = [...new Set(timingRelevantItems.map((item) => item.id))];
    const confidence = timingRelevantItems.length === 0 ? 0 : timingRelevantItems.reduce((sum, item) => sum + weightedConfidence(item), 0) / timingRelevantItems.length;

    const opportunity = await this.upsertTimingStatus(context.orgId, context.prospectId, timingStatus);

    const assessment: Omit<TimingReadinessAssessment, "id" | "created_at"> = {
      organization_id: context.orgId,
      prospect_id: context.prospectId,
      opportunity_id: opportunity.id,
      timing_status: timingStatus,
      application_window_open: applicationWindowOpen,
      trigger_recency_days: triggerRecencyDays,
      relationship_maturity_score: relationshipMaturityScore,
      tenant_readiness_score: tenantReadinessScore,
      document_readiness_score: documentReadinessScore,
      monitor_conditions: monitorConditions,
      staleness_flags: stalenessFlags,
      unscored_dimensions: unscoredDimensions,
      confidence,
      computed_by_agent_id: context.agentCode,
      computed_at: new Date().toISOString(),
    };
    await this.insertAssessment(assessment);

    const delegations: DelegationRequest[] = [];

    const delegatedToKnw04 = timingRelevantItems.some((i) => i.freshness_status === "stale" || i.contradiction_status === "contradicted");
    if (delegatedToKnw04) {
      delegations.push({
        childAgentCode: "BEN-KNW-04",
        objective: `Timing-relevant evidence for prospect ${context.prospectId} is stale or contradicted -- resolve which claim is canonical before BEN-QLF-05's timing determination is treated as final.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId, staleOrContradictedEvidenceIds: timingRelevantItems.filter((i) => i.freshness_status === "stale" || i.contradiction_status === "contradicted").map((i) => i.id) },
      });
    }

    const delegatedToRel06 = hasUnscoredRelationshipData;
    if (delegatedToRel06) {
      delegations.push({
        childAgentCode: "BEN-REL-06",
        objective: `Prospect ${context.prospectId} has graph edges with no relationship_strength scored yet -- BEN-QLF-05's relationshipMaturityScore cannot distinguish "unscored" from "no relationship" until BEN-REL-06 scores them.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId },
      });
    }

    const delegatedToQlf02 = !hasEligibilityAssessment;
    if (delegatedToQlf02) {
      delegations.push({
        childAgentCode: "BEN-QLF-02",
        objective: `No pil_funding_eligibility_assessments row exists yet for prospect ${context.prospectId}; BEN-QLF-05's applicationWindowOpen/documentReadinessScore dimensions are falling back to a direct evidence parse until BEN-QLF-02 runs.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId },
      });
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "timing_readiness.scored",
      resource_type: "pil_prospect_opportunities",
      resource_id: opportunity.id,
      before_state: null,
      after_state: { timingStatus, applicationWindowOpen, relationshipMaturityScore, documentReadinessScore, stalenessAndMonitorConditions },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, 300);

    const report: TimingReadinessReport = {
      prospectId: context.prospectId,
      timingStatus,
      applicationWindowOpen,
      triggerRecencyDays,
      relationshipMaturityScore,
      tenantReadinessScore,
      documentReadinessScore,
      monitorConditions,
      stalenessFlags,
      unscoredDimensions,
      evidenceRefs,
      confidence,
      delegatedToKnw04,
      delegatedToRel06,
      delegatedToQlf02,
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

  private decideTimingStatus(
    applicationWindowOpen: boolean | null,
    relationshipMaturityScore: number,
    documentReadinessScore: number | null,
    stalenessAndMonitorConditions: string[],
  ): ProspectOpportunityTimingStatus {
    if (applicationWindowOpen === false) return "defer";
    if (
      applicationWindowOpen === true &&
      relationshipMaturityScore >= RELATIONSHIP_MATURITY_APPROACH_THRESHOLD &&
      (documentReadinessScore === null || documentReadinessScore >= DOCUMENT_READINESS_APPROACH_THRESHOLD)
    ) {
      return "approach_now";
    }
    if (applicationWindowOpen === null || stalenessAndMonitorConditions.length > 0) return "monitor";
    return "cultivate_first";
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

  private async loadLatestEligibilityAssessment(orgId: string, prospectId: string): Promise<FundingEligibilityAssessment | null> {
    const { data, error } = await getPilClient()
      .from("pil_funding_eligibility_assessments")
      .select("*")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as FundingEligibilityAssessment | null) ?? null;
  }

  // Detects "relationship data exists but has never been scored" -- distinct
  // from scoreRelationshipStrength()'s own 0 return, which also covers "no
  // relationship at all." Mirrors BEN-QLF-04/BEN-REL-06's own edge-fetch
  // pattern (nodes -> edges as source or target) rather than reusing
  // scoreRelationshipStrength() itself, since that function's return value
  // alone can't distinguish the two zero-signal cases.
  private async hasUnscoredRelationshipData(orgId: string, prospectId: string): Promise<boolean> {
    const nodes = await getNodesByProspect(prospectId, orgId);
    if (nodes.length === 0) return false;
    const nodeIds = nodes.map((n) => n.id);
    const client = getPilClient();
    const [{ data: asSource, error: sourceError }, { data: asTarget, error: targetError }] = await Promise.all([
      client.from("pil_graph_edges").select("*").eq("organization_id", orgId).eq("is_current", true).in("source_node_id", nodeIds),
      client.from("pil_graph_edges").select("*").eq("organization_id", orgId).eq("is_current", true).in("target_node_id", nodeIds),
    ]);
    if (sourceError) throw sourceError;
    if (targetError) throw targetError;
    const edgeById = new Map<string, GraphEdge>();
    for (const e of [...((asSource ?? []) as GraphEdge[]), ...((asTarget ?? []) as GraphEdge[])]) {
      edgeById.set(e.id, e);
    }
    const edges = [...edgeById.values()];
    if (edges.length === 0) return false;
    return edges.every((e) => e.relationship_strength === null);
  }

  // Scoped find-or-insert helper touching only timing_status -- mirrors
  // BEN-QLF-01's own upsertMissionAffinityScore()/BEN-QLF-04's
  // upsertOpportunity() precedent: BEN-QLF-04's own method is a private
  // class method covering additional qualification fields this agent has no
  // basis to set, so it can't be imported and shouldn't be forked wholesale.
  private async upsertTimingStatus(orgId: string, prospectId: string, timingStatus: ProspectOpportunityTimingStatus): Promise<ProspectOpportunity> {
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
        .update({ timing_status: timingStatus, updated_at: new Date().toISOString() })
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
        timing_status: timingStatus,
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

  private async insertAssessment(assessment: Omit<TimingReadinessAssessment, "id" | "created_at">): Promise<void> {
    const { error } = await getPilClient().from("pil_timing_readiness_assessments").insert(assessment);
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

export default TimingReadinessAgent;
