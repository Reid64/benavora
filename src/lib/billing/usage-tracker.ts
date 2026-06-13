// Usage tracking (BLUEPRINT Phase 5 / Behavioral Contracts §25).
//
// SERVER-ONLY. Records and reads the metered usage that backs tier enforcement
// (src/lib/billing/tier-enforcer.ts) and the billing/admin usage dashboards.
//
// Callers pass their own Supabase client so this works in both contexts:
//   - Route handlers pass the session client (RLS scopes writes to the org).
//   - Agents/schedules pass the service-role client (admin.ts), which bypasses
//     RLS, so every query here is ALSO scoped explicitly by organization_id.
//
// Counter model (Contracts §25):
//   - agent_runs / api_calls / email_sends - daily counters, reset at midnight
//     UTC, stored as one usage_metrics row per (org, metric_date, metric_name).
//   - storage_bytes - CUMULATIVE, not a daily reset. It's computed live from the
//     real documents.file_size sum (the authoritative source, matching the
//     billing route) rather than a stored counter, so it never drifts.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  TIER_LIMITS,
  type SubscriptionTier,
  type UsageMetric,
} from "@/lib/utils/constants";

/** The result of a limit check for one metric. */
export interface UsageCheck {
  metric: UsageMetric;
  /** Usage so far in the current window (today, or cumulative for storage). */
  current: number;
  /** Hard ceiling for the org's tier. */
  limit: number;
  /** limit − current, floored at 0. */
  remaining: number;
  /** True once current >= limit (further use must be blocked - Contracts §25). */
  exceeded: boolean;
}

/** Today's date as an UTC `YYYY-MM-DD` string (the usage_metrics.metric_date key). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Start of today (UTC) as ISO - for "since midnight" live counts. */
function startOfTodayIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

/**
 * Resolve an org's subscription tier from the denormalized
 * organizations.subscription_tier column (kept in sync by the Stripe webhook).
 * Defaults to 'free' when unset or unreadable - every org is at least free
 * (Contracts §22).
 */
export async function resolveTier(
  client: SupabaseClient,
  orgId: string,
): Promise<SubscriptionTier> {
  const { data } = await client
    .from("organizations")
    .select("subscription_tier")
    .eq("id", orgId)
    .maybeSingle();
  const tier = (data as { subscription_tier: string | null } | null)
    ?.subscription_tier;
  if (tier && tier in TIER_LIMITS) return tier as SubscriptionTier;
  return "free";
}

/** The per-day limit for a metric at a given tier (bytes for storage). */
export function limitForMetric(
  tier: SubscriptionTier,
  metric: UsageMetric,
): number {
  const limits = TIER_LIMITS[tier];
  switch (metric) {
    case "agent_runs":
      return limits.agent_runs_per_day;
    case "api_calls":
      return limits.api_calls_per_day;
    case "email_sends":
      return limits.email_sends_per_day;
    case "storage_bytes":
      return limits.storage_mb * 1024 * 1024;
  }
}

/**
 * Increment today's usage counter for a metric (Contracts §25). Best-effort and
 * non-atomic (read-then-upsert): adequate for this app's single-operator scale.
 * `count` may be negative (e.g. a document delete crediting storage back).
 *
 * storage_bytes is computed live elsewhere, so tracking it here is optional and
 * only feeds the historical trend view - never the limit check.
 */
export async function trackUsage(
  client: SupabaseClient,
  orgId: string,
  metric: UsageMetric,
  count = 1,
): Promise<void> {
  if (count === 0) return;
  const metricDate = todayUtc();

  const { data: existing } = await client
    .from("usage_metrics")
    .select("id, metric_value")
    .eq("organization_id", orgId)
    .eq("metric_date", metricDate)
    .eq("metric_name", metric)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const current = (existing as { metric_value: number | null } | null)
    ?.metric_value;
  const nextValue = Math.max(0, (current ?? 0) + count);

  if (existing) {
    await client
      .from("usage_metrics")
      .update({ metric_value: nextValue, updated_at: nowIso })
      .eq("id", (existing as { id: string }).id);
    return;
  }

  await client.from("usage_metrics").insert({
    organization_id: orgId,
    metric_date: metricDate,
    metric_name: metric,
    metric_value: nextValue,
  });
}

/** Live cumulative storage in bytes (sum of documents.file_size for the org). */
export async function getStorageBytes(
  client: SupabaseClient,
  orgId: string,
): Promise<number> {
  const { data } = await client
    .from("documents")
    .select("file_size")
    .eq("organization_id", orgId);
  return ((data as { file_size: number | null }[] | null) ?? []).reduce(
    (sum, d) => sum + (d.file_size ?? 0),
    0,
  );
}

/** Today's value for a daily counter metric, from usage_metrics. */
export async function getDailyUsage(
  client: SupabaseClient,
  orgId: string,
  metric: UsageMetric,
): Promise<number> {
  const { data } = await client
    .from("usage_metrics")
    .select("metric_value")
    .eq("organization_id", orgId)
    .eq("metric_date", todayUtc())
    .eq("metric_name", metric)
    .maybeSingle();
  return (
    (data as { metric_value: number | null } | null)?.metric_value ?? 0
  );
}

