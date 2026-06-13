// Usage limit middleware for API routes (Behavioral Contracts §25).
//
// SERVER-ONLY. Wraps a resource-limit check into the same 429-with-upgrade-prompt
// pattern used by enforceLimit() in tier-enforcer.ts, but for the broader set of
// resource types tracked by usage-limiter.ts.
//
// Usage:
//   const blocked = await withUsageCheck(supabase, orgId, "ai_drafts");
//   if (blocked) return blocked;

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { checkLimit, type UsageResourceType } from "@/lib/billing/usage-limiter";
import { UPGRADE_URL } from "@/lib/billing/tier-enforcer";

const RESOURCE_LABEL: Record<UsageResourceType, string> = {
  opportunities: "opportunities",
  applications:  "applications",
  ai_drafts:     "AI drafts",
  agent_runs:    "agent runs",
  storage_mb:    "storage",
  users:         "team members",
};

/**
 * Enforce a resource limit before processing a request. Returns a 429 response
 * with an upgrade prompt when the org is at/over its tier limit, or null to allow
 * the request to proceed.
 */
export async function withUsageCheck(
  client: SupabaseClient,
  orgId: string,
  resource: UsageResourceType,
): Promise<NextResponse | null> {
  const check = await checkLimit(client, orgId, resource);
  if (check.allowed) return null;

  const limitDisplay = check.limit === -1 ? "unlimited" : String(check.limit);
  return NextResponse.json(
    {
      error: `You've reached your ${RESOURCE_LABEL[resource]} limit (${check.current}/${limitDisplay}). Upgrade your plan to continue.`,
      code: "usage_limit_exceeded",
      resource,
      current: check.current,
      limit: check.limit,
      tier: check.tier,
      upgrade_url: UPGRADE_URL,
    },
    { status: 429 },
  );
}
