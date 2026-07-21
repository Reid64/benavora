import type { SupabaseClient } from "@supabase/supabase-js";

// Data aggregator for the organization impact report at /reports/impact
// (GET/PUT /api/reports/impact, POST /api/reports/impact/enhance).
//
// Two fields the task spec named don't exist as real columns/tables, checked
// against SCHEMA_REGISTRY_v2.md's live-database audit before building:
//   - "knowledge_base_profiles" — no such table. Mission statement comes from
//     organizations.mission_statement (the real column); "Looking Ahead"
//     goals are sourced from knowledge_base entries with
//     category IN ('vision','sustainability') — the closest real KB
//     categories to forward-looking narrative (see knowledge_base_category
//     enum, migration 001).
//   - "admin vs program expense ratio" — grant_budgets/grant_expenses/
//     grant_reconciliation_reports are migration-file-only per the July 19,
//     2026 live audit (never applied to prod). No expense-category table
//     exists. Financial Stewardship therefore reports what IS real
//     (organizations.annual_budget, awarded/requested totals, and a revenue
//     breakdown by funder category) rather than fabricating a program/admin
//     split with no data source.
//
// "Stories of Impact" (a free-text field the org edits) has no dedicated
// table either. platform_config (organization_id, key, value — already used
// for feature flags / ai.model elsewhere in this codebase) is the correct
// existing home for this: a JSON-encoded array under key "impact_report_stories".

const STORIES_CONFIG_KEY = "impact_report_stories";

export interface ImpactProgram {
  id: string;
  name: string;
  description: string | null;
  budget: number | null;
  beneficiariesServed: number | null;
  startDate: string | null;
  status: string | null;
  impactMetrics: unknown;
}

export interface ImpactFinancial {
  annualBudget: number | null;
  totalRequested: number;
  totalAwarded: number;
  awardedCount: number;
  byCategory: { category: string; awarded: number }[];
}

export interface ImpactPartner {
  id: string;
  name: string;
  category: string;
  website: string | null;
  timesAwarded: number;
}

export interface LookingAheadEntry {
  id: string;
  title: string;
  content: string;
  category: string;
}

export interface ImpactReportData {
  organization: {
    name: string;
    missionStatement: string | null;
    visionStatement: string | null;
    serviceArea: string | null;
    targetPopulation: string | null;
  };
  programs: ImpactProgram[];
  financial: ImpactFinancial;
  communityMetrics: { programName: string; metrics: unknown }[];
  partners: ImpactPartner[];
  lookingAhead: LookingAheadEntry[];
  stories: string[];
}

interface OrgRow {
  name: string;
  mission_statement: string | null;
  vision_statement: string | null;
  service_area: string | null;
  target_population: string | null;
  annual_budget: number | null;
}

interface ProgramRow {
  id: string;
  name: string;
  description: string | null;
  budget: number | null;
  beneficiaries_served: number | null;
  start_date: string | null;
  status: string | null;
  impact_metrics: unknown;
}

interface ApplicationFinRow {
  id: string;
  requested_amount: number | null;
  opportunities: { category: string; funder_id: string | null } | null;
}

interface OutcomeFinRow {
  application_id: string | null;
  result: string;
  awarded_amount: number | null;
}

interface FunderRow {
  id: string;
  name: string;
  category: string;
  website: string | null;
}

interface KbRow {
  id: string;
  title: string;
  content: string;
  category: string;
}

