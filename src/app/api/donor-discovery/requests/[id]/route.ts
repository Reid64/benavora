// GET /api/donor-discovery/requests/[id] — request detail with progress
// (status, the worker-written `counts` snapshot, and a live prospect
// pipeline_stage breakdown).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { selectAllPages } from "@/lib/supabase/select-all-pages";

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
  // prospect's own (creating-request-only) request_id column. Embedding the
  // joined columns in the same query (rather than a separate .in(prospectIds)
  // select) avoids ever building an id list that could itself run into
  // PostgREST/URL-length limits at 100K+ entries.
  type LinkRow = {
    donor_discovery_prospects: { pipeline_stage: string; score: number | null; organization_id: string } | null;
  };
  let links: LinkRow[];
  try {
    links = await selectAllPages<LinkRow>((from, to) =>
      supabase
        .from("dd_prospect_requests")
        .select("donor_discovery_prospects(pipeline_stage, score, organization_id)")
        .eq("request_id", params.id)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: LinkRow[] | null; error: unknown }>,
    );
  } catch {
    return NextResponse.json({ error: "Failed to load request progress." }, { status: 500 });
  }

  const rows: Array<{ pipeline_stage: string; score: number | null }> = links
    .map((l) => l.donor_discovery_prospects)
    .filter((p): p is { pipeline_stage: string; score: number | null; organization_id: string } => p !== null)
    .filter((p) => p.organization_id === organizationId);

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
