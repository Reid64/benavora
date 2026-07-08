// GET /api/donor-discovery/requests/[id] — request detail with progress
// (status, the worker-written `counts` snapshot, and a live prospect
// pipeline_stage breakdown).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, { params }: RouteContext) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: request, error } = await supabase
    .from("donor_discovery_requests")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .single();

  if (error || !request) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  // A prospect can be linked to more than one request (donor_discovery_
  // prospects is idempotent per (organization_id, directory_id)), so the set
  // of prospects "for this request" comes from the join table, not the
  // prospect's own (creating-request-only) request_id column.
  const { data: links, error: linksError } = await supabase
    .from("dd_prospect_requests")
    .select("prospect_id")
    .eq("request_id", params.id);

  if (linksError) {
    return NextResponse.json({ error: "Failed to load request progress." }, { status: 500 });
  }

  const prospectIds = (links ?? []).map((l: { prospect_id: string }) => l.prospect_id);

  let rows: Array<{ pipeline_stage: string; score: number | null }> = [];
  if (prospectIds.length > 0) {
    const { data: prospects, error: prospectsError } = await supabase
      .from("donor_discovery_prospects")
      .select("pipeline_stage, score")
      .in("id", prospectIds)
      .eq("organization_id", organizationId);

    if (prospectsError) {
      return NextResponse.json({ error: "Failed to load request progress." }, { status: 500 });
    }
    rows = (prospects ?? []) as Array<{ pipeline_stage: string; score: number | null }>;
  }

  const stageBreakdown: Record<string, number> = {};
  let scoredCount = 0;
  let scoreSum = 0;
  for (const row of rows) {
    stageBreakdown[row.pipeline_stage] = (stageBreakdown[row.pipeline_stage] ?? 0) + 1;
    if (row.score !== null) {
      scoredCount += 1;
      scoreSum += row.score;
    }
  }

  return NextResponse.json({
    request,
    progress: {
      counts: request.counts ?? {},
      prospect_count: rows.length,
      stage_breakdown: stageBreakdown,
      scored_count: scoredCount,
      average_score: scoredCount > 0 ? Math.round(scoreSum / scoredCount) : null,
    },
  });
}
