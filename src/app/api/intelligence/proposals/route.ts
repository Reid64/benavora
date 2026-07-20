import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

export const runtime = "nodejs";

const PAGE_SIZE = 20;

// Real values written by the ingestion scripts into intelligence_funded_proposals.source
// (scripts/ingest-nih-reporter.ts, ingest-nsf-awards.ts, ingest-federal-register.ts,
// ingest-samhsa-hrsa.ts, src/scripts/ingest-nih-proposals.ts). "ALL" is a UI-only sentinel,
// not a real column value.
const KNOWN_SOURCES = [
  "NIH_REPORTER",
  "NSF_AWARDS",
  "FEDERAL_REGISTER",
  "USASPENDING",
  "NIH_NIAID",
] as const;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function readMetadataField(metadata: Json | null, field: string): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return (metadata as Record<string, unknown>)[field];
}

function readOrganization(metadata: Json | null): string | null {
  const value = readMetadataField(metadata, "organization");
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readMetaStringArray(metadata: Json | null, field: string): string[] {
  const value = readMetadataField(metadata, field);
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function readMetaString(metadata: Json | null, field: string): string | null {
  const value = readMetadataField(metadata, field);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export async function GET(request: Request) {
  const roleCheck = await requireRole("viewer");
  if ("error" in roleCheck) return roleCheck.error;

  const supabase = createClient();
  const { searchParams } = new URL(request.url);

  const sourceParam = searchParams.get("source")?.trim() || "ALL";
  const source = KNOWN_SOURCES.includes(sourceParam as (typeof KNOWN_SOURCES)[number])
    ? sourceParam
    : "ALL";

  const searchRaw = searchParams.get("search")?.trim() ?? "";
  // PostgREST's .or() filter uses commas/parens as syntax — strip them so a search
  // term can't break the filter expression.
  const search = searchRaw.replace(/[,()%]/g, "").slice(0, 200);

  const pageParam = parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  // Added filters: NTEE major letter (stored in `category`, not a real ntee_code
  // column -- see scripts/seed-intelligence-library.ts's header), funder type,
  // award amount range, and award year.
  const ntee = searchParams.get("ntee")?.trim().toUpperCase() || null;
  const funderType = searchParams.get("funderType")?.trim() || null;
  const minAmountParam = searchParams.get("minAmount");
  const maxAmountParam = searchParams.get("maxAmount");
  const minAmount = minAmountParam !== null ? Number(minAmountParam) : null;
  const maxAmount = maxAmountParam !== null ? Number(maxAmountParam) : null;
  const yearParam = searchParams.get("year");
  const year = yearParam !== null ? parseInt(yearParam, 10) : null;

  let query = supabase
    .from("intelligence_funded_proposals")
    .select(
      "id, source, source_url, funder_name, funder_type, grant_program, award_amount, award_year, category, full_text, metadata, created_at",
      { count: "exact" },
    );

  if (source !== "ALL") {
    query = query.eq("source", source);
  }
  if (search) {
    query = query.or(
      `grant_program.ilike.%${search}%,funder_name.ilike.%${search}%,full_text.ilike.%${search}%`,
    );
  }
  if (ntee) {
    query = query.contains("category", [ntee]);
  }
  if (funderType) {
    query = query.eq("funder_type", funderType);
  }
  if (minAmount !== null && Number.isFinite(minAmount)) {
    query = query.gte("award_amount", minAmount);
  }
  if (maxAmount !== null && Number.isFinite(maxAmount)) {
    query = query.lte("award_amount", maxAmount);
  }
  if (year !== null && Number.isFinite(year)) {
    query = query.eq("award_year", year);
  }

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const [resultsRes, totalRes, sourcesRes, earliestRes, latestRes, lastIngestedRes] =
    await Promise.all([
      query.order("created_at", { ascending: false }).range(from, to),
      supabase.from("intelligence_funded_proposals").select("id", { count: "exact", head: true }),
      supabase.from("intelligence_funded_proposals").select("source"),
      supabase
        .from("intelligence_funded_proposals")
        .select("award_year")
        .not("award_year", "is", null)
        .order("award_year", { ascending: true })
        .limit(1),
      supabase
        .from("intelligence_funded_proposals")
        .select("award_year")
        .not("award_year", "is", null)
        .order("award_year", { ascending: false })
        .limit(1),
      supabase
        .from("intelligence_funded_proposals")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

  if (resultsRes.error) {
    return jsonError("Failed to query proposals.", "query_failed", 500);
  }

  const results = (resultsRes.data ?? []).map((row) => ({
    id: row.id,
    source: row.source,
    sourceUrl: row.source_url,
    funderName: row.funder_name,
    funderType: row.funder_type,
    title: row.grant_program,
    awardAmount: row.award_amount,
    awardYear: row.award_year,
    category: row.category ?? [],
    organizationName: readOrganization(row.metadata),
    abstract: row.full_text,
    narrativeFull: row.full_text,
    nteeCode: readMetaString(row.metadata, "ntee_code"),
    successFactors: readMetaStringArray(row.metadata, "success_factors"),
    keywords: readMetaStringArray(row.metadata, "keywords"),
    createdAt: row.created_at,
  }));

  const total = resultsRes.count ?? 0;
  const totalSources = new Set((sourcesRes.data ?? []).map((r) => r.source)).size;
  const earliestYear = earliestRes.data?.[0]?.award_year ?? null;
  const latestYear = latestRes.data?.[0]?.award_year ?? null;
  const lastIngestionAt = lastIngestedRes.data?.[0]?.created_at ?? null;

  return NextResponse.json({
    results,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    stats: {
      totalProposals: totalRes.count ?? 0,
      totalSources,
      earliestYear,
      latestYear,
      lastIngestionAt,
    },
  });
}

// Manual "Add Awarded Grant Narrative" entry — platform-owner only, per the
// Intelligence Library task spec. This table has no title/narrative_full/
// ntee_code/success_factors/keywords columns (confirmed against
// supabase/migrations/048_grant_intelligence.sql and src/types/database.ts):
// title maps to grant_program (matching the GET handler's own `title: row.
// grant_program` mapping above), narrative_full maps to full_text, and
// ntee_code/success_factors/keywords are carried in metadata jsonb -- same
// convention scripts/seed-intelligence-library.ts uses for the platform-wide
// seed data. This is a shared, cross-org table (no organization_id column),
// so the insert runs on the admin client after the role gate, mirroring
// src/app/api/admin/prospects/route.ts's pattern for other shared tables.
interface ManualProposalBody {
  title?: unknown;
  funder_name?: unknown;
  grant_program?: unknown;
  award_amount?: unknown;
  award_year?: unknown;
  narrative_full?: unknown;
  ntee_code?: unknown;
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
    typeof body.award_amount === "number" && Number.isFinite(body.award_amount)
      ? body.award_amount
      : null;
  const awardYear =
    typeof body.award_year === "number" && Number.isInteger(body.award_year)
      ? body.award_year
      : null;
  const narrativeFull = toTrimmedString(body.narrative_full);
  const nteeCode = toTrimmedString(body.ntee_code);
  const successFactors = toStringArray(body.success_factors);
  const keywords = toStringArray(body.keywords);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("intelligence_funded_proposals")
    .insert({
      source: "MANUAL_ENTRY",
      source_url: null,
      funder_name: funderName,
      grant_program: title,
      award_amount: awardAmount,
      award_year: awardYear,
      full_text: narrativeFull,
      category: nteeCode ? [nteeCode] : [],
      metadata: {
        ntee_code: nteeCode,
        success_factors: successFactors,
        keywords: keywords,
        record_kind: "manual_entry",
        created_by: roleCheck.userId,
      },
    })
    .select("id, source, source_url, funder_name, grant_program, award_amount, award_year, full_text, metadata, created_at")
    .single();

  if (error || !data) {
    return jsonError("Failed to save the narrative.", "insert_failed", 500);
  }

  return NextResponse.json({ result: data }, { status: 201 });
}
