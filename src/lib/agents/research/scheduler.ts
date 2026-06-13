// Search-profile scheduling for the research agents (BLUEPRINT §4.12,
// BEHAVIORAL_CONTRACTS §14 + §17).
//
// Decides which saved search_profiles should drive a research run and turns each
// into concrete search queries. Responsibilities:
//   - Read only active profiles, capped at the per-org maximum of 10 (§14).
//   - Build search queries from a profile's keywords + categories + geography.
//   - Gate re-runs on last_run_at so a profile is not searched too frequently.
//   - Record last_run_at and accumulate results_count after a run.
//
// Every query is scoped by organization_id; profiles from other tenants are
// never visible (§2).

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseAgentSettings,
  parseEligibilityFilters,
  parseFocusAreas,
  parseSourceTypeFilters,
  type AgentSettings,
  type EligibilityFilters,
  type FocusArea,
  type SourceTypeFilter,
} from "@/lib/research/profile-config";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Json } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

/** Max active profiles a run will consider (Contracts §14). */
export const MAX_ACTIVE_PROFILES = 10;

/** Default minimum gap between automated runs of the same profile (24h). */
export const DEFAULT_MIN_RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Cap on generated queries per profile, to bound a run's web traffic. */
const MAX_QUERIES_PER_PROFILE = 12;

/** A search profile in the shape the scheduler/search pipeline consumes. */
export interface ResearchSearchProfile {
  id: string;
  name: string;
  keywords: string[];
  categories: FunderCategory[];
  geographicScope: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  recurrencePreference: string | null;
  isActive: boolean;
  lastRunAt: string | null;
  resultsCount: number;
  // Advanced configuration (migration 011), read before every run.
  /** All geographic scopes; geographicScope mirrors the first for compatibility. */
  geographicScopes: string[];
  /** Source-category filters with priority ranking (1 = highest). */
  sourceTypeFilters: SourceTypeFilter[];
  /** Focus-area tags with weights, woven into the agents' search queries. */
  focusAreas: FocusArea[];
  /** Structured eligibility pre-filters (surfaced to eligibility scoring). */
  eligibilityFilters: EligibilityFilters;
  /** Population-served matching tags, woven into the agents' search queries. */
  populationsServed: string[];
  /** Negative filter: funder categories to skip. */
  excludedCategories: FunderCategory[];
  /** Negative filter: funder names to skip (case-insensitive). */
  excludedFunders: string[];
  /** Per-agent enable toggle + schedule, keyed by agent_type. */
  agentSettings: AgentSettings;
}

interface SearchProfileRow {
  id: string;
  name: string;
  keywords: string[] | null;
  categories: FunderCategory[] | null;
  geographic_scope: string | null;
  min_amount: number | null;
  max_amount: number | null;
  recurrence_preference: string | null;
  is_active: boolean | null;
  last_run_at: string | null;
  results_count: number | null;
  geographic_scopes: string[] | null;
  source_type_filters: Json | null;
  focus_areas: Json | null;
  eligibility_filters: Json | null;
  populations_served: string[] | null;
  excluded_categories: FunderCategory[] | null;
  excluded_funders: string[] | null;
  agent_settings: Json | null;
}

export interface SchedulerContext {
  client: SupabaseClient;
  organizationId: string;
}

function mapRow(row: SearchProfileRow): ResearchSearchProfile {
  const geographicScopes = (row.geographic_scopes ?? []).filter(
    (s) => typeof s === "string" && s.trim() !== "",
  );
  return {
    id: row.id,
    name: row.name,
    keywords: row.keywords ?? [],
    categories: row.categories ?? [],
    // Prefer the legacy single scope; fall back to the first multi-scope entry.
    geographicScope: row.geographic_scope ?? geographicScopes[0] ?? null,
    minAmount: row.min_amount,
    maxAmount: row.max_amount,
    recurrencePreference: row.recurrence_preference,
    isActive: row.is_active ?? false,
    lastRunAt: row.last_run_at,
    resultsCount: row.results_count ?? 0,
    geographicScopes,
    sourceTypeFilters: parseSourceTypeFilters(row.source_type_filters),
    focusAreas: parseFocusAreas(row.focus_areas),
    eligibilityFilters: parseEligibilityFilters(row.eligibility_filters),
    populationsServed: (row.populations_served ?? []).filter(
      (s) => typeof s === "string" && s.trim() !== "",
    ),
    excludedCategories: row.excluded_categories ?? [],
    excludedFunders: row.excluded_funders ?? [],
    agentSettings: parseAgentSettings(row.agent_settings),
  };
}

/**
 * The profile's funding categories minus its negative-filter exclusions
 * (Configuration page "excluded categories"). Agents use this - not the raw
 * `categories` - when deciding whether a profile is in scope for their family,
 * so an excluded category never pulls a profile into a sweep.
 */
export function effectiveCategories(
  profile: ResearchSearchProfile,
): FunderCategory[] {
  if (profile.excludedCategories.length === 0) return profile.categories;
  const excluded = new Set(profile.excludedCategories);
  return profile.categories.filter((c) => !excluded.has(c));
}

/**
 * Whether the profile enables the given research agent family (Configuration page
 * "per-agent toggle"). Defaults to enabled when the profile carries no explicit
 * setting for that agent_type, so existing profiles keep running.
 */
export function profileAgentEnabled(
  profile: ResearchSearchProfile,
  agentType: string,
): boolean {
  const setting = profile.agentSettings[agentType];
  return setting ? setting.enabled : true;
}

