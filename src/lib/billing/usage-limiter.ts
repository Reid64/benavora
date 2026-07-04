// Per-resource usage limiter (Behavioral Contracts §25 / BLUEPRINT Phase 5).
//
// SERVER-ONLY. Enforces per-tier limits for a broader set of resource types than
// the daily counters in usage-tracker.ts: opportunities, applications, and ai_drafts
// are tracked monthly via the usage_tracking table; agent_runs uses the live
// agent_runs table count (consistent with the existing system); storage_mb and
// users are computed live from documents/profiles respectively.
//
// Limits table mirrors the BLUEPRINT "Tier Limits" specification. -1 = unlimited.

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveTier } from "@/lib/billing/usage-tracker";
import { SUBSCRIPTION_TIERS, TIER_LIMITS, type SubscriptionTier } from "@/lib/utils/constants";

export type UsageResourceType =
  | "opportunities"
  | "applications"
  | "ai_drafts"
  | "agent_runs"
  | "storage_mb"
  | "users";

// opportunities/applications/ai_drafts have no equivalent in TIER_LIMITS
// (constants.ts) — they're tracked only here. agent_runs/storage_mb/users DO
// overlap with TIER_LIMITS, and used to be hand-duplicated with numbers that
// had drifted out of sync (e.g. starter.agent_runs was 5 here vs free tier's
// own 10, and starter.users was 1 here vs free's 2 — paying customers had a
// *worse* limit than the free tier). Those three now derive directly from
// TIER_LIMITS so there's a single source of truth and this can't drift again.
// -1 = unlimited.
const MONTHLY_ONLY_LIMITS: Record<
  SubscriptionTier,
  Record<"opportunities" | "applications" | "ai_drafts", number>
> = {
  free:         { opportunities: 10,  applications: 5,   ai_drafts: 3   },
  starter:      { opportunities: 50,  applications: 20,  ai_drafts: 10  },
  professional: { opportunities: 200, applications: 100, ai_drafts: 50  },
  enterprise:   { opportunities: -1,  applications: -1,  ai_drafts: 200 },
  consultant:   { opportunities: -1,  applications: -1,  ai_drafts: -1  },
};

export const RESOURCE_LIMITS: Record<
  SubscriptionTier,
  Record<UsageResourceType, number>
> = Object.fromEntries(
  SUBSCRIPTION_TIERS.map((tier) => [
    tier,
    {
      ...MONTHLY_ONLY_LIMITS[tier],
      agent_runs: TIER_LIMITS[tier].agent_runs_per_day,
      storage_mb: TIER_LIMITS[tier].storage_mb,
      users: TIER_LIMITS[tier].users,
    },
  ]),
) as Record<SubscriptionTier, Record<UsageResourceType, number>>;

// Monthly resources reset on the 1st of each month (UTC).
const MONTHLY_RESOURCES: UsageResourceType[] = [
  "opportunities",
  "applications",
  "ai_drafts",
];

export interface LimitCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  tier: string;
}

// --- Period helpers -----------------------------------------------------------

