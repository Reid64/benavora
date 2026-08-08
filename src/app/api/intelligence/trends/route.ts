import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import type { Enums } from "@/types/database";

// GET /api/intelligence/trends — Market Trend Intelligence MVP
// (FEATURE_REGISTRY_v2.md row #134, "Market Trend Intelligence", Pillar 11).
//
// Scope note: row #134's full canonical concept is "federal budget + foundation
// trend analysis" against external macro data sources — that is NOT what this
// route does. This route aggregates volume trends over data this org's
// `opportunities` rows already contain (real grants.gov/SAM.gov/land-bank
// ingestion, see src/lib/sources/{grantsgov-sync,federal-grants-poller,
// land-bank-client}.ts), bucketed by month using `discovered_at` — the same
// real timestamp column /api/reports/funding-summary already uses for its own
// "Opportunities Found" trend line, confirmed by reading that route before
// writing this one. No external API is called, no new data source is added.
//
// Two independent series, deliberately not merged into one (see below):
// 1. `primary` — real `opportunities` rows for this org, split by either
//    `category` (funder_category, migration 001) or `source_type` (the
//    PHYSICAL opportunity_source_type column added in migration 010 — NOT the
//    grants-API's `category`-aliased "source_type" field described in
//    BEHAVIORAL_CONTRACTS.md; see migration 010's own header comment for this
//    exact distinction).
// 2. `fundedProposals` — a secondary, much smaller panel over
//    `intelligence_funded_proposals` (migration 048). This table is NOT
//    org-scoped (no organization_id column — confirmed by reading its DDL) and
//    is populated by a materially different set of ingestion scripts
//    (scripts/ingest-{nih-reporter,nsf-awards,federal-register,samhsa-hrsa}.ts,
//    confirmed by grep of their .from() calls — none of them ever write to
//    `opportunities`). Bucketed by `award_year` (its only real time
//    dimension — the table has no month-granularity date field for when a
//    grant was actually awarded, only `created_at`, which is ingestion time,
//    not award time) rather than by month, since award_year is the honest
//    grain this data actually supports.

type FunderCategory = Enums<"funder_category">;
type OpportunitySourceType = Enums<"opportunity_source_type">;

interface OpportunityRow {
  id: string;
  category: FunderCategory;
  source_type: OpportunitySourceType | null;
  discovered_at: string;
}

interface FundedProposalRow {
  id: string;
  award_year: number | null;
}

const TREND_MONTHS = 12;
// Thresholds for the honest "not enough data yet" state (task requirement) —
// stated explicitly here rather than left as a magic number: fewer than 5
// total rows, or all of them landing in a single month, isn't a trend, it's
// a data point.
const MIN_TOTAL_FOR_TREND = 5;
const MIN_MONTHS_FOR_TREND = 2;
const MIN_YEARS_FOR_TREND = 2;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const [opportunitiesResult, fundedProposalsResult] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id, category, source_type, discovered_at")
      .eq("organization_id", organizationId),
    // Platform-wide, not org-scoped — see header comment. Only the columns
    // this route actually uses are selected.
    supabase.from("intelligence_funded_proposals").select("id, award_year"),
  ]);

  if (opportunitiesResult.error) {
    return jsonError("Failed to load opportunity trend data.", "db_error", 500);
  }

  const opportunities = (opportunitiesResult.data ?? []) as OpportunityRow[];

  // ---- Primary series: opportunities by month, split by category / source_type ----
  const now = new Date();
  const monthBuckets: { key: string; label: string; date: Date; next: Date }[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    monthBuckets.push({ key: monthKey(d), label: monthLabel(d), date: d, next });
  }

  const categoryTotals = new Map<string, number>();
  const sourceTypeTotals = new Map<string, number>();

  const months = monthBuckets.map((bucket) => {
    const rowsInMonth = opportunities.filter((o) => {
      const t = new Date(o.discovered_at).getTime();
      return t >= bucket.date.getTime() && t < bucket.next.getTime();
    });

    const byCategory: Record<string, number> = {};
    const bySourceType: Record<string, number> = {};

    for (const row of rowsInMonth) {
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
      categoryTotals.set(row.category, (categoryTotals.get(row.category) ?? 0) + 1);

      const sourceKey = row.source_type ?? "unclassified";
      bySourceType[sourceKey] = (bySourceType[sourceKey] ?? 0) + 1;
      sourceTypeTotals.set(sourceKey, (sourceTypeTotals.get(sourceKey) ?? 0) + 1);
    }

    return {
      key: bucket.key,
      label: bucket.label,
      total: rowsInMonth.length,
      byCategory,
      bySourceType,
    };
  });

  const totalOpportunities = opportunities.length;
  const monthsWithData = months.filter((m) => m.total > 0).length;
  const hasEnoughData =
    totalOpportunities >= MIN_TOTAL_FOR_TREND && monthsWithData >= MIN_MONTHS_FOR_TREND;

  const categories = Array.from(categoryTotals.keys()).sort(
    (a, b) => (categoryTotals.get(b) ?? 0) - (categoryTotals.get(a) ?? 0),
  );
  const sourceTypes = Array.from(sourceTypeTotals.keys()).sort(
    (a, b) => (sourceTypeTotals.get(b) ?? 0) - (sourceTypeTotals.get(a) ?? 0),
  );

  // ---- Secondary series: funded proposals by award year (see header comment) ----
  let fundedProposals: {
    total: number;
    hasEnoughData: boolean;
    years: { year: number; count: number }[];
  };

  if (fundedProposalsResult.error) {
    // Non-fatal — this is the secondary, clearly-separate panel. A failure
    // here should not take down the primary opportunities trend.
    fundedProposals = { total: 0, hasEnoughData: false, years: [] };
  } else {
    const proposals = (fundedProposalsResult.data ?? []) as FundedProposalRow[];
    const yearCounts = new Map<number, number>();
    for (const p of proposals) {
      if (p.award_year === null) continue;
      yearCounts.set(p.award_year, (yearCounts.get(p.award_year) ?? 0) + 1);
    }
    const years = Array.from(yearCounts.entries())
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year);
    const yearsWithData = years.length;
    fundedProposals = {
      total: proposals.length,
      hasEnoughData: proposals.length >= MIN_TOTAL_FOR_TREND && yearsWithData >= MIN_YEARS_FOR_TREND,
      years,
    };
  }

  return NextResponse.json({
    primary: {
      totalOpportunities,
      monthsWithData,
      hasEnoughData,
      months,
      categories,
      sourceTypes,
    },
    fundedProposals,
  });
}
