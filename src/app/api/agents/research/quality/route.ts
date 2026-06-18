// POST /api/agents/research/quality — overnight-006
//
// Scores the data quality of discovered opportunities and returns a report.
// Accepts an optional list of opportunity_ids to scope the check; otherwise
// scores all open opportunities for the organization (up to the limit).
//
// This is a read-heavy analysis route — it does not modify any records.
// The caller (research dashboard) uses the scores to surface the "Needs
// Review" queue.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { checkDataQuality } from "@/lib/research/data-quality";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Body is optional — default to checking all open opps.
    body = {};
  }

  const parsed = (body ?? {}) as {
    opportunity_ids?: unknown;
    limit?: unknown;
  };

  const opportunityIds =
    Array.isArray(parsed.opportunity_ids)
      ? parsed.opportunity_ids.filter(
          (id): id is string => typeof id === "string",
        )
      : undefined;

  const limit =
    typeof parsed.limit === "number" && parsed.limit > 0
      ? Math.min(parsed.limit, 200)
      : 50;

  try {
    const result = await checkDataQuality({
      client: supabase,
      organizationId,
      opportunityIds,
      limit,
    });

    return NextResponse.json({
      total: result.scored.length,
      goodCount: result.goodCount,
      fairCount: result.fairCount,
      poorCount: result.poorCount,
      scores: result.scored,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Data quality check failed.";
    return jsonError(message, "check_failed", 500);
  }
}
