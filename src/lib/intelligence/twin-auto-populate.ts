// Digital Twin Auto-Population (AUTONOMOUS_PLATFORM_VISION.md Phase 2
// "Fundability Intelligence Score" / AGENTS_v2.md AG-16 Digital Twin Builder,
// AG-29 Fundability Scorer). Companion to twin-completeness.ts's
// calculateTwinCompleteness() and digital-twin-builder.ts's buildDigitalTwin().
//
// Task-given spec vs real schema (same pattern documented in
// twin-completeness.ts's own header -- checked before writing a line of code
// here, per this project's established practice):
//   - There is no `knowledge_base_profiles` table anywhere in this schema.
//     The real KB table is `knowledge_base` (organization_id, category,
//     title, content, is_proven, funder_categories, keywords) -- see
//     migration 001 and digital-twin-builder.ts. "Populate KB mission" below
//     means: insert a knowledge_base row with category='mission'.
//   - `nonprofits` (the IRS BMF import table, STANDING_DIRECTIVES.md
//     Directive 2) DOES exist -- migrations 098/099 (supabase/migrations/,
//     not src/supabase/migrations/) -- with real columns ein, name, city,
//     state, revenue_amount, asset_amount, mission, officer_name,
//     officer_title, officer_email, enrichment_tier, last_enriched_at, etc.
//   - `organizational_digital_twins` (migration 093, same directory) has no
//     `completeness_score` or `twin_auto_populate_log` column -- the real
//     score column is `twin_completeness_score`; `twin_auto_populate_log`
//     jsonb is added by migration 101 (twin_auto_populate_log.sql) alongside
//     this file.
//   - "leadership_board" / "financial_data.annual_revenue" /
//     "financial_data.total_assets" / "financial_data.grant_history" have no
//     literal backing fields. The real analogs are: board_members (table),
//     organizations.annual_budget (real column feeding
//     organizational_digital_twins.financial_profile.annual_budget via
//     buildDigitalTwin()). total_assets and grant_history have NO backing
//     column anywhere -- organizations has no asset_amount column and
//     financial_profile is a flat {annual_budget, total_staff,
//     total_volunteers} map rebuilt from scratch by buildDigitalTwin() on
//     every call (see digital-twin-builder.ts buildFinancialProfile()).
//     Rather than fabricate columns, this module stores those two values as
//     extra keys merged onto financial_profile *after* buildDigitalTwin()
//     runs, and records a warning that a future buildDigitalTwin() rebuild
//     that isn't followed by this same merge step will drop them again --
//     the correct long-term fix is a schema migration adding
//     organizations.asset_amount and a dedicated grant_history table, out of
//     scope here.
//   - "ProPublica" data: no dedicated ProPublica table exists. The real
//     shared foundation dataset is `foundation_directory` (migration 046,
//     `enrichment` jsonb added by migration 072 for 990-derived grant data)
//     plus the computed `foundation_profiles` (migration 081:
//     avg_grant_size, funding_categories). Matched by EIN, same as
//     `nonprofits`.
//   - Org scoping column is `organization_id` on organizations/knowledge_base
//     /board_members/organizational_digital_twins, but `org_id` on
//     agent_decisions (migration 080, autonomous-infrastructure era) -- both
//     used correctly below, not conflated (see digital-twin-builder.ts's own
//     header note on this exact split).
//
// "Never overwrite existing non-null data": every source below is gated on
// the destination field being null/empty *before* writing, checked against
// freshly-reloaded state after each prior source runs (not a single
// snapshot), so source 2 correctly sees what source 1 already filled in.

import type { SupabaseClient } from "@supabase/supabase-js";

import { callClaude, callClaudeWithWebSearch } from "@/lib/ai/claude";
import { buildDigitalTwin } from "@/lib/intelligence/digital-twin-builder";
import {
  calculateTwinCompleteness,
  type KnowledgeBaseEntry,
  type KnowledgeBaseProfile,
  type OrganizationalDigitalTwin,
} from "@/lib/intelligence/twin-completeness";

