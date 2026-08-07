// GET /api/intelligence/gap-analysis
//
// Rows #145/#146 (FEATURE_REGISTRY_v2.md): "Geographic Gap Detection" +
// "Gap Recommendations." Synthesis/display layer over the already-built
// per-opportunity Narrative Gap Analysis (row #144) and a new portfolio-wide
// Geographic Gap Detection - see src/lib/intelligence/gap-recommendations.ts
// for the full computation. Derives organization_id from the authenticated
// session (never from the request), same pattern as every other
// org-scoped intelligence route.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { computePortfolioGapAnalysis } from "@/lib/intelligence/gap-recommendations";

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  try {
    const result = await computePortfolioGapAnalysis(supabase, organizationId);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to compute gap analysis.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
