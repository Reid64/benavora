// Tier 6 agent scheduler (AGENTS.md Agents 15-20, BEHAVIORAL_CONTRACTS §17-21,
// §33 Continuous Operation Contracts).
//
// Defines cadences and helpers for the Tier 6 research agents. These operate
// alongside the base research families (corporate, foundation, government, local)
// which live in src/lib/agents/research/scheduler.ts.
//
// Agent type mapping — all values must exist in the AgentType union
// (src/types/agents.ts). Custom scraping uses 'custom_api_research' (not
// 'custom_scrape_research', which is absent from the AgentType union).
//
//   Grants.gov search       -> 'grants_gov_research'   (BEHAVIORAL_CONTRACTS §17)
//   SAM.gov search          -> 'sam_gov_research'       (BEHAVIORAL_CONTRACTS §18)
//   ProPublica 990 mining   -> 'propublica_mining'      (BEHAVIORAL_CONTRACTS §19)
//   State portal scraping   -> 'state_portal'           (BEHAVIORAL_CONTRACTS §21)
//   Custom API / scraping   -> 'custom_api_research'    (BEHAVIORAL_CONTRACTS §20)

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AgentType } from "@/types/agents";
import type { Json } from "@/types/database";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Max active profiles the scheduler considers in one sweep (mirrors §14). */
export const MAX_ACTIVE_PROFILES = 10;

/** Cadence and metadata for each schedulable Tier 6 agent. */
export interface Tier6AgentDef {
  /** Must be a value from the AgentType union (src/types/agents.ts). */
  agentType: AgentType;
  label: string;
  cadence: string;
  /** Minimum gap between automated sweeps for this agent. */
  intervalMs: number;
}

/**
 * Tier 6 agent schedule definitions. Every agentType must exist in the AgentType
 * union — the types are checked at compile time against src/types/agents.ts.
 *
 * Cadences per BEHAVIORAL_CONTRACTS §33:
 *   Grants.gov = daily | SAM.gov, ProPublica, State portals = weekly
 *   Custom API/scraping = daily default (overridden per-connection by poll_schedule)
 */
export const TIER6_AGENT_DEFS: readonly Tier6AgentDef[] = [
  {
    agentType: "grants_gov_research",
    label: "Grants.gov",
    cadence: "Daily",
    intervalMs: DAY_MS,
  },
  {
    agentType: "sam_gov_research",
    label: "SAM.gov",
    cadence: "Weekly",
    intervalMs: WEEK_MS,
  },
  {
    agentType: "propublica_mining",
    label: "ProPublica 990 Mining",
    cadence: "Weekly",
    intervalMs: WEEK_MS,
  },
  {
    agentType: "state_portal",
    label: "State Portals",
    cadence: "Weekly",
    intervalMs: WEEK_MS,
  },
  {
    agentType: "custom_api_research",
    label: "Custom Sources",
    cadence: "Daily",
    intervalMs: DAY_MS,
  },
] as const;

/** Context required for all scheduler operations. */
export interface SchedulerContext {
  client: SupabaseClient;
  organizationId: string;
}

/** Search profile row subset needed for schedule decisions. */
export interface SchedulableProfile {
  id: string;
  name: string;
  last_run_at: string | null;
  results_count: number | null;
  is_active: boolean | null;
}

/**
 * True when a run is past due based on last_run_at and the configured interval.
 * A null or unparseable last_run_at is treated as "never run" and is always due.
 */
export function isDue(lastRunAt: string | null, intervalMs: number): boolean {
  if (!lastRunAt) return true;
  const last = Date.parse(lastRunAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= intervalMs;
}

/**
 * Load active search profiles ordered oldest-run-first so the most overdue
 * profiles are processed first in any sweep. Capped at MAX_ACTIVE_PROFILES.
 * Returns [] on error.
 */
export async function getActiveProfiles(
  ctx: SchedulerContext,
): Promise<SchedulableProfile[]> {
  const { data } = await ctx.client
    .from("search_profiles")
    .select("id, name, last_run_at, results_count, is_active")
    .eq("organization_id", ctx.organizationId)
    .eq("is_active", true)
    .order("last_run_at", { ascending: true, nullsFirst: true })
    .limit(MAX_ACTIVE_PROFILES);
  return (data ?? []) as SchedulableProfile[];
}

/**
 * Filter profiles to those due for a given agent family's interval.
 */
export function dueProfiles(
  profiles: SchedulableProfile[],
  intervalMs: number,
): SchedulableProfile[] {
  return profiles.filter((p) => isDue(p.last_run_at, intervalMs));
}

/**
 * Stamp a profile after a completed run: update last_run_at and accumulate
 * results_count. Best-effort — a failure here never fails the run itself.
 */
export async function markProfileRun(
  ctx: SchedulerContext,
  profile: SchedulableProfile,
  resultsFound: number,
): Promise<void> {
  try {
    await ctx.client
      .from("search_profiles")
      .update({
        last_run_at: new Date().toISOString(),
        results_count: (profile.results_count ?? 0) + Math.max(0, resultsFound),
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", ctx.organizationId)
      .eq("id", profile.id);
  } catch {
    // best-effort
  }
}

/**
 * Insert a running agent_runs row at the start of a scheduled sweep.
 * Returns the new row id, or null if the insert fails.
 */
export async function logRunStart(
  ctx: SchedulerContext,
  agentType: AgentType,
  inputParams?: Json,
): Promise<string | null> {
  const { data } = await ctx.client
    .from("agent_runs")
    .insert({
      organization_id: ctx.organizationId,
      agent_type: agentType,
      status: "running",
      triggered_by: null,
      input_params: inputParams ?? null,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Close a previously opened agent_runs row. No-op when runId is null
 * (logRunStart failed). Updates status, summary, counts, and duration.
 */
export async function logRunEnd(
  ctx: SchedulerContext,
  runId: string | null,
  outcome: {
    status: "completed" | "failed";
    outputSummary?: string;
    itemsFound?: number;
    itemsProcessed?: number;
    tokensUsed?: number;
    errorMessage?: string;
    durationMs?: number;
  },
): Promise<void> {
  if (!runId) return;
  await ctx.client
    .from("agent_runs")
    .update({
      status: outcome.status,
      output_summary: outcome.outputSummary ?? null,
      items_found: outcome.itemsFound ?? null,
      items_processed: outcome.itemsProcessed ?? null,
      tokens_used: outcome.tokensUsed ?? null,
      error_message: outcome.errorMessage ?? null,
      duration_ms: outcome.durationMs ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
}
