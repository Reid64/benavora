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

import { humanizeEnum } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

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
}

export interface SchedulerContext {
  client: SupabaseClient;
  organizationId: string;
}

function mapRow(row: SearchProfileRow): ResearchSearchProfile {
  return {
    id: row.id,
    name: row.name,
    keywords: row.keywords ?? [],
    categories: row.categories ?? [],
    geographicScope: row.geographic_scope,
    minAmount: row.min_amount,
    maxAmount: row.max_amount,
    recurrencePreference: row.recurrence_preference,
    isActive: row.is_active ?? false,
    lastRunAt: row.last_run_at,
    resultsCount: row.results_count ?? 0,
  };
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

  for (const keyword of profile.keywords) {
    const kw = keyword.trim();
    if (kw === "") continue;
    queries.push([kw, "grant funding", geo].filter(Boolean).join(" "));
  }

  const firstKeyword = profile.keywords.find((k) => k.trim() !== "")?.trim() ?? "";
  for (const category of profile.categories) {
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
 * lifetime results_count. Best-effort — a logging failure never fails the run.
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