/** Live count of agent_runs created since midnight UTC (authoritative source). */
async function getAgentRunsToday(
  client: SupabaseClient,
  orgId: string,
): Promise<number> {
  const { count } = await client
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("created_at", startOfTodayIso());
  return count ?? 0;
}

/**
 * Current usage for a metric, choosing the most authoritative source:
 *   - storage_bytes → live documents.file_size sum (cumulative)
 *   - agent_runs    → live agent_runs rows since midnight (matches billing route)
 *   - api_calls / email_sends → today's tracked usage_metrics counter
 */
export async function getCurrentUsage(
  client: SupabaseClient,
  orgId: string,
  metric: UsageMetric,
): Promise<number> {
  if (metric === "storage_bytes") return getStorageBytes(client, orgId);
  if (metric === "agent_runs") return getAgentRunsToday(client, orgId);
  return getDailyUsage(client, orgId, metric);
}

/**
 * Check a metric against the org's tier limit (Contracts §25). `additional` is
 * the size of the operation about to happen - e.g. the incoming file's bytes for
 * an upload - so the caller can pre-flight whether it would push usage over.
 * `exceeded` is true when current + additional would meet or exceed the limit.
 */
export async function checkLimit(
  client: SupabaseClient,
  orgId: string,
  metric: UsageMetric,
  additional = 0,
): Promise<UsageCheck> {
  const tier = await resolveTier(client, orgId);
  const limit = limitForMetric(tier, metric);
  const current = await getCurrentUsage(client, orgId, metric);
  const projected = current + additional;
  const remaining = Math.max(0, limit - current);
  return {
    metric,
    current,
    limit,
    remaining,
    exceeded: projected >= limit && projected > 0,
  };
}

/** One metric's usage rolled up across a date window, for the dashboards. */
export interface UsageSummaryEntry {
  metric: UsageMetric;
  limit: number;
  /** Usage in the current daily window (or cumulative bytes for storage). */
  today: number;
  /** Sum over the trailing 7 days (storage reports its live cumulative value). */
  last7Days: number;
  /** Sum over the trailing 30 days (storage reports its live cumulative value). */
  last30Days: number;
  remaining: number;
  exceeded: boolean;
}

export interface UsageSummary {
  tier: SubscriptionTier;
  metrics: UsageSummaryEntry[];
}

/** UTC `YYYY-MM-DD` for `daysAgo` days before today. */
function dateDaysAgoUtc(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregate usage across all metrics for the org, with daily/7-day/30-day rollups
 * and tier limits for context (powers GET /api/admin/usage and the billing page).
 */
export async function getUsageSummary(
  client: SupabaseClient,
  orgId: string,
): Promise<UsageSummary> {
  const tier = await resolveTier(client, orgId);
  const since30 = dateDaysAgoUtc(30);
  const since7 = dateDaysAgoUtc(7);
  const today = todayUtc();

  // One read covers the trailing 30 days of daily counters.
  const { data: rows } = await client
    .from("usage_metrics")
    .select("metric_name, metric_date, metric_value")
    .eq("organization_id", orgId)
    .gte("metric_date", since30);

  const counterRows =
    (rows as
      | { metric_name: string; metric_date: string; metric_value: number | null }[]
      | null) ?? [];

  const sum = (metric: UsageMetric, from: string, to?: string) =>
    counterRows
      .filter(
        (r) =>
          r.metric_name === metric &&
          r.metric_date >= from &&
          (to ? r.metric_date <= to : true),
      )
      .reduce((acc, r) => acc + (r.metric_value ?? 0), 0);

  const storageBytes = await getStorageBytes(client, orgId);
  const agentRunsToday = await getAgentRunsToday(client, orgId);

  const metrics: UsageSummaryEntry[] = USAGE_METRICS_ORDER.map((metric) => {
    const limit = limitForMetric(tier, metric);

    if (metric === "storage_bytes") {
      // Cumulative - the same live value across every window.
      return {
        metric,
        limit,
        today: storageBytes,
        last7Days: storageBytes,
        last30Days: storageBytes,
        remaining: Math.max(0, limit - storageBytes),
        exceeded: storageBytes >= limit && storageBytes > 0,
      };
    }

    // agent_runs prefers the live table count for "today" to match the billing
    // route; older days come from the tracked counters.
    const todayValue =
      metric === "agent_runs"
        ? agentRunsToday
        : sum(metric, today, today);
    const last7 =
      metric === "agent_runs"
        ? sum(metric, since7, dateDaysAgoUtc(1)) + agentRunsToday
        : sum(metric, since7);
    const last30 =
      metric === "agent_runs"
        ? sum(metric, since30, dateDaysAgoUtc(1)) + agentRunsToday
        : sum(metric, since30);

    return {
      metric,
      limit,
      today: todayValue,
      last7Days: last7,
      last30Days: last30,
      remaining: Math.max(0, limit - todayValue),
      exceeded: todayValue >= limit && todayValue > 0,
    };
  });

  return { tier, metrics };
}

// Stable display order for summaries.
const USAGE_METRICS_ORDER: UsageMetric[] = [
  "agent_runs",
  "api_calls",
  "email_sends",
  "storage_bytes",
];
