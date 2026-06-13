// Tier enforcement (BLUEPRINT Phase 5 / Behavioral Contracts §25).
//
// SERVER-ONLY. The single gate every metered operation passes through before it
// runs. Usage limits are enforced here, server-side, so the client cannot bypass
// them (Contracts §25). Exceeding a limit yields a 429 with an upgrade prompt.
//
// Two guards:
//   - enforceLimit() - the metered daily/cumulative caps (agent_runs, api_calls,
//     email_sends, storage_bytes) from TIER_LIMITS, via the usage tracker.
//   - enforceAiRateLimit() - the per-minute burst guard on AI endpoints
//     (Contracts §16: 20 req/min/org), an in-process complement to the daily
//     api_calls cap.
//
// Callers pass their own Supabase client (session client in routes, admin client
// in agents) - the same convention as the usage tracker.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AI_RATE_LIMIT_PER_MINUTE,
  type UsageMetric,
} from "@/lib/utils/constants";
import { checkLimit, type UsageCheck } from "@/lib/billing/usage-tracker";

/** Where an over-limit response points the user to upgrade (BLUEPRINT §3.3). */
export const UPGRADE_URL = "/billing";

/** Human-readable label per metric, for the 429 message. */
const METRIC_LABEL: Record<UsageMetric, string> = {
  agent_runs: "agent runs",
  api_calls: "AI requests",
  email_sends: "email sends",
  storage_bytes: "storage",
};

/** The 429 body returned when a limit is hit (Contracts §25). */
export function usageLimitResponse(check: UsageCheck): NextResponse {
  return NextResponse.json(
    {
      error: `Usage limit exceeded for ${METRIC_LABEL[check.metric]}. Upgrade your plan to continue.`,
      code: "usage_limit_exceeded",
      metric: check.metric,
      current: check.current,
      limit: check.limit,
      upgrade_url: UPGRADE_URL,
    },
    { status: 429 },
  );
}

/**
 * Enforce a metered usage limit before an operation. Returns a ready-to-send 429
 * response when the org is at/over its tier limit, or `null` when the operation
 * may proceed. `additional` is the operation's size (e.g. incoming file bytes for
 * an upload) so the check can pre-flight whether it would push usage over.
 *
 *   const blocked = await enforceLimit(supabase, orgId, "agent_runs");
 *   if (blocked) return blocked;
 */
export async function enforceLimit(
  client: SupabaseClient,
  orgId: string,
  metric: UsageMetric,
  additional = 0,
): Promise<NextResponse | null> {
  const check = await checkLimit(client, orgId, metric, additional);
  return check.exceeded ? usageLimitResponse(check) : null;
}

// --- AI per-minute burst guard (Contracts §16) -----------------------------
//
// In-memory sliding window, per server instance. A multi-instance deployment
// needs a shared store (Supabase/Redis); this mirrors the existing per-route
// limiters it consolidates.
const RATE_WINDOW_MS = 60_000;
const aiHits = new Map<string, number[]>();

/**
 * Enforce the 20-requests-per-minute AI burst limit for an org. Returns a 429
 * response when the org is over the burst limit, or `null` to proceed. Records
 * the hit when allowed.
 */
export function enforceAiRateLimit(orgId: string): NextResponse | null {
  const now = Date.now();
  const recent = (aiHits.get(orgId) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  );
  if (recent.length >= AI_RATE_LIMIT_PER_MINUTE) {
    aiHits.set(orgId, recent);
    return NextResponse.json(
      {
        error: "Too many AI requests. Please wait a moment and try again.",
        code: "rate_limited",
        upgrade_url: UPGRADE_URL,
      },
      { status: 429 },
    );
  }
  recent.push(now);
  aiHits.set(orgId, recent);
  return null;
}
