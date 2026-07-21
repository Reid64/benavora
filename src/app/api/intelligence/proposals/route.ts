import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PROPOSAL_SELECT_COLUMNS,
  applyProposalFilters,
  computeFilteredStats,
  deriveFunderBucket,
  mapProposalRow,
  parseFiltersFromSearchParams,
  type ProposalRow,
} from "@/lib/intelligence/proposals-query";

export const runtime = "nodejs";

const PAGE_SIZE = 20;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const roleCheck = await requireRole("viewer");
  if ("error" in roleCheck) return roleCheck.error;

  const supabase = createClient();
  const { searchParams } = new URL(request.url);

  const filters = parseFiltersFromSearchParams(searchParams);

  const pageParam = parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const limitParam = parseInt(searchParams.get("limit") ?? "", 10);
  const pageSize = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : PAGE_SIZE;

  let query = supabase
    .from("intelligence_funded_proposals")
    .select(PROPOSAL_SELECT_COLUMNS, { count: "exact" });
  query = applyProposalFilters(query, filters);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const [resultsRes, totalRes, sourcesRes, filteredStats] = await Promise.all([
    query.order("created_at", { ascending: false }).range(from, to),
    supabase.from("intelligence_funded_proposals").select("id", { count: "exact", head: true }),
    supabase.from("intelligence_funded_proposals").select("source"),
    computeFilteredStats(supabase, filters),
  ]);

  if (resultsRes.error) {
    return jsonError("Failed to query proposals.", "query_failed", 500);
  }

  const results = ((resultsRes.data ?? []) as unknown as ProposalRow[]).map(mapProposalRow);
  const total = resultsRes.count ?? 0;
  const distinctSources = [...new Set((sourcesRes.data ?? []).map((r: { source: string }) => r.source))].sort();

  return NextResponse.json({
    results,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    stats: {
      totalProposals: totalRes.count ?? 0,
      sources: distinctSources,
    },
    filteredStats,
  });
}

// Manual "Add Awarded Grant Narrative" entry — platform-owner only. This
// table has no title/narrative_full/ntee_code/success_factors/keywords
// columns on live prod (confirmed against supabase/migrations/
// 048_grant_intelligence.sql and a live column probe this session — see
// src/lib/intelligence/proposals-query.ts header): title maps to
// grant_program, narrative_full maps to full_text, and ntee_code/
// success_factors/keywords/organization are carried in metadata jsonb, same
// convention scripts/seed-intelligence-library.ts uses. Shared, cross-org
// table (no organization_id column) -- insert runs on the admin client after
// the role gate, mirroring src/app/api/admin/prospects/route.ts.
interface ManualProposalBody {
  title?: unknown;
  funder_name?: unknown;
  funder_type?: unknown;
  grant_program?: unknown;
  award_amount?: unknown;
  award_year?: unknown;
  narrative_full?: unknown;
  ntee_code?: unknown;
  organization?: unknown;
  success_factors?: unknown;
  keywords?: unknown;
}

function toTrimmedString(val: unknown): string | null {
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : null;
}
function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

export async function POST(request: Request) {
  const roleCheck = await requireRole("owner");
  if ("error" in roleCheck) return roleCheck.error;

  let body: ManualProposalBody;
  try {
    body = (await request.json()) as ManualProposalBody;
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  const title = toTrimmedString(body.title) ?? toTrimmedString(body.grant_program);
  if (!title) {
    return jsonError("title (or grant_program) is required.", "missing_title", 400);
  }
  const funderName = toTrimmedString(body.funder_name);
  if (!funderName) {
    return jsonError("funder_name is required.", "missing_funder_name", 400);
  }

  const awardAmount =
    typeof body.award_amount === "number" && Number.isFinite(body.award_amount) ? body.award_amount : null;
  const awardYear =
    typeof body.award_year === "number" && Number.isInteger(body.award_year) ? body.award_year : null;
  const narrativeFull = toTrimmedString(body.narrative_full);
  const nteeCode = toTrimmedString(body.ntee_code);
  const funderType = toTrimmedString(body.funder_type);
  const organization = toTrimmedString(body.organization);
  const successFactors = toStringArray(body.success_factors);
  const keywords = toStringArray(body.keywords);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("intelligence_funded_proposals")
    .insert({
      source: "MANUAL_ENTRY",
      source_url: null,
      funder_name: funderName,
      funder_type: funderType,
      grant_program: title,
      award_amount: awardAmount,
      award_year: awardYear,
      full_text: narrativeFull,
      category: nteeCode ? [nteeCode] : [],
      metadata: {
        ntee_code: nteeCode,
        organization,
        success_factors: successFactors,
        keywords: keywords,
        record_kind: "manual_entry",
        created_by: roleCheck.userId,
      },
    })
    .select(PROPOSAL_SELECT_COLUMNS)
    .single();

  if (error || !data) {
    return jsonError("Failed to save the narrative.", "insert_failed", 500);
  }

  const row = data as unknown as ProposalRow;
  return NextResponse.json(
    { result: mapProposalRow(row), funderBucket: deriveFunderBucket(row.source, row.funder_type) },
    { status: 201 },
  );
}
