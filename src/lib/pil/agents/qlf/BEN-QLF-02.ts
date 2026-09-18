import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { logAction } from "@/lib/pil/audit";
import { CLAIM_TYPES_BY_DIMENSION, INSTITUTIONAL_ENTITY_TYPES, VERIFICATION_WEIGHT } from "@/lib/pil/agents/qlf/BEN-QLF-04";
import type { EvidenceItem, FundingEligibilityAssessment, Prospect } from "@/lib/pil/types";
import { pilBlendedTokenRateUsd, PIL_AGENT_MODEL } from "@/lib/pil/model-pricing";

// BEN-QLF-02 -- Funding Eligibility Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md, FAMILY 5 -- QUALIFICATION & DECISION
// INTELLIGENCE). Mission (pil_agent_registry, migration 155): "Determine
// whether a foundation, corporation, or funding program is actually
// available to the tenant." Default autonomy A2. Cadence: "On demand, per
// foundation/corporate prospect."
//
// This is the second of the two hand-off targets BEN-QLF-04's own header
// comment names for its self-scored fundingEligibility dimension (the first,
// BEN-QLF-01, covers missionAffinity). Landing this agent does not itself
// rewire BEN-QLF-04 -- that remains a separate future prompt -- but its
// output is shaped for that prompt to consume directly: a distinct
// disqualifying_reasons entry text lets a caller tell "confirmed ineligible"
// (an explicit false) apart from "unknown" (every dimension null) even
// though both currently collapse to fundingEligibility===0 in BEN-QLF-04's
// own scoring.
//
// Import source: per the commissioning task, this agent prefers importing
// scoreDimension/VERIFICATION_WEIGHT/CLAIM_TYPES_BY_DIMENSION from BEN-QLF-01
// if it re-exports them, falling back to BEN-QLF-04 directly otherwise.
// BEN-QLF-01.ts (already landed in this batch) imports these constants from
// BEN-QLF-04 for its own internal use but does not re-export them -- there is
// nothing to import from BEN-QLF-01, so this agent imports directly from
// BEN-QLF-04, exactly as the task's documented fallback path allows.
// scoreDimension() itself is not imported: unlike BEN-QLF-01's 0-100
// per-dimension scores, this agent's six dimensions are nullable
// pass/fail booleans (see below), so scoreDimension's confidence-weighted
// 0-100 blend does not apply here. VERIFICATION_WEIGHT is used instead to
// weight each dimension's confidence contribution.
//
// Spec's six named dimensions (PROSPECT_INTELLIGENCE_AGENTS.md section
// BEN-QLF-02): Applicant Class, Tax Status, Geography, Program Restrictions,
// Deadline/Window, Required Prerequisites. Each resolves to a nullable
// boolean: null means no relevant evidence existed either way, distinct from
// an explicit false (a real disqualifying fact was found). Overall
// `eligible` follows the same tri-state rule: false if ANY dimension
// explicitly resolved false; true if at least one dimension resolved true
// and none resolved false; null only when every dimension is null (no
// eligibility evidence on file at all -- "insufficient evidence", never
// treated as an optimistic pass).
//
// Schema finding (organizations, migration 001_initial_schema.sql line 101):
// there is no separate applicant-class/entity-type column on organizations,
// only `tax_status` (free text) and `service_area` (free text). Applicant
// Class and Tax Status therefore both read organizations.tax_status --
// Applicant Class checks it against broader entity-type restriction phrases
// (nonprofit/government/individual eligibility), Tax Status checks it
// specifically against a "501(c)(3)" requirement -- the same schema-gap
// pattern BEN-QLF-01 documents for its own populationAlignment dimension.
// Geography reuses CLAIM_TYPES_BY_DIMENSION.geographicRelevance evidence
// cross-referenced against organizations.service_area via a documented
// substring-overlap heuristic (not full geographic entity resolution).
//
// Documented heuristics (small keyword lists, not NLP, per the commissioning
// task): APPLICANT_CLASS_RESTRICTION_KEYWORDS, TAX_STATUS_RESTRICTION_
// SUBSTRING, PROGRAM_EXCLUSION_KEYWORDS, PREREQUISITE_KEYWORDS below.
// Deadline/Window parses any deadline-shaped date out of a
// foundation_application_procedures evidence item's jsonb `value` (common
// key names) or, failing that, a bare YYYY-MM-DD in its claim/excerpt text:
// true if any parsed deadline is still in the future, false if every parsed
// deadline is strictly in the past, null if none could be parsed at all.
//
// Delegation wiring (depends_on [BEN-KNW-03, BEN-INT-06, BEN-QLF-01], feeds
// [BEN-QLF-04, BEN-QLF-05, BEN-INT-06]): pushes to BEN-QLF-01 whenever no
// pil_mission_affinity_assessments row exists yet for this prospect --
// forward-looking only (this run still completes its own determination from
// direct evidence), matching this codebase's established graceful-
// degradation convention (see BEN-KNW-01's BEN-KNW-04 delegation). Pushes to
// BEN-KNW-03 when the verification-weighted average confidence across every
// evidence item that contributed to a non-null dimension is below 0.6.
// Pushes to BEN-INT-06 when zero foundation-adjacent evidence
// (CLAIM_TYPES_BY_DIMENSION.fundingEligibility) exists at all for an
// institutional-entity-type prospect (BEN-QLF-04's INSTITUTIONAL_ENTITY_
// TYPES).