function monthPeriod(): { start: string; end: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end   = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function todayPeriod(): { start: string; end: string } {
  const d = new Date().toISOString().slice(0, 10);
  return { start: d, end: d };
}

function startOfTodayIso(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString();
}

// --- Live counts (authoritative sources) -------------------------------------

async function getLiveAgentRunsToday(
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

async function getLiveStorageMb(
  client: SupabaseClient,
  orgId: string,
): Promise<number> {
  const { data } = await client
    .from("documents")
    .select("file_size")
    .eq("organization_id", orgId);
  const bytes = ((data as { file_size: number | null }[] | null) ?? []).reduce(
    (sum, d) => sum + (d.file_size ?? 0),
    0,
  );
  return bytes / (1024 * 1024);
}

async function getLiveUserCount(
  client: SupabaseClient,
  orgId: string,
): Promise<number> {
  const { count } = await client
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  return count ?? 0;
}

async function getTrackedCount(
  client: SupabaseClient,
  orgId: string,
  resource: UsageResourceType,
): Promise<number> {
  const period = MONTHLY_RESOURCES.includes(resource) ? monthPeriod() : todayPeriod();
  const { data } = await client
    .from("usage_tracking")
    .select("count")
    .eq("organization_id", orgId)
    .eq("resource_type", resource)
    .eq("period_start", period.start)
    .maybeSingle();
  return (data as { count: number } | null)?.count ?? 0;
}

async function getCurrentCount(
  client: SupabaseClient,
  orgId: string,
  resource: UsageResourceType,
): Promise<number> {
  switch (resource) {
    case "agent_runs":  return getLiveAgentRunsToday(client, orgId);
    case "storage_mb":  return getLiveStorageMb(client, orgId);
    case "users":       return getLiveUserCount(client, orgId);
    default:            return getTrackedCount(client, orgId, resource);
  }
}

// --- Public API --------------------------------------------------------------

/**
 * Check whether an org is within its tier limit for a resource.
 * Returns { allowed, current, limit, tier }. limit = -1 means unlimited.
 */
export async function checkLimit(
  client: SupabaseClient,
  orgId: string,
  resource: UsageResourceType,
): Promise<LimitCheckResult> {
  const tier  = await resolveTier(client, orgId);
  const limit = RESOURCE_LIMITS[tier][resource];
  const current = await getCurrentCount(client, orgId, resource);
  return { allowed: limit === -1 || current < limit, current, limit, tier };
}

/**
 * Increment usage by 1 for a tracked (non-live) resource type. No-op for
 * agent_runs (live agent_runs table), storage_mb, and users (live counts).
 * Uses the increment_usage_tracking DB function for atomic upsert.
 */
export async function incrementUsage(
  client: SupabaseClient,
  orgId: string,
  resource: UsageResourceType,
): Promise<void> {
  if (!MONTHLY_RESOURCES.includes(resource)) return;
  const period = monthPeriod();
  await client.rpc("increment_usage_tracking", {
    p_org_id: orgId,
    p_resource_type: resource,
    p_period_start: period.start,
    p_period_end: period.end,
    p_amount: 1,
  });
}

export interface UsageResourceSummary {
  resource: UsageResourceType;
  current: number;
  limit: number;
  allowed: boolean;
  period: string;
}

export interface UsageSummaryResult {
  tier: string;
  resources: Record<UsageResourceType, UsageResourceSummary>;
}

/**
 * Aggregate usage across all resource types for the org (powers the usage
 * dashboard in Settings and GET /api/billing/usage).
 */
export async function getUsageSummary(
  client: SupabaseClient,
  orgId: string,
): Promise<UsageSummaryResult> {
  const tier   = await resolveTier(client, orgId);
  const limits = RESOURCE_LIMITS[tier];
  const today  = new Date().toISOString().slice(0, 10);
  const mp     = monthPeriod();
  const monthLabel = today.slice(0, 7);

  // One query covers all tracked resources.
  const { data: rows } = await client
    .from("usage_tracking")
    .select("resource_type, count")
    .eq("organization_id", orgId)
    .in("resource_type", ["opportunities", "applications", "ai_drafts"])
    .eq("period_start", mp.start);

  const tracked = new Map<string, number>(
    ((rows as { resource_type: string; count: number }[] | null) ?? []).map(
      (r) => [r.resource_type, r.count],
    ),
  );

  const [storageMb, userCount, agentRunsToday] = await Promise.all([
    getLiveStorageMb(client, orgId),
    getLiveUserCount(client, orgId),
    getLiveAgentRunsToday(client, orgId),
  ]);

  const resources = {} as Record<UsageResourceType, UsageResourceSummary>;

  const all: [UsageResourceType, number, string][] = [
    ["opportunities", tracked.get("opportunities") ?? 0, `monthly (${monthLabel})`],
    ["applications",  tracked.get("applications")  ?? 0, `monthly (${monthLabel})`],
    ["ai_drafts",     tracked.get("ai_drafts")     ?? 0, `monthly (${monthLabel})`],
    ["agent_runs",    agentRunsToday,                     `daily (${today})`],
    ["storage_mb",    storageMb,                          "current"],
    ["users",         userCount,                          "current"],
  ];

  for (const [resource, current, period] of all) {
    const limit = limits[resource];
    resources[resource] = {
      resource,
      current,
      limit,
      allowed: limit === -1 || current < limit,
      period,
    };
  }

  return { tier, resources };
}
