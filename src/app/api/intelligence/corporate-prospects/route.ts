// GET /api/intelligence/corporate-prospects — Corporate Marketplace search/filter
// list (FEATURE_REGISTRY_v2.md row #97, "Corporate Marketplace: prospect search
// UI + filter engine").
//
// corporate_prospects (SCHEMA_REGISTRY_v2.md #36) has no organization_id — it's
// a shared, cross-org table with RLS enabled and zero permissive policies
// (111_corporate_prospects_rls_hardening.sql), service-role-only by design.
// Reads go through the admin client, same precedent as the sibling
// GET /api/intelligence/corporate-prospects/[id] and
// GET /api/intelligence/outreach/prospects routes.
//
// employee_count_estimate / revenue_estimate are both `text` columns
// (107_corporate_prospects.sql) — live-checked 2026-08-07 and confirmed 0 of
// 49 rows have either populated. Their filters below are real, functional
// substring matches against those text columns (not fabricated), but will
// match nothing until an enrichment agent actually populates them — see
// STATE_OF_THE_BUILD.md.
//
// Propensity-score sort/filter uses scores->>'PS-01' (AG-22's overall
// likelihood metric, AGENTS_v2.md AG-22 spec). Live-checked 2026-08-07: only
// 1 of 49 rows has a non-empty `scores` jsonb — sorting by score is real and
// works (nulls sort last via PostgREST's nullsFirst:false), but the ordering
// is a text comparison, not a numeric one (PostgREST's order parameter
// rejects a `::numeric` cast on a json path — confirmed live). This means
// once more rows are scored, two-digit-vs-one-digit scores could sort out of
// true numeric order (e.g. "9" > "10" as text). Not fixed here since it's
// currently unobservable with a single scored row; flagged for a future
// session once real score volume makes it matter.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

type SortOption = "name" | "score" | "recent";
const SORT_OPTIONS: SortOption[] = ["name", "score", "recent"];

interface PropensityMetric {
  score: number;
  rationale: string;
  top_factors: string[];
}

interface PropensityRanking {
  rank: number;
  ranked_at: string;
  is_priority_prospect: boolean;
}

type ScoresPayload = { "PS-01"?: PropensityMetric; ranking?: PropensityRanking } & Record<string, unknown>;

interface CorporateProspectRow {
  id: string;
  legal_name: string;
  dba_name: string | null;
  website: string | null;
  address_city: string | null;
  address_state: string | null;
  naics_description: string | null;
  industry_category: string | null;
  employee_count_estimate: string | null;
  revenue_estimate: string | null;
  is_family_owned: boolean | null;
  is_veteran_owned: boolean | null;
  is_minority_owned: boolean | null;
  is_woman_owned: boolean | null;
  scores: ScoresPayload | null;
  scores_computed_at: string | null;
  last_verified_at: string | null;
  created_at: string;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function parseBoolParam(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100);
  const industry = (searchParams.get("industry") ?? "").trim().slice(0, 200);
  const employeeContains = (searchParams.get("employeeContains") ?? "").trim().slice(0, 100);
  const revenueContains = (searchParams.get("revenueContains") ?? "").trim().slice(0, 100);
  const hasScore = parseBoolParam(searchParams.get("hasScore"));
  const familyOwned = parseBoolParam(searchParams.get("familyOwned"));
  const veteranOwned = parseBoolParam(searchParams.get("veteranOwned"));
  const minorityOwned = parseBoolParam(searchParams.get("minorityOwned"));
  const womanOwned = parseBoolParam(searchParams.get("womanOwned"));

  const sortParam = searchParams.get("sort") ?? "name";
  const sort: SortOption = (SORT_OPTIONS as string[]).includes(sortParam) ? (sortParam as SortOption) : "name";