const LOW_CONFIDENCE_DELEGATION_THRESHOLD = 0.6;

const APPLICANT_CLASS_RESTRICTION_KEYWORDS = [
  "501(c)(3) organizations only",
  "nonprofit organizations only",
  "public charities only",
  "government agencies only",
  "individuals are not eligible",
];

const TAX_STATUS_RESTRICTION_SUBSTRING = "501(c)(3)";

const PROGRAM_EXCLUSION_KEYWORDS = ["does not fund", "will not fund", "excludes", "ineligible categories", "not eligible for funding"];

const PREREQUISITE_KEYWORDS = ["registration required", "must register", "letter of inquiry required", "loi required", "pre-application required"];

const DEADLINE_VALUE_KEYS = ["deadline", "application_deadline", "submission_deadline", "due_date", "window_end", "close_date"];

interface DimensionPassResult {
  pass: boolean | null;
  reason: string | null;
  items: EvidenceItem[];
}

function textOf(item: EvidenceItem): string {
  const valueText = item.value == null ? "" : typeof item.value === "string" ? item.value : JSON.stringify(item.value);
  return `${item.claim} ${item.evidence_excerpt ?? ""} ${valueText}`.toLowerCase();
}

function weightedConfidence(item: EvidenceItem): number {
  return Math.max(0, Math.min(1, item.confidence)) * VERIFICATION_WEIGHT[item.verification_status];
}

function evaluateApplicantClassPass(restrictionSourceItems: EvidenceItem[], orgTaxStatus: string | null): DimensionPassResult {
  const restrictionItems = restrictionSourceItems.filter((i) => APPLICANT_CLASS_RESTRICTION_KEYWORDS.some((k) => textOf(i).includes(k)));
  if (restrictionItems.length === 0) return { pass: null, reason: null, items: [] };
  if (!orgTaxStatus) return { pass: null, reason: null, items: restrictionItems };
  const orgLooksTaxExempt = /501\(c\)|nonprofit|tax-exempt|charitable/i.test(orgTaxStatus);
  if (orgLooksTaxExempt) return { pass: true, reason: null, items: restrictionItems };
  return {
    pass: false,
    reason: `Funder restricts eligibility to tax-exempt/nonprofit applicants (evidence ${restrictionItems.map((i) => i.id).join(", ")}), but the tenant's on-file tax_status ("${orgTaxStatus}") does not indicate tax-exempt status.`,
    items: restrictionItems,
  };
}

