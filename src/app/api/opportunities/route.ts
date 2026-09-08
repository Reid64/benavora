import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  MISSION_RELEVANCE_REJECT_THRESHOLD,
  passesRelevanceFilter,
  scanUnscoredRelevance,
  type RelevanceCandidate,
} from "@/lib/opportunities/relevance";
import type { Tables } from "@/types/database";

// PostgREST caps any single request at 1000 rows regardless of .range()
// (see benavora-postgrest-max-rows-1000-cap) - loop past it explicitly so an
// org with >1000 opportunities doesn't silently lose relevance coverage over
// the tail of its own table.
const PAGE_SIZE = 1000;

/**
 * Root-cause fix for the Opportunities dashboard showing mission-irrelevant
 * results: this route (not the client component) is now the single place
 * that decides which of an org's opportunities are returned by default,
 * applying the same KB relevance mechanism the government-grants research
 * agent already uses at ingestion time (src/lib/opportunities/relevance.ts).
 * `minRelevance`/`includeUnscored` are the visible, client-controllable
 * safety net requested on top of this - never a substitute for it.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const orgId = headers().get("x-organization-id");

  if (!user || !orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const minRelevanceParam = url.searchParams.get("minRelevance");
  const minRelevance =
    minRelevanceParam !== null && !Number.isNaN(Number(minRelevanceParam))
      ? Number(minRelevanceParam)
      : MISSION_RELEVANCE_REJECT_THRESHOLD;
  const includeUnscored = url.searchParams.get("includeUnscored") === "true";

  type OpportunityRow = Tables<"opportunities">;
  const allRows: OpportunityRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("opportunities")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("[api/opportunities] fetch failed:", error);
      return NextResponse.json(
        { error: "Could not load opportunities." },
        { status: 500 },
      );
    }

    allRows.push(...((data ?? []) as OpportunityRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const candidates: RelevanceCandidate[] = allRows.map((o) => ({
    id: o.id,
    name: o.name,
    description: o.description,
    mission_relevance_score: (o as { mission_relevance_score: number | null })
      .mission_relevance_score,
  }));

  const scan = await scanUnscoredRelevance(supabase, orgId, candidates);

  const scoreFor = (o: OpportunityRow): number | null =>
    scan.scores.get(o.id) ??
    (o as { mission_relevance_score: number | null }).mission_relevance_score;

  const filtered = allRows.filter((o) =>
    passesRelevanceFilter(scoreFor(o), minRelevance, includeUnscored),
  );

  return NextResponse.json({
    opportunities: filtered.map((o) => ({
      ...o,
      mission_relevance_score: scoreFor(o),
    })),
    relevanceFilterActive: scan.filterActive,
    minRelevance,
    includeUnscored,
    totalBeforeFilter: allRows.length,
    totalAfterFilter: filtered.length,
    pendingScoreCount: scan.pendingCount,
  });
}
