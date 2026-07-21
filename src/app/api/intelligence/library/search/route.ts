import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import {
  PROPOSAL_SELECT_COLUMNS,
  applyProposalFilters,
  mapProposalRow,
  parseFiltersFromSearchParams,
  sanitizeIlikeTerm,
  type ProposalRow,
} from "@/lib/intelligence/proposals-query";

export const runtime = "nodejs";

const RESULT_LIMIT = 20;

// Full-text search over the Grant Intelligence Library.
//
// The task spec calls for `full_text_search_vector @@ plainto_tsquery(...)`
// with ts_rank ordering. That column is part of migration 106
// (106_intelligence_library_schema_upgrade.sql), which is written but NOT
// applied to production as of 2026-07-21 (verified live this session --
// see src/lib/intelligence/proposals-query.ts header; the Management API
// PAT this repo uses for DDL also returns 401 in this session, so it could
// not be applied here either). Querying full_text_search_vector today would
// 500 with "column does not exist".
//
// This implements equivalent behavior against what IS live: an OR of
// case-insensitive substring matches across grant_program/funder_name/
// full_text (same fields the trigger in migration 106 would index), with a
// simple relevance score (per-field match weight + occurrence count) computed
// in application code and used to order results. The moment migration 106 is
// applied and a backfill populates full_text_search_vector, this can switch
// to `.textSearch("full_text_search_vector", query)` with no caller-facing
// change to the request/response shape.
function scoreMatch(term: string, row: ProposalRow): number {
  const t = term.toLowerCase();
  const program = (row.grant_program ?? "").toLowerCase();
  const funder = (row.funder_name ?? "").toLowerCase();
  const body = (row.full_text ?? "").toLowerCase();

  let score = 0;
  if (program.includes(t)) score += 5;
  if (funder.includes(t)) score += 3;
  const bodyMatches = body.split(t).length - 1;
  score += Math.min(bodyMatches, 5);
  return score;
}

interface SearchBody {
  query?: unknown;
  filters?: Record<string, unknown>;
}

export async function POST(request: Request) {
  const roleCheck = await requireRole("viewer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body.", code: "invalid_body" }, { status: 400 });
  }

  const queryText = typeof body.query === "string" ? sanitizeIlikeTerm(body.query) : "";
  if (!queryText) {
    return NextResponse.json({ error: "query is required.", code: "missing_query" }, { status: 400 });
  }

  // Reuse the same filter parser the GET route uses so the "filters" object
  // in the request body behaves identically to the query-string filters.
  const filterParams = new URLSearchParams();
  const rawFilters = body.filters ?? {};
  for (const [key, value] of Object.entries(rawFilters)) {
    if (value === null || value === undefined || value === "") continue;
    filterParams.set(key, String(value));
  }
  const filters = parseFiltersFromSearchParams(filterParams);

  const supabase = createClient();
  let query = supabase
    .from("intelligence_funded_proposals")
    .select(PROPOSAL_SELECT_COLUMNS)
    .or(`grant_program.ilike.%${queryText}%,funder_name.ilike.%${queryText}%,full_text.ilike.%${queryText}%`);
  query = applyProposalFilters(query, filters);

  const { data, error } = await query.limit(200);
  if (error) {
    return NextResponse.json({ error: "Search failed.", code: "search_failed" }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as ProposalRow[];
  const ranked = rows
    .map((row) => ({ row, rank: scoreMatch(queryText, row) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, RESULT_LIMIT);

  return NextResponse.json({
    results: ranked.map(({ row, rank }) => ({ ...mapProposalRow(row), rank })),
    total: rows.length,
    query: queryText,
  });
}
