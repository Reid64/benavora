import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET /api/intelligence/learning-network — Platform Learning Network
// (AUTONOMOUS_PLATFORM_VISION.md Phase 4 "Global Learning Network",
// AGENTS_v2.md AG-36). Surfaces platform_learning_patterns (migration 083)
// and this org's usage of/contribution to it.
//
// platform_learning_patterns and org_learning_contributions both carry no
// RLS policy (migration 083's own table comments say so explicitly — "RLS
// disabled intentionally" / shared across all tenants). That means a direct
// client-side `supabase.from("platform_learning_patterns")` call would be
// wide open to any authenticated user of any org. This route is the guarded
// path: requireRole() resolves organizationId server-side from the session
// (never a client-supplied value — Behavioral Contracts §2) before touching
// either table, mirroring /api/intelligence/reputation's GET handler.

export const runtime = "nodejs";
export const maxDuration = 300;

const PATTERN_LIST_LIMIT = 50;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * Composite 0-100 heuristic, not a measured metric: how much this org
 * benefits from (and feeds into) the cross-org pattern pool. Three equally
 * weighted, independently capped components so no single factor can push
 * the score past its own share of 100:
 *   - density   (platform-wide pattern count, caps at 40 once >=20 patterns exist)
 *   - your use  (patterns applied to this org's autonomous drafts, caps at 30 once >=10)
 *   - your give (this org's own contributions back to the pool, caps at 30 once >=10)
 */
function computeNetworkEffectScore(
  totalPatterns: number,
  patternsAppliedToYourDrafts: number,
  yourContributions: number,
): number {
  const density = Math.min(40, totalPatterns * 2);
  const usage = Math.min(30, patternsAppliedToYourDrafts * 3);
  const contribution = Math.min(30, yourContributions * 3);
  return Math.round(density + usage + contribution);
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const [
    { count: totalPatterns, error: totalError },
    { data: appliedRows, error: appliedError },
    { count: yourContributions, error: contribError },
    { data: patternRows, error: patternsError },
  ] = await Promise.all([
    supabase
      .from("platform_learning_patterns")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("applications")
      .select("platform_patterns_applied")
      .eq("organization_id", organizationId)
      .eq("auto_generated", true),
    supabase
      .from("org_learning_contributions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", organizationId),
    supabase
      .from("platform_learning_patterns")
      .select(
        "id, pattern_type, funder_category, ntee_code, success_rate, sample_count, last_updated",
      )
      .order("last_updated", { ascending: false })
      .limit(PATTERN_LIST_LIMIT),
  ]);

  if (totalError || appliedError || contribError || patternsError) {
    return jsonError(
      "Failed to load the learning network.",
      "db_error",
      500,
    );
  }

  const patternsAppliedToYourDrafts = (appliedRows ?? []).reduce(
    (sum: number, row: { platform_patterns_applied: number | null }) =>
      sum + (row.platform_patterns_applied ?? 0),
    0,
  );

  const stats = {
    totalPatterns: totalPatterns ?? 0,
    patternsAppliedToYourDrafts,
    yourContributions: yourContributions ?? 0,
    networkEffectScore: computeNetworkEffectScore(
      totalPatterns ?? 0,
      patternsAppliedToYourDrafts,
      yourContributions ?? 0,
    ),
  };

  return NextResponse.json({
    stats,
    patterns: patternRows ?? [],
  });
}