function evaluateTaxStatusPass(restrictionSourceItems: EvidenceItem[], orgTaxStatus: string | null): DimensionPassResult {
  const restrictionItems = restrictionSourceItems.filter((i) => textOf(i).includes(TAX_STATUS_RESTRICTION_SUBSTRING));
  if (restrictionItems.length === 0) return { pass: null, reason: null, items: [] };
  if (!orgTaxStatus) return { pass: null, reason: null, items: restrictionItems };
  const orgIs501c3 = orgTaxStatus.toLowerCase().includes(TAX_STATUS_RESTRICTION_SUBSTRING);
  if (orgIs501c3) return { pass: true, reason: null, items: restrictionItems };
  return {
    pass: false,
    reason: `Funder requires 501(c)(3) status (evidence ${restrictionItems.map((i) => i.id).join(", ")}), but the tenant's on-file tax_status ("${orgTaxStatus}") is not 501(c)(3).`,
    items: restrictionItems,
  };
}

function evaluateGeographyPass(geographicItems: EvidenceItem[], orgServiceArea: string | null): DimensionPassResult {
  if (geographicItems.length === 0 || !orgServiceArea) return { pass: null, reason: null, items: [] };
  const serviceAreaLower = orgServiceArea.toLowerCase();
  const matches = geographicItems.filter((i) => textOf(i).includes(serviceAreaLower));
  if (matches.length > 0) return { pass: true, reason: null, items: matches };
  return {
    pass: false,
    reason: `Geographic-relevance evidence on file (${geographicItems.map((i) => i.id).join(", ")}) does not mention the tenant's declared service area ("${orgServiceArea}"); documented substring-overlap heuristic, not full geographic entity resolution.`,
    items: geographicItems,
  };
}

function evaluateProgramRestrictionsPass(missionPriorityItems: EvidenceItem[]): DimensionPassResult {
  if (missionPriorityItems.length === 0) return { pass: null, reason: null, items: [] };
  const excluding = missionPriorityItems.filter((i) => PROGRAM_EXCLUSION_KEYWORDS.some((k) => textOf(i).includes(k)));
  if (excluding.length === 0) return { pass: true, reason: null, items: missionPriorityItems };
  return {
    pass: false,
    reason: `Programmatic-exclusion language found in funder evidence (${excluding.map((i) => i.id).join(", ")}).`,
    items: excluding,
  };
}

