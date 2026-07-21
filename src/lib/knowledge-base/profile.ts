// Knowledge Base Editor — shared types and scoring for the 10-section profile
// UI (src/app/(dashboard)/knowledge-base/edit/page.tsx) and its API route
// (src/app/api/knowledge-base/route.ts).
//
// Task-given spec vs real schema (checked before writing a line of code here,
// per this project's established practice — see twin-completeness.ts's own
// header for the prior instance of this pattern): there is no
// `knowledge_base_profiles` table. The 10 sections below map onto real,
// already-existing storage:
//   - organizations columns (mission_statement, vision_statement,
//     founding_date, founder_name, founder_bio, service_area,
//     target_population, annual_budget, total_staff, total_volunteers,
//     tax_status, ein) — edited directly, same fields ProfileEditor.tsx
//     already exposes.
//   - organizations.extended_profile (migration 104) — ONE jsonb bucket for
//     every task-requested field with no relational column (core values, ED
//     contact, financial breakdown, service radius/counties,
//     target-population demographics, KPIs, milestones, partnership detail,
//     compliance detail), per Core Data Principles #2/#3
//     (SCHEMA_REGISTRY_v2.md §4.2 — jsonb, never one column per field).
//   - board_members / programs tables — real sub-resource CRUD, same shape
//     ProfileEditor.tsx already uses.
//   - knowledge_base rows (category='partnerships') — the actual input to
//     calculateTwinCompleteness()'s partnerships_and_coalitions section
//     (twin-completeness.ts). Edited today via /knowledge-base/narratives;
//     this editor links there rather than forking a second, disconnected
//     partnerships data model that the Twin scorer would never see.
//
// Section keys match twin-completeness.ts's TwinSectionReport.name values
// exactly (mission_and_vision, programs_and_services, ...) so this editor's
// left-nav and the Digital Twin page (/intelligence/twin) always describe the
// same 10 sections.

