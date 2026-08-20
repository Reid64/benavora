// GET /api/donor-discovery/pipeline — server-side aggregation of the caller's
// org donor_discovery_prospects, grouped by pipeline_stage, for the Overview
// page's "Pipeline Funnel" and "Top Prospects" cards
// (src/app/(dashboard)/donor-discovery/page.tsx).
//
// Consolidates what the Overview page previously did as 6 parallel
// stage-count queries + a separate top-prospects fetch + an all-scores fetch
// (all issued directly from the browser) into one server round trip. Supabase
// PostgREST has no GROUP BY, so this still issues one indexed count query and
// one indexed top-N query per stage server-side (donor_discovery_prospects
// has an (organization_id, pipeline_stage) index and a score DESC index —
// migration 067) — but they're all fired in a single Promise.all from the
// server, not as 14 separate client requests.
//
// Derives organization_id from the authenticated session (never a query
// param) — Behavioral Contracts §2.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { selectAllPages } from "@/lib/supabase/select-all-pages";

export const runtime = "nodejs";

const PIPELINE_STAGES = [
  "new",
  "reviewing",
  "contacted",
  "applied",
  "received",
  "rejected",
  "archived",
] as const;

const TOP_N_PER_STAGE = 5;

interface StageDirectoryRef {
  legal_name: string;
  naics_codes: string[] | null;
  civic_kind: string | null;
}

interface StageProspectRow {
  id: string;
  score: number | null;
  score_rationale: string | null;
  directory: StageDirectoryRef | null;
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const [stageResults, scores] = await Promise.all([
    Promise.all(
      PIPELINE_STAGES.map(async (stage) => {
        const [countRes, topRes] = await Promise.all([
          supabase
            .from("donor_discovery_prospects")
            .select("*", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("pipeline_stage", stage),
          supabase
            .from("donor_discovery_prospects")
            .select("id, score, score_rationale, directory:donor_discovery_directory(legal_name, naics_codes, civic_kind)")
            .eq("organization_id", organizationId)
            .eq("pipeline_stage", stage)
            .order("score", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false })
            .limit(TOP_N_PER_STAGE),
        ]);
        return {
          stage,
          count: countRes.count ?? 0,
          top: (topRes.data ?? []) as unknown as StageProspectRow[],
        };
      }),
    ),
    // Paginated, not a single unbounded .select() — see WGR-030 in
    // test-evidence/_register/WIRING_GAP_REGISTER.md: with no .range(), this
    // silently truncated to the first (arbitrarily-ordered) 1000 scored
    // rows the moment an org passed 1000 scored prospects.
    selectAllPages<{ score: number | null }>((from, to) =>
      supabase
        .from("donor_discovery_prospects")
        .select("score")
        .eq("organization_id", organizationId)
        .not("score", "is", null)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: Array<{ score: number | null }> | null; error: unknown }>,
    ),
  ]);

  const stages: Record<string, { count: number; top: StageProspectRow[] }> = {};
  let totalProspects = 0;
  for (const { stage, count, top } of stageResults) {
    stages[stage] = { count, top };
    totalProspects += count;
  }

  const scoreValues = scores.map((r) => r.score).filter((s): s is number => s != null);
  const avgScore =
    scoreValues.length > 0 ? Math.round(scoreValues.reduce((sum, s) => sum + s, 0) / scoreValues.length) : null;

  return NextResponse.json({ stages, totalProspects, avgScore });
}
