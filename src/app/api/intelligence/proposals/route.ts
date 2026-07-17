import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
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

function readOrganization(metadata: Json | null): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).organization;
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

  let query = supabase
    .from("intelligence_funded_proposals")
    .select("id, source, source_url, funder_name, grant_program, award_amount, award_year, full_text, metadata, created_at", {
      count: "exact",
    });

  if (source !== "ALL") {
    query = query.eq("source", source);
  }
  if (search) {
    query = query.or(
      `grant_program.ilike.%${search}%,funder_name.ilike.%${search}%,full_text.ilike.%${search}%`,
    );
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
    return jsonError(resultsRes.error.message, "query_failed", 500);
  }

  const results = (resultsRes.data ?? []).map((row) => ({
    id: row.id,
    source: row.source,
    sourceUrl: row.source_url,
    funderName: row.funder_name,
    title: row.grant_program,
    awardAmount: row.award_amount,
    awardYear: row.award_year,
    organizationName: readOrganization(row.metadata),
    abstract: row.full_text,
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
