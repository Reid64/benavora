import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { computeMatchFeed } from "@/lib/intelligence/match-feed";

// GET /api/intelligence/match-feed
//
// Returns the caller's org's Personalized Match Feed (FEATURE_REGISTRY_v2.md
// #85) — open opportunities ranked by affinity to the org's Organizational
// Digital Twin, blended with AG-15's probability score where one exists.
// organization_id is always derived server-side via requireRole(), never
// from the request (Behavioral Contracts §2). Deterministic computation —
// no Claude call — so no extended maxDuration is needed.

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(100, parseInt(limitParam, 10) || 25)) : 25;

  let result;
  try {
    result = await computeMatchFeed(organizationId, supabase, limit);
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Failed to compute the match feed.",
      "match_feed_failed",
      500,
    );
  }

  return NextResponse.json(result);
}