  const pageParam = Number(searchParams.get("page"));
  const page = Number.isFinite(pageParam) && pageParam >= 0 ? Math.floor(pageParam) : 0;
  const pageSizeParam = Number(searchParams.get("pageSize"));
  const pageSize =
    Number.isFinite(pageSizeParam) && pageSizeParam > 0 ? Math.min(Math.floor(pageSizeParam), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

  const admin = createAdminClient();

  let query = admin
    .from("corporate_prospects")
    .select(
      [
        "id",
        "legal_name",
        "dba_name",
        "website",
        "address_city",
        "address_state",
        "naics_description",
        "industry_category",
        "employee_count_estimate",
        "revenue_estimate",
        "is_family_owned",
        "is_veteran_owned",
        "is_minority_owned",
        "is_woman_owned",
        "scores",
        "scores_computed_at",
        "last_verified_at",
        "created_at",
      ].join(", "),
      { count: "exact" },
    );

  if (q) {
    const escaped = q.replace(/[%,]/g, "");
    if (escaped) {
      query = query.or(`legal_name.ilike.%${escaped}%,dba_name.ilike.%${escaped}%`);
    }
  }
  if (industry) {
    query = query.eq("industry_category", industry);
  }
  if (employeeContains) {
    const escaped = employeeContains.replace(/[%,]/g, "");
    if (escaped) query = query.ilike("employee_count_estimate", `%${escaped}%`);
  }
  if (revenueContains) {
    const escaped = revenueContains.replace(/[%,]/g, "");
    if (escaped) query = query.ilike("revenue_estimate", `%${escaped}%`);
  }
  if (hasScore === true) {
    query = query.not("scores->PS-01", "is", null);
  } else if (hasScore === false) {
    query = query.is("scores->PS-01", null);
  }
  if (familyOwned !== undefined) query = query.eq("is_family_owned", familyOwned);
  if (veteranOwned !== undefined) query = query.eq("is_veteran_owned", veteranOwned);
  if (minorityOwned !== undefined) query = query.eq("is_minority_owned", minorityOwned);
  if (womanOwned !== undefined) query = query.eq("is_woman_owned", womanOwned);

  if (sort === "score") {
    // Text comparison, not numeric — see file header caveat.
    query = query.order("scores->PS-01->>score", { ascending: false, nullsFirst: false });
  } else if (sort === "recent") {
    query = query.order("created_at", { ascending: false });
  } else {
    query = query.order("legal_name", { ascending: true });
  }

  const from = page * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const [prospectsRes, industriesRes] = await Promise.all([
    query,
    // Small live table (49 rows as of 2026-08-07) — cheap to derive the real
    // distinct filter options directly rather than hardcoding a taxonomy
    // that could drift from what's actually on file.
    admin.from("corporate_prospects").select("industry_category").not("industry_category", "is", null),
  ]);

  if (prospectsRes.error) {
    return jsonError("Could not load corporate prospects.", 500);
  }

  const industries = Array.from(
    new Set(
      ((industriesRes.data ?? []) as { industry_category: string }[]).map((r) => r.industry_category),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const prospects = ((prospectsRes.data ?? []) as unknown as CorporateProspectRow[]).map((row) => {
    const displayName = row.dba_name?.trim() || row.legal_name;
    const overallScore = row.scores?.["PS-01"]?.score ?? null;
    const ranking = row.scores?.ranking ?? null;
    return {
      id: row.id,
      legalName: row.legal_name,
      dbaName: row.dba_name,
      displayName,
      website: row.website,
      city: row.address_city,
      state: row.address_state,
      industry: row.industry_category || row.naics_description,
      employeeCountEstimate: row.employee_count_estimate,
      revenueEstimate: row.revenue_estimate,
      ownership: {
        familyOwned: row.is_family_owned ?? false,
        veteranOwned: row.is_veteran_owned ?? false,
        minorityOwned: row.is_minority_owned ?? false,
        womanOwned: row.is_woman_owned ?? false,
      },
      overallScore,
      isPriorityProspect: ranking?.is_priority_prospect ?? false,
      scoresComputedAt: row.scores_computed_at,
      lastVerifiedAt: row.last_verified_at,
    };
  });

  const total = prospectsRes.count ?? prospects.length;

  return NextResponse.json({
    prospects,
    total,
    page,
    pageSize,
    hasMore: from + prospects.length < total,
    industries,
  });
}