function parseDeadline(item: EvidenceItem): Date | null {
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

function evaluateDeadlineWindowPass(applicationProcedureItems: EvidenceItem[]): DimensionPassResult {
  const parsed = applicationProcedureItems
    .map((item) => ({ item, date: parseDeadline(item) }))
    .filter((p): p is { item: EvidenceItem; date: Date } => p.date !== null);
  if (parsed.length === 0) return { pass: null, reason: null, items: [] };
  const now = Date.now();
  const future = parsed.filter((p) => p.date.getTime() > now);
  if (future.length > 0) return { pass: true, reason: null, items: future.map((p) => p.item) };
  const mostRecentPast = parsed.reduce((a, b) => (a.date.getTime() > b.date.getTime() ? a : b));
  return {
    pass: false,
    reason: `Application deadline of ${mostRecentPast.date.toISOString().slice(0, 10)} has already passed (evidence ${mostRecentPast.item.id}).`,
    items: [mostRecentPast.item],
  };
}

function evaluateRequiredPrerequisitesPass(officerItems: EvidenceItem[], restrictionSourceItems: EvidenceItem[]): DimensionPassResult {
  const keywordItems = restrictionSourceItems.filter((i) => PREREQUISITE_KEYWORDS.some((k) => textOf(i).includes(k)));
  const relevant = [...officerItems, ...keywordItems];
  if (relevant.length === 0) return { pass: null, reason: null, items: [] };
  return { pass: true, reason: null, items: relevant };
}

export interface FundingEligibilityReport {
  prospectId: string;
  eligible: boolean | null;
  applicantClassPass: boolean | null;
  taxStatusPass: boolean | null;
  geographyPass: boolean | null;
  programRestrictionsPass: boolean | null;
  deadlineWindowPass: boolean | null;
  prerequisitesPass: boolean | null;
  disqualifyingReasons: string[];
  fundingEligibilityScore: number;
  evidenceRefs: string[];
  confidence: number;
  delegatedToQlf01: boolean;
  delegatedToKnw03: boolean;
  delegatedToInt06: boolean;
}

export class FundingEligibilityAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completed({}, "BEN-QLF-02 requires an existing prospectId");
    }

    const prospect = await this.loadProspect(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completed({}, `Prospect ${context.prospectId} not found`);
    }

    const organization = await this.loadOrganization(context.orgId);
    const evidence = await getEvidence(context.prospectId, context.orgId);
    const evidenceByClaimType = new Map<string, EvidenceItem[]>();
    for (const item of evidence) {
      const list = evidenceByClaimType.get(item.claim_type) ?? [];
      list.push(item);
      evidenceByClaimType.set(item.claim_type, list);
    }
    const byClaimTypes = (types: string[]) => types.flatMap((t) => evidenceByClaimType.get(t) ?? []);

    const fundingEligibilityItems = byClaimTypes(CLAIM_TYPES_BY_DIMENSION.fundingEligibility);
    const applicationProcedureItems = evidenceByClaimType.get("foundation_application_procedures") ?? [];
    const corporateGivingItems = evidenceByClaimType.get("corporate_giving_eligibility_rationale") ?? [];
    const officerItems = evidenceByClaimType.get("foundation_officers") ?? [];
    const restrictionSourceItems = [...applicationProcedureItems, ...corporateGivingItems];
    const geographicItems = byClaimTypes(CLAIM_TYPES_BY_DIMENSION.geographicRelevance);
    const missionPriorityItems = byClaimTypes(CLAIM_TYPES_BY_DIMENSION.missionAffinity);

    const applicantClass = evaluateApplicantClassPass(restrictionSourceItems, organization?.tax_status ?? null);
    const taxStatus = evaluateTaxStatusPass(restrictionSourceItems, organization?.tax_status ?? null);
    const geography = evaluateGeographyPass(geographicItems, organization?.service_area ?? null);
    const programRestrictions = evaluateProgramRestrictionsPass(missionPriorityItems);
    const deadlineWindow = evaluateDeadlineWindowPass(applicationProcedureItems);
    const prerequisites = evaluateRequiredPrerequisitesPass(officerItems, restrictionSourceItems);

    const allResults = [applicantClass, taxStatus, geography, programRestrictions, deadlineWindow, prerequisites];
    const falseResults = allResults.filter((r) => r.pass === false);
    const trueResults = allResults.filter((r) => r.pass === true);

    let eligible: boolean | null;
    let disqualifyingReasons: string[];
    if (falseResults.length > 0) {
      eligible = false;
      disqualifyingReasons = falseResults.map((r) => r.reason!).filter(Boolean);
    } else if (trueResults.length > 0) {
      eligible = true;
      disqualifyingReasons = [];
    } else {
      eligible = null;
      disqualifyingReasons = ["insufficient eligibility evidence on file"];
    }
    const fundingEligibilityScore = eligible === true ? 100 : 0;

    const contributingItems = [...new Map(allResults.flatMap((r) => r.items).map((item) => [item.id, item])).values()];
    const confidence =
      contributingItems.length === 0 ? 0 : contributingItems.reduce((sum, item) => sum + weightedConfidence(item), 0) / contributingItems.length;
    const evidenceRefs = contributingItems.map((item) => item.id);

    const opportunityId = await this.findOpportunityId(context.orgId, context.prospectId);

    const assessment: Omit<FundingEligibilityAssessment, "id" | "created_at"> = {
      organization_id: context.orgId,
      prospect_id: context.prospectId,
      opportunity_id: opportunityId,
      eligible,
      applicant_class_pass: applicantClass.pass,
      tax_status_pass: taxStatus.pass,
      geography_pass: geography.pass,
      program_restrictions_pass: programRestrictions.pass,
      deadline_window_pass: deadlineWindow.pass,
      prerequisites_pass: prerequisites.pass,
      disqualifying_reasons: disqualifyingReasons,
      evidence_refs: evidenceRefs,
      confidence,
      computed_by_agent_id: context.agentCode,
      computed_at: new Date().toISOString(),
    };
    await this.insertAssessment(assessment);

    const delegations: DelegationRequest[] = [];

    const hasMissionAffinity = await this.hasMissionAffinityAssessment(context.orgId, context.prospectId);
    const delegatedToQlf01 = !hasMissionAffinity;
    if (delegatedToQlf01) {
      delegations.push({
        childAgentCode: "BEN-QLF-01",
        objective: `No pil_mission_affinity_assessments row exists yet for prospect ${context.prospectId}; BEN-QLF-02's eligibility reasoning would benefit from BEN-QLF-01's mission-affinity scoring on a future run.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId },
      });
    }

    const delegatedToKnw03 = confidence < LOW_CONFIDENCE_DELEGATION_THRESHOLD;
    if (delegatedToKnw03) {
      delegations.push({
        childAgentCode: "BEN-KNW-03",
        objective: `Evidence-quality verification for prospect ${context.prospectId}: BEN-QLF-02's contributing eligibility evidence carries a weighted-confidence average of ${confidence.toFixed(2)}, below the ${LOW_CONFIDENCE_DELEGATION_THRESHOLD} trust threshold.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId },
      });
    }

    const delegatedToInt06 = fundingEligibilityItems.length === 0 && INSTITUTIONAL_ENTITY_TYPES.has(prospect.entity_type);
    if (delegatedToInt06) {
      delegations.push({
        childAgentCode: "BEN-INT-06",
        objective: `Prospect ${context.prospectId} is an institutional funder (${prospect.entity_type}) with no foundation-adjacent evidence on file; BEN-QLF-02 cannot assess its eligibility criteria without it.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId },
      });
    }

    await logAction({
      organization_id: context.orgId,
      actor_type: "agent",
      actor_id: context.agentCode,
      action: "funding_eligibility.scored",
      resource_type: "pil_funding_eligibility_assessments",
      resource_id: context.prospectId,
      before_state: null,
      after_state: { eligible, disqualifyingReasons, fundingEligibilityScore },
      policy_decision: null,
      ip_address: null,
    });

    const tokensUsed = await this.tryModelTokens(context, runner, 300);

    const report: FundingEligibilityReport = {
      prospectId: context.prospectId,
      eligible,
      applicantClassPass: applicantClass.pass,
      taxStatusPass: taxStatus.pass,
      geographyPass: geography.pass,
      programRestrictionsPass: programRestrictions.pass,
      deadlineWindowPass: deadlineWindow.pass,
      prerequisitesPass: prerequisites.pass,
      disqualifyingReasons,
      fundingEligibilityScore,
      evidenceRefs,
      confidence,
      delegatedToQlf01,
      delegatedToKnw03,
      delegatedToInt06,
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

  private async loadOrganization(orgId: string): Promise<{ tax_status: string | null; service_area: string | null } | null> {
    const { data, error } = await getPilClient().from("organizations").select("tax_status, service_area").eq("id", orgId).maybeSingle();
    if (error) throw error;
    return (data as { tax_status: string | null; service_area: string | null } | null) ?? null;
  }

  // Read-only lookup -- unlike BEN-QLF-01/04, this agent persists to
  // pil_funding_eligibility_assessments only (no eligibility column exists
  // on pil_prospect_opportunities to upsert); opportunity_id is populated on
  // the assessment row when an opportunity already exists, left null otherwise.
  private async findOpportunityId(orgId: string, prospectId: string): Promise<string | null> {
    const { data, error } = await getPilClient()
      .from("pil_prospect_opportunities")
      .select("id")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .maybeSingle();
    if (error) throw error;
    return (data as { id: string } | null)?.id ?? null;
  }

  private async hasMissionAffinityAssessment(orgId: string, prospectId: string): Promise<boolean> {
    const { data, error } = await getPilClient()
      .from("pil_mission_affinity_assessments")
      .select("id")
      .eq("organization_id", orgId)
      .eq("prospect_id", prospectId)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  }

  private async insertAssessment(assessment: Omit<FundingEligibilityAssessment, "id" | "created_at">): Promise<void> {
    const { error } = await getPilClient().from("pil_funding_eligibility_assessments").insert(assessment);
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

export default FundingEligibilityAgent;