export interface AutoPopulateResult {
  fieldsPopulated: number;
  fieldsSkipped: number;
  sources: string[];
  warnings: string[];
  /** calculateTwinCompleteness()'s overall_score after population, persisted
   * to organizational_digital_twins.twin_completeness_score. Not in the
   * task-given result shape (which has no score field) -- added because the
   * task explicitly requires returning the updated score after recomputing
   * it; omitting it would make the return value undiscoverable to callers. */
  newCompletenessScore: number;
}

interface LogEntry {
  source: string;
  field: string;
  action: "populated" | "skipped";
  detail: string;
  at: string;
}

interface OrgRow {
  id: string;
  ein: string | null;
  name: string;
  city: string | null;
  state: string | null;
  mission_statement: string | null;
  target_population: string | null;
  annual_budget: number | null;
  founding_date: string | null;
  founder_name: string | null;
  tax_status: string | null;
}

interface NonprofitRow {
  id: string;
  ein: string;
  mission: string | null;
  officer_name: string | null;
  officer_title: string | null;
  revenue_amount: number | null;
  asset_amount: number | null;
}

interface FoundationDirectoryRow {
  id: string;
  ein: string;
  enrichment: Record<string, unknown> | null;
}

interface FoundationProfileRow {
  avg_grant_size: number | null;
  funding_categories: string[] | null;
}

interface AgentDecisionRow {
  agent_id: string;
  decision_type: string;
  reasoning: string;
  action_taken: string;
  created_at: string;
}

interface WebSearchExtraction {
  programs: { title: string; description: string }[];
  impact_statistics: string[];
  leadership: { name: string; title: string | null }[];
}

interface AgentDecisionExtraction {
  category: string;
  title: string;
  content: string;
}

const MAX_WEB_SEARCH_PROGRAMS = 3;
const MAX_WEB_SEARCH_LEADERS = 5;
const MAX_AGENT_DECISION_ROWS = 30;
const MAX_AGENT_DECISION_FACTS = 5;

function nonEmpty(text: string | null | undefined): boolean {
  return Boolean(text && text.trim() !== "");
}

async function loadOrg(
  orgId: string,
  supabase: SupabaseClient,
): Promise<OrgRow> {
  const { data, error } = await supabase
    .from("organizations")
    .select(
      "id, ein, name, city, state, mission_statement, target_population, annual_budget, founding_date, founder_name, tax_status",
    )
    .eq("id", orgId)
    .maybeSingle();

  if (error || !data) {
    throw new Error(
      `Could not load organization ${orgId}: ${error?.message ?? "not found"}`,
    );
  }
  return data as OrgRow;
}

async function loadKnowledgeBase(
  orgId: string,
  supabase: SupabaseClient,
): Promise<KnowledgeBaseEntry[]> {
  const { data } = await supabase
    .from("knowledge_base")
    .select("id, category, title, content, is_proven, funder_categories")
    .eq("organization_id", orgId);
  return (data ?? []) as KnowledgeBaseEntry[];
}