export const SECTION_KEYS = [
  "mission_and_vision",
  "programs_and_services",
  "financial_profile",
  "leadership_and_board",
  "geographic_service_area",
  "target_population",
  "impact_and_outcomes",
  "organizational_history",
  "partnerships_and_coalitions",
  "compliance_and_certifications",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABELS: Record<SectionKey, string> = {
  mission_and_vision: "Mission & Vision",
  programs_and_services: "Programs & Services",
  financial_profile: "Financial Profile",
  leadership_and_board: "Leadership & Board",
  geographic_service_area: "Geographic Service Area",
  target_population: "Target Population",
  impact_and_outcomes: "Impact & Outcomes",
  organizational_history: "Organizational History",
  partnerships_and_coalitions: "Partnerships",
  compliance_and_certifications: "Compliance",
};

export interface ExecutiveDirector {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  bio?: string | null;
}

export interface RevenueSource {
  source: string;
  percentage: number | null;
}

export interface FinancialExtra {
  revenue_sources?: RevenueSource[];
  last_audited_revenue?: number | null;
  last_audited_year?: number | null;
  endowment?: number | null;
  fiscal_year_end?: string | null;
}

export interface GeographicExtra {
  radius_miles?: number | null;
  counties?: string[];
  description?: string | null;
}

export interface TargetPopulationExtra {
  demographics?: string[];
  age_min?: number | null;
  age_max?: number | null;
  languages?: string[];
  population_size?: number | null;
}

export interface Kpi {
  name: string;
  measurement: string;
  baseline?: string | null;
  current?: string | null;
}

export interface ImpactExtra {
  kpis?: Kpi[];
  achievements?: string | null;
  awards?: string[];
}

export interface Milestone {
  year: number | null;
  milestone: string;
}

export interface HistoryExtra {
  milestones?: Milestone[];
  challenges?: string | null;
}

export interface Partner {
  name: string;
  relationship_type?: string | null;
  duration?: string | null;
}

export interface PartnershipsExtra {
  partners?: Partner[];
  government_contracts?: { has: boolean; description?: string | null } | null;
  coalitions?: string[];
}

export interface StateRegistration {
  state: string;
  registration_number?: string | null;
}

export type AuditResult = "clean" | "qualified" | "adverse" | "";

export interface ComplianceExtra {
  state_registrations?: StateRegistration[];
  last_audit_date?: string | null;
  audit_result?: AuditResult;
  insurance?: { has: boolean; types?: string[] } | null;
  background_check_policy?: boolean | null;
}

/** organizations.extended_profile jsonb shape (migration 104). */
export interface ExtendedProfile {
  core_values?: string[];
  executive_director?: ExecutiveDirector;
  financial?: FinancialExtra;
  geographic?: GeographicExtra;
  target_population_detail?: TargetPopulationExtra;
  impact?: ImpactExtra;
  history?: HistoryExtra;
  partnerships?: PartnershipsExtra;
  compliance?: ComplianceExtra;
}

export const EMPTY_EXTENDED_PROFILE: ExtendedProfile = {};

export interface OrganizationProfileFields {
  name: string;
  ein: string | null;
  tax_status: string | null;
  mission_statement: string | null;
  vision_statement: string | null;
  founding_date: string | null;
  founder_name: string | null;
  founder_bio: string | null;
  service_area: string | null;
  target_population: string | null;
  annual_budget: number | null;
  total_staff: number | null;
  total_volunteers: number | null;
}

function nonEmpty(v: string | null | undefined): boolean {
  return Boolean(v && v.trim() !== "");
}
function hasItems<T>(arr: T[] | undefined | null): boolean {
  return Array.isArray(arr) && arr.length > 0;
}

interface ScoreInput {
  org: OrganizationProfileFields;
  extended: ExtendedProfile;
  boardMemberCount: number;
  boardMembersWithBio: number;
  programCount: number;
  programsWithDescription: number;
  taxDocumentCount: number;
}

/**
 * Simple "how much of this form did you fill in" percentage per section —
 * distinct from twin-completeness.ts's calculateTwinCompleteness(), which
 * scores content DEPTH/quality (and deliberately caps some sections below
 * 100% because a field has no backing column at all). This score reflects
 * only what the editor itself asks for, so a user who fills every field they
 * are shown sees 100%.
 */
export function computeSectionScores(input: ScoreInput): Record<SectionKey, number> {
  const { org, extended, boardMemberCount, boardMembersWithBio, programCount, programsWithDescription, taxDocumentCount } = input;

  const pct = (filled: number, total: number) =>
    total === 0 ? 0 : Math.round((filled / total) * 100);

  const missionItems = [
    nonEmpty(org.mission_statement),
    nonEmpty(org.vision_statement),
    hasItems(extended.core_values),
    nonEmpty(org.founding_date),
  ];

  const programsItems = [
    programCount >= 1,
    programCount > 0 && programsWithDescription === programCount,
    programCount >= 3,
  ];

  const financialItems = [
    org.annual_budget != null,
    hasItems(extended.financial?.revenue_sources),
    extended.financial?.last_audited_revenue != null,
    nonEmpty(extended.financial?.fiscal_year_end),
    taxDocumentCount > 0,
  ];

  const leadershipItems = [
    nonEmpty(extended.executive_director?.name),
    nonEmpty(extended.executive_director?.bio),
    boardMemberCount >= 3,
    boardMemberCount > 0 && boardMembersWithBio === boardMemberCount,
  ];

  const geoItems = [
    nonEmpty(org.service_area),
    extended.geographic?.radius_miles != null,
    hasItems(extended.geographic?.counties),
    nonEmpty(extended.geographic?.description),
  ];

  const targetPopItems = [
    nonEmpty(org.target_population),
    hasItems(extended.target_population_detail?.demographics),
    hasItems(extended.target_population_detail?.languages),
    extended.target_population_detail?.population_size != null,
  ];

  const impactItems = [
    hasItems(extended.impact?.kpis),
    nonEmpty(extended.impact?.achievements),
    hasItems(extended.impact?.awards),
  ];

  const historyItems = [
    nonEmpty(org.founder_bio),
    hasItems(extended.history?.milestones),
    nonEmpty(extended.history?.challenges),
  ];

  const partnershipsItems = [
    hasItems(extended.partnerships?.partners),
    extended.partnerships?.government_contracts != null,
    hasItems(extended.partnerships?.coalitions),
  ];

  const complianceItems = [
    nonEmpty(org.tax_status),
    hasItems(extended.compliance?.state_registrations),
    nonEmpty(extended.compliance?.last_audit_date),
    extended.compliance?.insurance != null,
    extended.compliance?.background_check_policy != null,
  ];

  const count = (items: boolean[]) => items.filter(Boolean).length;

  return {
    mission_and_vision: pct(count(missionItems), missionItems.length),
    programs_and_services: pct(count(programsItems), programsItems.length),
    financial_profile: pct(count(financialItems), financialItems.length),
    leadership_and_board: pct(count(leadershipItems), leadershipItems.length),
    geographic_service_area: pct(count(geoItems), geoItems.length),
    target_population: pct(count(targetPopItems), targetPopItems.length),
    impact_and_outcomes: pct(count(impactItems), impactItems.length),
    organizational_history: pct(count(historyItems), historyItems.length),
    partnerships_and_coalitions: pct(count(partnershipsItems), partnershipsItems.length),
    compliance_and_certifications: pct(count(complianceItems), complianceItems.length),
  };
}

export function scoreColor(score: number): "green" | "amber" | "red" {
  if (score >= 80) return "green";
  if (score >= 40) return "amber";
  return "red";
}

/** Shallow-merges a partial ExtendedProfile onto the current one, one level
 * deep per top-level key (so patching `financial` doesn't drop `geographic`,
 * and patching `financial.endowment` doesn't drop `financial.revenue_sources`). */
export function mergeExtendedProfile(
  current: ExtendedProfile,
  patch: Partial<ExtendedProfile>,
): ExtendedProfile {
  const next: ExtendedProfile = { ...current };
  for (const key of Object.keys(patch) as (keyof ExtendedProfile)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    const currentValue = current[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      currentValue &&
      typeof currentValue === "object" &&
      !Array.isArray(currentValue)
    ) {
      (next as Record<string, unknown>)[key] = {
        ...(currentValue as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
    } else {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}