/** True when a funder name is on the profile's negative filter (case-insensitive). */
export function profileExcludesFunder(
  profile: ResearchSearchProfile,
  funderName: string | null | undefined,
): boolean {
  const name = (funderName ?? "").trim().toLowerCase();
  if (name === "") return false;
  return profile.excludedFunders.some((f) => {
    const ex = f.trim().toLowerCase();
    return ex !== "" && (name === ex || name.includes(ex) || ex.includes(name));
  });
}

/**
 * Extra search terms a profile contributes beyond its plain keywords: focus-area
 * tags (highest weight first) and population-served tags. Agents fold these into
 * their query builders so a configured profile actually steers what is searched.
 * De-duplicated against the keywords (case-insensitive) and capped.
 */
export function queryAugmentTerms(
  profile: ResearchSearchProfile,
  cap = 4,
): string[] {
  const seen = new Set(profile.keywords.map((k) => k.trim().toLowerCase()));
  const ordered = [
    ...[...profile.focusAreas]
      .sort((a, b) => b.weight - a.weight)
      .map((f) => f.label),
    ...profile.populationsServed,
  ];
  const out: string[] = [];
  for (const term of ordered) {
    const t = term.trim();
    const norm = t.toLowerCase();
    if (t === "" || seen.has(norm)) continue;
    seen.add(norm);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * The terms a profile's queries should expand: its keywords first, then its
 * weighted focus areas and population tags. This is the list every research
 * agent iterates instead of `profile.keywords` alone, so the Configuration
 * page's focus areas / populations genuinely shape the searches.
 */
export function profileQueryTerms(profile: ResearchSearchProfile): string[] {
  return [...profile.keywords, ...queryAugmentTerms(profile)];
}

/**
 * Active profiles for the organization, oldest-run first so the most overdue
 * profiles are processed earliest. Hard-capped at {@link MAX_ACTIVE_PROFILES}
 * even if the table somehow holds more (Contracts §14). Returns [] on error.
 */
export async function getActiveProfiles(
  ctx: SchedulerContext,
): Promise<ResearchSearchProfile[]> {
  try {
    const { data } = await ctx.client
      .from("search_profiles")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .eq("is_active", true)
      .order("last_run_at", { ascending: true, nullsFirst: true })
      .limit(MAX_ACTIVE_PROFILES);
    return ((data ?? []) as SearchProfileRow[]).map(mapRow);
  } catch (err) {
    console.error("[scheduler] failed to load active profiles:", err);
    return [];
  }
}

/** Load a single profile by id, org-scoped. Returns null if missing. */
export async function getProfile(
  ctx: SchedulerContext,
  profileId: string,
): Promise<ResearchSearchProfile | null> {
  try {
    const { data } = await ctx.client
      .from("search_profiles")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .eq("id", profileId)
      .maybeSingle();
    const row = data as SearchProfileRow | null;
    return row ? mapRow(row) : null;
  } catch (err) {
    console.error("[scheduler] failed to load profile:", err);
    return null;
  }
}

/**
 * True if enough time has passed since the profile's last run (or it has never
 * run). Manual triggers bypass this; it guards only scheduled re-runs.
 */
export function isProfileDue(
  profile: ResearchSearchProfile,
  minIntervalMs: number = DEFAULT_MIN_RUN_INTERVAL_MS,
): boolean {
  if (!profile.lastRunAt) return true;
  const last = Date.parse(profile.lastRunAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= minIntervalMs;
}

/**
 * Turn a profile into concrete search query strings. Each keyword becomes a
 * grant-funding query, optionally narrowed by geography; categories contribute
 * additional category-anchored queries. De-duplicated and capped.
 */
export function buildSearchQueries(profile: ResearchSearchProfile): string[] {
  const geo = profile.geographicScope?.trim() ?? "";
  const queries: string[] = [];

  // Keywords plus the profile's weighted focus areas / population tags.
  const terms = profileQueryTerms(profile);
  for (const keyword of terms) {
    const kw = keyword.trim();
    if (kw === "") continue;
    queries.push([kw, "grant funding", geo].filter(Boolean).join(" "));
  }

  const firstKeyword = terms.find((k) => k.trim() !== "")?.trim() ?? "";
  // Only the profile's effective (non-excluded) categories anchor extra queries.
  for (const category of effectiveCategories(profile)) {
    const term = humanizeEnum(category);
    queries.push([term, firstKeyword, geo].filter(Boolean).join(" "));
  }

  // De-duplicate (case-insensitive) while preserving order, then cap.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const q of queries) {
    const norm = q.trim().toLowerCase();
    if (norm === "" || seen.has(norm)) continue;
    seen.add(norm);
    unique.push(q.trim());
    if (unique.length >= MAX_QUERIES_PER_PROFILE) break;
  }
  return unique;
}

/**
 * Record a completed run: stamp last_run_at and add `resultsFound` to the
 * lifetime results_count. Best-effort - a logging failure never fails the run.
 */
export async function markProfileRun(
  ctx: SchedulerContext,
  profile: ResearchSearchProfile,
  resultsFound: number,
): Promise<void> {
  try {
    await ctx.client
      .from("search_profiles")
      .update({
        last_run_at: new Date().toISOString(),
        results_count: profile.resultsCount + Math.max(0, resultsFound),
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", ctx.organizationId)
      .eq("id", profile.id);
  } catch (err) {
    console.error("[scheduler] failed to mark profile run:", err);
  }
}