async function countActiveBoardMembers(
  orgId: string,
  supabase: SupabaseClient,
): Promise<number> {
  const { count } = await supabase
    .from("board_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("is_active", true);
  return count ?? 0;
}

function hasMission(org: OrgRow, kb: KnowledgeBaseEntry[]): boolean {
  if (nonEmpty(org.mission_statement)) return true;
  return kb.some((e) => e.category === "mission" && nonEmpty(e.content));
}

function hasProgramDescriptions(kb: KnowledgeBaseEntry[]): boolean {
  return kb.some((e) => e.category === "program_description");
}

function hasImpactEntry(kb: KnowledgeBaseEntry[]): boolean {
  return kb.some((e) => e.category === "impact");
}

// ---------------------------------------------------------------------------
// SOURCE 1 -- nonprofits (IRS BMF import, migrations 098/099)
// ---------------------------------------------------------------------------
async function populateFromNonprofits(
  orgId: string,
  org: OrgRow,
  kb: KnowledgeBaseEntry[],
  boardCount: number,
  supabase: SupabaseClient,
  log: LogEntry[],
  warnings: string[],
): Promise<{ assetAmount: number | null }> {
  if (!nonEmpty(org.ein)) {
    log.push({
      source: "nonprofits",
      field: "*",
      action: "skipped",
      detail: "Organization has no EIN on file -- cannot match against nonprofits.",
      at: new Date().toISOString(),
    });
    return { assetAmount: null };
  }

  const { data: nonprofitRow } = await supabase
    .from("nonprofits")
    .select(
      "id, ein, mission, officer_name, officer_title, revenue_amount, asset_amount",
    )
    .eq("ein", org.ein)
    .maybeSingle();

  if (!nonprofitRow) {
    log.push({
      source: "nonprofits",
      field: "*",
      action: "skipped",
      detail: `No nonprofits row found for EIN ${org.ein}.`,
      at: new Date().toISOString(),
    });
    return { assetAmount: null };
  }

  const nonprofit = nonprofitRow as NonprofitRow;

  // (a) KB mission
  if (!hasMission(org, kb) && nonEmpty(nonprofit.mission)) {
    const { error } = await supabase.from("knowledge_base").insert({
      organization_id: orgId,
      category: "mission",
      title: "Mission Statement (IRS BMF)",
      content: nonprofit.mission,
    });
    log.push({
      source: "nonprofits",
      field: "knowledge_base.mission",
      action: error ? "skipped" : "populated",
      detail: error
        ? `Insert failed: ${error.message}`
        : "Inserted mission KB entry from nonprofits.mission.",
      at: new Date().toISOString(),
    });
  } else {
    log.push({
      source: "nonprofits",
      field: "knowledge_base.mission",
      action: "skipped",
      detail: hasMission(org, kb)
        ? "Mission already populated."
        : "nonprofits.mission is null.",
      at: new Date().toISOString(),
    });
  }

  // (b) leadership -> board_members
  if (boardCount === 0 && nonEmpty(nonprofit.officer_name)) {
    const { error } = await supabase.from("board_members").insert({
      organization_id: orgId,
      name: nonprofit.officer_name,
      title: nonprofit.officer_title,
      is_active: true,
    });
    log.push({
      source: "nonprofits",
      field: "board_members",
      action: error ? "skipped" : "populated",
      detail: error
        ? `Insert failed: ${error.message}`
        : `Added board member ${nonprofit.officer_name} from nonprofits.officer_name.`,
      at: new Date().toISOString(),
    });
  } else {
    log.push({
      source: "nonprofits",
      field: "board_members",
      action: "skipped",
      detail: boardCount > 0 ? "Board is not empty." : "nonprofits.officer_name is null.",
      at: new Date().toISOString(),
    });
  }

  // (c) annual_revenue -> organizations.annual_budget
  if (org.annual_budget == null && nonprofit.revenue_amount != null) {
    const { error } = await supabase
      .from("organizations")
      .update({ annual_budget: nonprofit.revenue_amount })
      .eq("id", orgId);
    log.push({
      source: "nonprofits",
      field: "organizations.annual_budget",
      action: error ? "skipped" : "populated",
      detail: error
        ? `Update failed: ${error.message}`
        : `Set annual_budget from nonprofits.revenue_amount (${nonprofit.revenue_amount}).`,
      at: new Date().toISOString(),
    });
  } else {
    log.push({
      source: "nonprofits",
      field: "organizations.annual_budget",
      action: "skipped",
      detail:
        org.annual_budget != null
          ? "annual_budget already populated."
          : "nonprofits.revenue_amount is null.",
      at: new Date().toISOString(),
    });
  }

  // (d) total_assets -- no backing column, see file header. Deferred to the
  // caller, which merges it onto financial_profile as an extra jsonb key
  // after buildDigitalTwin() runs.
  if (nonprofit.asset_amount != null) {
    warnings.push(
      "nonprofits.asset_amount found but organizations/organizational_digital_twins has no dedicated total_assets column -- stored as financial_profile.total_assets, an extra jsonb key that a future buildDigitalTwin() rebuild will drop unless this auto-populate step is re-run.",
    );
  }

  return { assetAmount: nonprofit.asset_amount };
}

// ---------------------------------------------------------------------------
// SOURCE 2 -- Claude web search
// ---------------------------------------------------------------------------
async function extractFromWebSearch(
  org: OrgRow,
): Promise<{ extraction: WebSearchExtraction; grounded: boolean; warning?: string }> {
  const cityState = [org.city, org.state].filter(Boolean).join(", ");
  const query1 = `${org.name}${cityState ? ` ${cityState}` : ""} nonprofit about mission programs`;
  const query2 = `${org.name} annual report 2024 2025`;

  const prompt =
    `You are researching a real nonprofit organization using web search to fill gaps in its profile. ` +
    `Organization: ${org.name}${cityState ? `, located in ${cityState}` : ""}.\n\n` +
    `Run these two searches and use only what you find via search -- never invent or estimate from general knowledge:\n` +
    `1. "${query1}"\n` +
    `2. "${query2}"\n\n` +
    `Extract: (a) any specific program descriptions (beyond a generic mission statement), ` +
    `(b) any concrete impact statistics (numbers, counts, percentages, people served), ` +
    `(c) any named leadership/officer/board members and their titles.\n\n` +
    `Respond with ONLY a JSON object (no markdown fences, no prose) shaped exactly ` +
    `{"programs": [{"title": string, "description": string}], "impact_statistics": [string], ` +
    `"leadership": [{"name": string, "title": string|null}]}. ` +
    `Use empty arrays for anything you found no real evidence for.`;

  const response = await callClaudeWithWebSearch({
    prompt,
    maxTokens: 1200,
    maxSearches: 4,
  });

  if (!response.usedWebSearch) {
    return {
      extraction: { programs: [], impact_statistics: [], leadership: [] },
      grounded: false,
      warning:
        "Claude did not issue a web_search call for SOURCE 2 -- discarded ungrounded response rather than persist fabricated data.",
    };
  }

  try {
    const jsonText = response.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "");
    const parsed = JSON.parse(jsonText) as Partial<WebSearchExtraction>;
    return {
      extraction: {
        programs: Array.isArray(parsed.programs) ? parsed.programs : [],
        impact_statistics: Array.isArray(parsed.impact_statistics)
          ? parsed.impact_statistics
          : [],
        leadership: Array.isArray(parsed.leadership) ? parsed.leadership : [],
      },
      grounded: true,
    };
  } catch (parseErr) {
    return {
      extraction: { programs: [], impact_statistics: [], leadership: [] },
      grounded: false,
      warning: `Could not parse SOURCE 2 web search response as JSON: ${
        parseErr instanceof Error ? parseErr.message : "unknown parse error"
      }`,
    };
  }
}