export async function aggregateImpactReportData(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ImpactReportData> {
  const [orgRes, programsRes, applicationsRes, outcomesRes, fundersRes, kbRes, storiesRes] = await Promise.all([
    supabase
      .from("organizations")
      .select("name, mission_statement, vision_statement, service_area, target_population, annual_budget")
      .eq("id", organizationId)
      .single(),

    supabase
      .from("programs")
      .select("id, name, description, budget, beneficiaries_served, start_date, status, impact_metrics")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false }),

    supabase
      .from("applications")
      .select("id, requested_amount, opportunities(category, funder_id)")
      .eq("organization_id", organizationId),

    supabase
      .from("outcomes")
      .select("application_id, result, awarded_amount")
      .eq("organization_id", organizationId),

    supabase.from("funders").select("id, name, category, website").eq("organization_id", organizationId),

    supabase
      .from("knowledge_base")
      .select("id, title, content, category")
      .eq("organization_id", organizationId)
      .in("category", ["vision", "sustainability"])
      .order("updated_at", { ascending: false })
      .limit(6),

    supabase
      .from("platform_config")
      .select("value")
      .eq("organization_id", organizationId)
      .eq("key", STORIES_CONFIG_KEY)
      .maybeSingle(),
  ]);

  const org = orgRes.data as OrgRow | null;
  const programs = (programsRes.data ?? []) as ProgramRow[];
  const applications = (applicationsRes.data ?? []) as unknown as ApplicationFinRow[];
  const outcomes = (outcomesRes.data ?? []) as OutcomeFinRow[];
  const funders = (fundersRes.data ?? []) as FunderRow[];
  const kb = (kbRes.data ?? []) as KbRow[];

  const applicationById = new Map(applications.map((a) => [a.id, a]));

  // ---- Financial stewardship: real numbers only (see header note) ----
  const totalRequested = applications.reduce((sum, a) => sum + (a.requested_amount ?? 0), 0);
  const awardedOutcomes = outcomes.filter((o) => o.result === "awarded");
  const totalAwarded = awardedOutcomes.reduce((sum, o) => sum + (o.awarded_amount ?? 0), 0);

  const categoryMap = new Map<string, number>();
  for (const outcome of awardedOutcomes) {
    if (!outcome.application_id) continue;
    const app = applicationById.get(outcome.application_id);
    const category = app?.opportunities?.category ?? "uncategorized";
    categoryMap.set(category, (categoryMap.get(category) ?? 0) + (outcome.awarded_amount ?? 0));
  }
  const byCategory = Array.from(categoryMap.entries())
    .map(([category, awarded]) => ({ category, awarded }))
    .sort((a, b) => b.awarded - a.awarded);

  const financial: ImpactFinancial = {
    annualBudget: org?.annual_budget ?? null,
    totalRequested,
    totalAwarded,
    awardedCount: awardedOutcomes.length,
    byCategory,
  };

  // ---- Partners: funders with at least one awarded outcome ----
  const funderAwardCounts = new Map<string, number>();
  for (const outcome of awardedOutcomes) {
    if (!outcome.application_id) continue;
    const funderId = applicationById.get(outcome.application_id)?.opportunities?.funder_id;
    if (!funderId) continue;
    funderAwardCounts.set(funderId, (funderAwardCounts.get(funderId) ?? 0) + 1);
  }
  const partners: ImpactPartner[] = funders
    .filter((f) => funderAwardCounts.has(f.id))
    .map((f) => ({
      id: f.id,
      name: f.name,
      category: f.category,
      website: f.website,
      timesAwarded: funderAwardCounts.get(f.id) ?? 0,
    }))
    .sort((a, b) => b.timesAwarded - a.timesAwarded);

  const lookingAhead: LookingAheadEntry[] = kb.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category,
  }));

  let stories: string[] = [];
  const storedValue = (storiesRes.data as { value: string } | null)?.value;
  if (storedValue) {
    try {
      const parsed = JSON.parse(storedValue) as unknown;
      if (Array.isArray(parsed)) {
        stories = parsed.filter((s): s is string => typeof s === "string").slice(0, 2);
      }
    } catch {
      stories = [];
    }
  }

  return {
    organization: {
      name: org?.name ?? "Organization",
      missionStatement: org?.mission_statement ?? null,
      visionStatement: org?.vision_statement ?? null,
      serviceArea: org?.service_area ?? null,
      targetPopulation: org?.target_population ?? null,
    },
    programs: programs.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      budget: p.budget,
      beneficiariesServed: p.beneficiaries_served,
      startDate: p.start_date,
      status: p.status,
      impactMetrics: p.impact_metrics,
    })),
    financial,
    communityMetrics: programs
      .filter((p) => p.impact_metrics !== null && p.impact_metrics !== undefined)
      .map((p) => ({ programName: p.name, metrics: p.impact_metrics })),
    partners,
    lookingAhead,
    stories,
  };
}

export async function saveImpactStories(
  supabase: SupabaseClient,
  organizationId: string,
  stories: string[],
): Promise<void> {
  const value = JSON.stringify(stories.slice(0, 2));
  await supabase
    .from("platform_config")
    .upsert(
      { organization_id: organizationId, key: STORIES_CONFIG_KEY, value, updated_at: new Date().toISOString() },
      { onConflict: "organization_id,key" },
    );
}

export function buildImpactNarrativePrompt(data: ImpactReportData): string {
  const { organization, programs, financial, partners, lookingAhead, stories } = data;

  const programsSummary = programs
    .map(
      (p) =>
        `  - ${p.name}${p.beneficiariesServed ? ` — ${p.beneficiariesServed.toLocaleString()} served` : ""}${p.description ? `: ${p.description}` : ""}`,
    )
    .join("\n");

  const partnersSummary = partners.slice(0, 8).map((p) => `  - ${p.name}`).join("\n");

  const goalsSummary = lookingAhead.map((g) => `  - ${g.title}: ${g.content}`).join("\n");

  const storiesSummary = stories.map((s, i) => `  Story ${i + 1}: ${s}`).join("\n\n");

  return `You are a professional nonprofit communications writer. Turn the organizational data below into a polished, publication-ready impact report narrative suitable for donors and funders. Write 4-6 short sections with clear subheadings (plain text subheadings, no markdown symbols), warm but professional tone, specific numbers where given. Do not invent statistics, partner names, or outcomes not present in the data below. Return only the narrative text.

ORGANIZATION: ${organization.name}
${organization.missionStatement ? `MISSION: ${organization.missionStatement}` : ""}
${organization.serviceArea ? `SERVICE AREA: ${organization.serviceArea}` : ""}
${organization.targetPopulation ? `POPULATION SERVED: ${organization.targetPopulation}` : ""}

PROGRAMS:
${programsSummary || "  No programs on file."}

FINANCIAL STEWARDSHIP:
  Annual Operating Budget: ${financial.annualBudget ? `$${financial.annualBudget.toLocaleString()}` : "not disclosed"}
  Total Grant Revenue Secured: $${financial.totalAwarded.toLocaleString()} across ${financial.awardedCount} award${financial.awardedCount === 1 ? "" : "s"}

FUNDING PARTNERS:
${partnersSummary || "  None recorded yet."}

STORIES OF IMPACT (use verbatim or lightly polished, do not fabricate additional stories):
${storiesSummary || "  None provided."}

LOOKING AHEAD:
${goalsSummary || "  No stated goals on file."}`;
}
