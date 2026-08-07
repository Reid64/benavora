// GET /api/opportunities/[id]/narrative-gap-analysis
//
// Row #144 (FEATURE_REGISTRY_v2.md), "Narrative Gap Analysis - KB
// completeness scoring vs funder requirements." See
// src/lib/intelligence/narrative-gap-analysis.ts for the full computation
// and its relationship to AG-11 (Knowledge Gap Agent). Derives
// organization_id from the authenticated session (never from the request),
// same pattern as every other opportunity/application-scoped route.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { computeNarrativeGapAnalysis } from "@/lib/intelligence/narrative-gap-analysis";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  try {
    const result = await computeNarrativeGapAnalysis(
      supabase,
      organizationId,
      params.id,
    );
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to compute narrative gap analysis.";
    const notFound = message === "Opportunity not found.";
    return jsonError(
      message,
      notFound ? "not_found" : "db_error",
      notFound ? 404 : 500,
    );
  }
}
