// Feature-level tier gate (Behavioral Contracts §25 / BLUEPRINT Phase 5).
//
// Maps product features to subscription tier limits and checks current usage.
// Returns a normalised TierCheckResult safe for client consumption.
//
// Use checkTierGate() for feature preflight checks (server routes, check-gate
// endpoint). For route-level blocking pair the result with a 429 NextResponse.
// Low-level daily metric caps are still enforced by src/lib/billing/tier-enforcer.ts.

import { createAdminClient } from "@/lib/supabase/admin";
import { checkLimit as checkResourceUsage } from "@/lib/billing/usage-limiter";

export type TierFeature = "agent_run" | "draft_generation";

export interface TierCheckResult {
  allowed: boolean;
  remaining: number;
  limit: number | null;
}

// Per-feature, per-tier caps. null = unlimited. Keyed by string to allow safe
// indexing with an unknown tier value (FORGE TypeScript rule: Record<string, ...>
// so index access may return undefined, checked before use).
const FEATURE_CAPS: Record<TierFeature, Record<string, { limit: number | null }>> = {
  agent_run: {
    free:         { limit: 5    },
    starter:      { limit: 50   },
    professional: { limit: null },
    enterprise:   { limit: null },
    consultant:   { limit: null },
  },
  draft_generation: {
    free:         { limit: 10   },
    starter:      { limit: 100  },
    professional: { limit: null },
    enterprise:   { limit: null },
    consultant:   { limit: null },
  },
};

// Maps each product feature to the usage-limiter resource that tracks its usage.
const FEATURE_RESOURCE: Record<TierFeature, "agent_runs" | "ai_drafts"> = {
  agent_run:        "agent_runs",
  draft_generation: "ai_drafts",
};

/**
 * Check whether an org is within its feature-level tier cap.
 * Derives tier and current usage internally via the admin client.
 *
 * Returns { allowed, remaining, limit } where limit: null means unlimited.
 * When limit is null, remaining is Number.MAX_SAFE_INTEGER.
 */
export async function checkTierGate(
  orgId: string,
  feature: TierFeature,
): Promise<TierCheckResult> {
  const admin = createAdminClient();
  const resource = FEATURE_RESOURCE[feature];

  // checkResourceUsage resolves the tier internally — one DB round-trip covers both.
  const usage = await checkResourceUsage(admin, orgId, resource);
  const current = usage.current;

  const tierCaps = FEATURE_CAPS[feature];
  const cap = tierCaps[usage.tier];
  if (!cap) {
    // Unrecognised tier: fall back to free-tier limits.
    const freeCap = tierCaps["free"];
    const freeLimit = freeCap?.limit ?? 0;
    return { allowed: false, remaining: 0, limit: freeLimit };
  }

  const { limit } = cap;

  if (limit === null) {
    return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, limit: null };
  }

  const remaining = Math.max(0, limit - current);
  return { allowed: current < limit, remaining, limit };
}