async function populateFromWebSearch(
  orgId: string,
  org: OrgRow,
  kb: KnowledgeBaseEntry[],
  boardCount: number,
  supabase: SupabaseClient,
  log: LogEntry[],
  warnings: string[],
): Promise<void> {
  const { extraction, grounded, warning } = await extractFromWebSearch(org);
  if (warning) warnings.push(warning);

  if (!grounded) {
    log.push({
      source: "web_search",
      field: "*",
      action: "skipped",
      detail: warning ?? "Web search extraction unavailable.",
      at: new Date().toISOString(),
    });
    return;
  }

  // Program descriptions -- only if still empty after SOURCE 1.
  if (!hasProgramDescriptions(kb) && extraction.programs.length > 0) {
    const toInsert = extraction.programs.slice(0, MAX_WEB_SEARCH_PROGRAMS);
    for (const program of toInsert) {
      const { error } = await supabase.from("knowledge_base").insert({
        organization_id: orgId,
        category: "program_description",
        title: program.title,
        content: program.description,
      });
      log.push({
        source: "web_search",
        field: "knowledge_base.program_description",
        action: error ? "skipped" : "populated",
        detail: error
          ? `Insert failed: ${error.message}`
          : `Added program "${program.title}" from web search.`,
        at: new Date().toISOString(),
      });
    }
  } else {
    log.push({
      source: "web_search",
      field: "knowledge_base.program_description",
      action: "skipped",
      detail: hasProgramDescriptions(kb)
        ? "Program descriptions already populated."
        : "No programs found via web search.",
      at: new Date().toISOString(),
    });
  }

  // Impact statistics -- only if still empty after SOURCE 1.
  if (!hasImpactEntry(kb) && extraction.impact_statistics.length > 0) {
    const { error } = await supabase.from("knowledge_base").insert({
      organization_id: orgId,
      category: "impact",
      title: "Impact Statistics (web search)",
      content: extraction.impact_statistics.join("\n"),
    });
    log.push({
      source: "web_search",
      field: "knowledge_base.impact",
      action: error ? "skipped" : "populated",
      detail: error
        ? `Insert failed: ${error.message}`
        : `Added ${extraction.impact_statistics.length} impact statistic(s) from web search.`,
      at: new Date().toISOString(),
    });
  } else {
    log.push({
      source: "web_search",
      field: "knowledge_base.impact",
      action: "skipped",
      detail: hasImpactEntry(kb)
        ? "Impact entry already populated."
        : "No impact statistics found via web search.",
      at: new Date().toISOString(),
    });
  }

  // Leadership -- only if board is still empty after SOURCE 1.
  if (boardCount === 0 && extraction.leadership.length > 0) {
    const toInsert = extraction.leadership.slice(0, MAX_WEB_SEARCH_LEADERS);
    for (const leader of toInsert) {
      const { error } = await supabase.from("board_members").insert({
        organization_id: orgId,
        name: leader.name,
        title: leader.title,
        is_active: true,
      });
      log.push({
        source: "web_search",
        field: "board_members",
        action: error ? "skipped" : "populated",
        detail: error
          ? `Insert failed: ${error.message}`
          : `Added ${leader.name} from web search.`,
        at: new Date().toISOString(),
      });
    }
  } else {
    log.push({
      source: "web_search",
      field: "board_members",
      action: "skipped",
      detail: boardCount > 0 ? "Board is not empty." : "No leadership names found via web search.",
      at: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// SOURCE 3 -- foundation_directory / foundation_profiles (the real
// "ProPublica / foundation data" -- see file header)
// ---------------------------------------------------------------------------
async function populateFromFoundationData(
  org: OrgRow,
  supabase: SupabaseClient,
  log: LogEntry[],
  warnings: string[],
): Promise<{ grantHistory: Record<string, unknown> | null }> {
  if (!nonEmpty(org.ein)) {
    log.push({
      source: "foundation_data",
      field: "*",
      action: "skipped",
      detail: "Organization has no EIN on file -- cannot match against foundation_directory.",
      at: new Date().toISOString(),
    });
    return { grantHistory: null };
  }

  const { data: foundationRow } = await supabase
    .from("foundation_directory")
    .select("id, ein, enrichment")
    .eq("ein", org.ein)
    .maybeSingle();

  if (!foundationRow) {
    log.push({
      source: "foundation_data",
      field: "*",
      action: "skipped",
      detail: `No foundation_directory row found for EIN ${org.ein}.`,
      at: new Date().toISOString(),
    });
    return { grantHistory: null };
  }

  const foundation = foundationRow as FoundationDirectoryRow;

  const { data: profileRow } = await supabase
    .from("foundation_profiles")
    .select("avg_grant_size, funding_categories")
    .eq("foundation_id", foundation.id)
    .maybeSingle();

  const profile = profileRow as FoundationProfileRow | null;

  const grantHistory: Record<string, unknown> = {};
  if (profile?.avg_grant_size != null) {
    grantHistory.avg_grant_size = profile.avg_grant_size;
  }
  if (profile?.funding_categories && profile.funding_categories.length > 0) {
    grantHistory.funding_categories = profile.funding_categories;
  }
  const enrichmentGrantData = foundation.enrichment;
  if (enrichmentGrantData && typeof enrichmentGrantData === "object") {
    for (const key of ["grant_count", "typical_grant_range", "fiscal_year"]) {
      if (key in enrichmentGrantData) {
        grantHistory[key] = (enrichmentGrantData as Record<string, unknown>)[key];
      }
    }
  }

  if (Object.keys(grantHistory).length === 0) {
    log.push({
      source: "foundation_data",
      field: "financial_profile.grant_history",
      action: "skipped",
      detail: "Matched foundation_directory row but no grant history fields available.",
      at: new Date().toISOString(),
    });
    return { grantHistory: null };
  }

  warnings.push(
    "foundation_directory/foundation_profiles grant history found but organizational_digital_twins.financial_profile has no dedicated grant_history column -- stored as financial_profile.grant_history, an extra jsonb key that a future buildDigitalTwin() rebuild will drop unless this auto-populate step is re-run.",
  );
  log.push({
    source: "foundation_data",
    field: "financial_profile.grant_history",
    action: "populated",
    detail: `Extracted grant history from foundation EIN match: ${JSON.stringify(grantHistory)}.`,
    at: new Date().toISOString(),
  });

  return { grantHistory };
}

// ---------------------------------------------------------------------------
// SOURCE 4 -- agent_decisions (past reasoning that mentioned org
// characteristics)
// ---------------------------------------------------------------------------
async function populateFromAgentDecisions(
  orgId: string,
  org: OrgRow,
  kb: KnowledgeBaseEntry[],
  supabase: SupabaseClient,
  log: LogEntry[],
  warnings: string[],
): Promise<void> {
  // agent_decisions uses `org_id`, not `organization_id` -- see file header.
  const { data: decisionRows } = await supabase
    .from("agent_decisions")
    .select("agent_id, decision_type, reasoning, action_taken, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(MAX_AGENT_DECISION_ROWS);

  const decisions = (decisionRows ?? []) as AgentDecisionRow[];
  if (decisions.length === 0) {
    log.push({
      source: "agent_decisions",
      field: "*",
      action: "skipped",
      detail: "No agent_decisions rows on file for this org.",
      at: new Date().toISOString(),
    });
    return;
  }

  const stillMissing = {
    mission: !hasMission(org, kb),
    program_description: !hasProgramDescriptions(kb),
    impact: !hasImpactEntry(kb),
  };

  if (!stillMissing.mission && !stillMissing.program_description && !stillMissing.impact) {
    log.push({
      source: "agent_decisions",
      field: "*",
      action: "skipped",
      detail: "Mission, program_description, and impact are already populated -- nothing left for this source to fill.",
      at: new Date().toISOString(),
    });
    return;
  }

  const digest = decisions
    .map((d) => `[${d.agent_id} / ${d.decision_type}] ${d.reasoning} -> ${d.action_taken}`)
    .join("\n");

  const missingList = Object.entries(stillMissing)
    .filter(([, missing]) => missing)
    .map(([field]) => field);

  const prompt =
    `Below is a log of an autonomous agent system's past decision reasoning for one nonprofit organization ` +
    `(${org.name}). Extract only CONCRETE FACTS about the organization itself (its mission, its programs, or ` +
    `its measurable impact) that are stated as fact in this reasoning -- not the agent's own meta-commentary ` +
    `about scores, confidence, or what action it took.\n\n` +
    `Only extract facts relevant to these still-missing profile fields: ${missingList.join(", ")}.\n\n` +
    `${digest.slice(0, 6000)}\n\n` +
    `Respond with ONLY a JSON array (no markdown fences, no prose) of up to ${MAX_AGENT_DECISION_FACTS} objects ` +
    `shaped exactly {"category": one of ${JSON.stringify(missingList)}, "title": string, "content": string}. ` +
    `If you find no real org-characteristic facts (only agent meta-commentary), respond with [].`;

  let facts: AgentDecisionExtraction[] = [];
  try {
    const response = await callClaude({ prompt, maxTokens: 800 });
    const jsonText = response.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "");
    const parsed: unknown = JSON.parse(jsonText);
    if (Array.isArray(parsed)) facts = parsed as AgentDecisionExtraction[];
  } catch (err) {
    warnings.push(
      `SOURCE 4 (agent_decisions) fact extraction failed: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    );
  }

  const validFacts = facts
    .filter(
      (f) =>
        missingList.includes(f.category) && nonEmpty(f.title) && nonEmpty(f.content),
    )
    .slice(0, MAX_AGENT_DECISION_FACTS);

  if (validFacts.length === 0) {
    log.push({
      source: "agent_decisions",
      field: missingList.join(", "),
      action: "skipped",
      detail: "No usable org-characteristic facts extracted from past agent reasoning.",
      at: new Date().toISOString(),
    });
    return;
  }

  // Re-check "still missing" per-category as we insert, in case an earlier
  // fact in this same batch already filled it (e.g. two mission facts).
  const filled = { mission: !stillMissing.mission, program_description: !stillMissing.program_description, impact: !stillMissing.impact };

  for (const fact of validFacts) {
    const category = fact.category as "mission" | "program_description" | "impact";
    if (filled[category]) {
      log.push({
        source: "agent_decisions",
        field: `knowledge_base.${category}`,
        action: "skipped",
        detail: "Field was filled earlier in this same run.",
        at: new Date().toISOString(),
      });
      continue;
    }

    const { error } = await supabase.from("knowledge_base").insert({
      organization_id: orgId,
      category,
      title: fact.title,
      content: fact.content,
    });

    log.push({
      source: "agent_decisions",
      field: `knowledge_base.${category}`,
      action: error ? "skipped" : "populated",
      detail: error
        ? `Insert failed: ${error.message}`
        : `Extracted "${fact.title}" from past agent_decisions reasoning.`,
      at: new Date().toISOString(),
    });

    if (!error) filled[category] = true;
  }
}

// ---------------------------------------------------------------------------
// Final merge: extra financial_profile keys with no dedicated column
// ---------------------------------------------------------------------------
async function mergeFinancialExtras(
  orgId: string,
  extras: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<void> {
  if (Object.keys(extras).length === 0) return;

  const { data } = await supabase
    .from("organizational_digital_twins")
    .select("financial_profile")
    .eq("organization_id", orgId)
    .maybeSingle();

  const current = (data?.financial_profile as Record<string, unknown> | null) ?? {};
  await supabase
    .from("organizational_digital_twins")
    .update({ financial_profile: { ...current, ...extras } })
    .eq("organization_id", orgId);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export async function autoPopulateTwin(
  orgId: string,
  supabase: SupabaseClient,
): Promise<AutoPopulateResult> {
  const log: LogEntry[] = [];
  const warnings: string[] = [];
  const sources = ["nonprofits", "web_search", "foundation_data", "agent_decisions"];

  let org = await loadOrg(orgId, supabase);
  let kb = await loadKnowledgeBase(orgId, supabase);
  let boardCount = await countActiveBoardMembers(orgId, supabase);

  const { assetAmount } = await populateFromNonprofits(
    orgId,
    org,
    kb,
    boardCount,
    supabase,
    log,
    warnings,
  );

  // Reload state so SOURCE 2 correctly sees what SOURCE 1 already filled.
  org = await loadOrg(orgId, supabase);
  kb = await loadKnowledgeBase(orgId, supabase);
  boardCount = await countActiveBoardMembers(orgId, supabase);

  await populateFromWebSearch(orgId, org, kb, boardCount, supabase, log, warnings);

  const { grantHistory } = await populateFromFoundationData(
    org,
    supabase,
    log,
    warnings,
  );

  // Reload again so SOURCE 4 sees what SOURCES 1-2 already filled.
  org = await loadOrg(orgId, supabase);
  kb = await loadKnowledgeBase(orgId, supabase);

  await populateFromAgentDecisions(orgId, org, kb, supabase, log, warnings);

  // Rebuild the twin from the now-updated underlying tables (organizations,
  // knowledge_base, board_members, outcomes, applications) and persist it.
  await buildDigitalTwin(orgId, supabase);

  // Merge the two no-backing-column values on top of the freshly rebuilt
  // financial_profile (buildDigitalTwin() would otherwise have discarded
  // them, see file header).
  const financialExtras: Record<string, unknown> = {};
  if (assetAmount != null) financialExtras.total_assets = assetAmount;
  if (grantHistory) financialExtras.grant_history = grantHistory;
  await mergeFinancialExtras(orgId, financialExtras, supabase);

  // Reload the final persisted twin + KB to score completeness.
  const { data: twinRow, error: twinError } = await supabase
    .from("organizational_digital_twins")
    .select(
      "organization_id, mission, vision, service_areas, programs, financial_profile, board_composition, proven_narrative_patterns, key_strengths, known_weaknesses, twin_completeness_score, last_rebuilt_at",
    )
    .eq("organization_id", orgId)
    .maybeSingle();

  if (twinError || !twinRow) {
    throw new Error(
      `Failed to reload organizational_digital_twins for ${orgId}: ${
        twinError?.message ?? "no row found"
      }`,
    );
  }

  org = await loadOrg(orgId, supabase);
  kb = await loadKnowledgeBase(orgId, supabase);

  const { data: applicationsRes } = await supabase
    .from("applications")
    .select("id")
    .eq("organization_id", orgId);
  const { data: outcomesRes } = await supabase
    .from("outcomes")
    .select("result")
    .eq("organization_id", orgId);

  const twin: OrganizationalDigitalTwin = {
    organization_id: orgId,
    mission: twinRow.mission,
    vision: twinRow.vision,
    service_areas: twinRow.service_areas ?? [],
    programs: twinRow.programs ?? [],
    financial_profile: twinRow.financial_profile ?? {},
    board_composition: twinRow.board_composition ?? [],
    proven_narrative_patterns: twinRow.proven_narrative_patterns ?? [],
    key_strengths: twinRow.key_strengths ?? [],
    known_weaknesses: twinRow.known_weaknesses ?? [],
    twin_completeness_score: twinRow.twin_completeness_score ?? 0,
    last_rebuilt_at: twinRow.last_rebuilt_at ?? new Date().toISOString(),
    target_population: org.target_population,
    founding_date: org.founding_date,
    founder_name: org.founder_name,
    tax_status: org.tax_status,
    ein: org.ein,
    stats: {
      outcomes_count: (outcomesRes ?? []).length,
      kb_entries_count: kb.length,
      applications_count: (applicationsRes ?? []).length,
      applications_by_stage: {},
      most_applied_categories: [],
    },
  };

  const kbProfile: KnowledgeBaseProfile = { entries: kb };
  const report = await calculateTwinCompleteness(twin, kbProfile);

  const auditLog = log.map((entry) => ({ ...entry }));
  await supabase
    .from("organizational_digital_twins")
    .update({
      twin_completeness_score: report.overall_score,
      twin_auto_populate_log: auditLog,
      last_rebuilt_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId);

  const fieldsPopulated = log.filter((e) => e.action === "populated").length;
  const fieldsSkipped = log.filter((e) => e.action === "skipped").length;

  return {
    fieldsPopulated,
    fieldsSkipped,
    sources,
    warnings,
    newCompletenessScore: report.overall_score,
  };
}
