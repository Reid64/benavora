import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import type { Enums } from "@/types/database";

// GET /api/reports/funding-summary — pipeline metrics, source/category
// breakdown, 12-month trend, and top-funder rollup for
// /reports/funding-summary.
//
// Deviation from the task-given spec, checked against real schema per this
// project's established practice (see land-bank-client.ts, 097_funding_sources.sql
// headers for the same pattern): the task asked for a "Funding by Program"
// table joined against the org's own programs. There is no program_id column
// on `applications` (confirmed against src/types/database.ts and every
// migration through 103) and no other FK linking an application to a
// `programs` row — so that join cannot be built without fabricating data.
// The closest real, honest dimension is opportunities.category (the
// funder_category enum — housing_grant/education_grant/etc), which is what
// this route and the page actually group by, labeled "Funding by Category".
//
// "Funding by Source" uses opportunities.source_type (migration 010) for the
// government/foundation/corporate buckets, and opportunities.source = 'land_bank'
// (land-bank-client.ts) for the Land Bank bucket — source_type has no
// 'land_bank' enum value, so land bank rows are only distinguishable via the
// free-text `source` column. These are deliberately two different columns
// feeding one chart, not a conflation of the two source_type concepts noted
// elsewhere in this codebase.

type Period = "month" | "quarter" | "year" | "all";

type OpportunitySourceType = Enums<"opportunity_source_type">;
type FunderCategory = Enums<"funder_category">;
type PipelineStage = Enums<"pipeline_stage">;

interface OpportunityRow {
  id: string;
  funder_id: string | null;
  name: string;
  category: FunderCategory;
  source_type: OpportunitySourceType | null;
  source: string | null;
  discovered_at: string;
}

interface ApplicationRow {
  id: string;
  opportunity_id: string;
  stage: PipelineStage;
  requested_amount: number | null;
  awarded_amount: number | null;
  submitted_at: string | null;
  created_at: string;
}

interface OutcomeRow {
  id: string;
  application_id: string;
  result: "awarded" | "denied" | "partial";
  awarded_amount: number | null;
  recorded_at: string;
}

interface FunderRow {
  id: string;
  name: string;
}

const CLOSED_STAGES: PipelineStage[] = ["awarded", "denied"];

const SOURCE_BUCKETS = ["federal", "foundation", "corporate", "state_local", "land_bank"] as const;
type SourceBucket = (typeof SOURCE_BUCKETS)[number];

const SOURCE_BUCKET_LABELS: Record<SourceBucket, string> = {
  federal: "Federal",
  foundation: "Foundation",
  corporate: "Corporate",
  state_local: "State/Local",
  land_bank: "Land Bank",
};

function bucketForOpportunity(opp: OpportunityRow): SourceBucket | null {
  if (opp.source === "land_bank") return "land_bank";
  switch (opp.source_type) {
    case "government_federal":
      return "federal";
    case "government_state":
    case "government_local":
      return "state_local";
    case "private_foundation":
    case "community_foundation":
      return "foundation";
    case "corporate_giving":
      return "corporate";
    default:
      return null;
  }
}

function periodStart(period: Period, now: Date): Date | null {
  switch (period) {
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "quarter": {
      const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
      return new Date(now.getFullYear(), qStartMonth, 1);
    }
    case "year":
      return new Date(now.getFullYear(), 0, 1);
    case "all":
      return null;
  }
}

function previousPeriodRange(period: Period, start: Date | null, now: Date): { from: Date; to: Date } | null {
  if (!start) return null;
  const durationMs = now.getTime() - start.getTime();
  if (period === "month") {
    const prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    const prevEnd = new Date(start.getTime());
    return { from: prevStart, to: prevEnd };
  }
  if (period === "quarter") {
    const prevStart = new Date(start.getFullYear(), start.getMonth() - 3, 1);
    const prevEnd = new Date(start.getTime());
    return { from: prevStart, to: prevEnd };
  }
  if (period === "year") {
    const prevStart = new Date(start.getFullYear() - 1, 0, 1);
    const prevEnd = new Date(start.getTime());
    return { from: prevStart, to: prevEnd };
  }
  return { from: new Date(start.getTime() - durationMs), to: start };
}

function inRange(dateStr: string | null, from: Date | null, to: Date | null): boolean {
  if (!dateStr) return false;
  const t = new Date(dateStr).getTime();
  if (from && t < from.getTime()) return false;
  if (to && t >= to.getTime()) return false;
  return true;
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const periodParam = searchParams.get("period");
  const period: Period =
    periodParam === "month" || periodParam === "quarter" || periodParam === "year" || periodParam === "all"
      ? periodParam
      : "month";

  const now = new Date();
  const start = periodStart(period, now);
  const prevRange = previousPeriodRange(period, start, now);

  const [opportunitiesResult, applicationsResult, outcomesResult, fundersResult] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id, funder_id, name, category, source_type, source, discovered_at")
      .eq("organization_id", organizationId),
    supabase
      .from("applications")
      .select("id, opportunity_id, stage, requested_amount, awarded_amount, submitted_at, created_at")
      .eq("organization_id", organizationId),
    supabase
      .from("outcomes")
      .select("id, application_id, result, awarded_amount, recorded_at")
      .eq("organization_id", organizationId),
    supabase.from("funders").select("id, name").eq("organization_id", organizationId),
  ]);

  if (opportunitiesResult.error || applicationsResult.error || outcomesResult.error || fundersResult.error) {
    return jsonError("Failed to load funding summary data.", "db_error", 500);
  }

  const opportunities = (opportunitiesResult.data ?? []) as OpportunityRow[];
  const applications = (applicationsResult.data ?? []) as ApplicationRow[];
  const outcomes = (outcomesResult.data ?? []) as OutcomeRow[];
  const funders = (fundersResult.data ?? []) as FunderRow[];

  const opportunityById = new Map(opportunities.map((o) => [o.id, o]));
  const applicationById = new Map(applications.map((a) => [a.id, a]));
  const funderById = new Map(funders.map((f) => [f.id, f]));

  // ---- Summary metrics (respect the selected period on the relevant date field) ----
  const opportunitiesInPeriod = opportunities.filter((o) => inRange(o.discovered_at, start, null));
  const submittedInPeriod = applications.filter((a) => inRange(a.submitted_at, start, null));
  const awardedOutcomesInPeriod = outcomes.filter(
    (o) => o.result === "awarded" && inRange(o.recorded_at, start, null),
  );

  const totalOpportunitiesTracked = opportunitiesInPeriod.length;
  const totalApplied = submittedInPeriod.length;
  const totalRequested = submittedInPeriod.reduce((sum, a) => sum + (a.requested_amount ?? 0), 0);
  const totalAwardedCount = awardedOutcomesInPeriod.length;
  const totalAwardedAmount = awardedOutcomesInPeriod.reduce((sum, o) => sum + (o.awarded_amount ?? 0), 0);

  const decidedInPeriod = outcomes.filter((o) => inRange(o.recorded_at, start, null));
  const decidedCount = decidedInPeriod.filter((o) => o.result === "awarded" || o.result === "denied").length;
  const successRate = decidedCount > 0 ? totalAwardedCount / decidedCount : null;

  let successRateTrend: "up" | "down" | "flat" | null = null;
  if (prevRange) {
    const prevDecided = outcomes.filter(
      (o) =>
        (o.result === "awarded" || o.result === "denied") &&
        inRange(o.recorded_at, prevRange.from, prevRange.to),
    );
    const prevAwarded = prevDecided.filter((o) => o.result === "awarded").length;
    const prevRate = prevDecided.length > 0 ? prevAwarded / prevDecided.length : null;
    if (successRate !== null && prevRate !== null) {
      successRateTrend = successRate > prevRate ? "up" : successRate < prevRate ? "down" : "flat";
    }
  }

  const pipelineValue = applications
    .filter((a) => !CLOSED_STAGES.includes(a.stage))
    .reduce((sum, a) => sum + (a.requested_amount ?? 0), 0);

  // ---- Funding by source (5-bucket bar chart) ----
  const sourceBuckets = SOURCE_BUCKETS.map((key) => ({ key, label: SOURCE_BUCKET_LABELS[key], count: 0, amount: 0 }));
  const sourceBucketByKey = new Map(sourceBuckets.map((b) => [b.key, b]));
  for (const outcome of outcomes) {
    if (outcome.result !== "awarded") continue;
    const app = applicationById.get(outcome.application_id);
    if (!app) continue;
    const opp = opportunityById.get(app.opportunity_id);
    if (!opp) continue;
    const bucketKey = bucketForOpportunity(opp);
    if (!bucketKey) continue;
    const bucket = sourceBucketByKey.get(bucketKey)!;
    bucket.count += 1;
    bucket.amount += outcome.awarded_amount ?? 0;
  }

  // ---- Funding by category (real proxy for "program" — see header note) ----
  const categoryMap = new Map<
    FunderCategory,
    { applications: number; awarded: number; totalAwarded: number }
  >();
  for (const app of applications) {
    const opp = opportunityById.get(app.opportunity_id);
    if (!opp || !app.submitted_at) continue;
    const entry = categoryMap.get(opp.category) ?? { applications: 0, awarded: 0, totalAwarded: 0 };
    entry.applications += 1;
    categoryMap.set(opp.category, entry);
  }
  for (const outcome of outcomes) {
    if (outcome.result !== "awarded") continue;
    const app = applicationById.get(outcome.application_id);
    if (!app) continue;
    const opp = opportunityById.get(app.opportunity_id);
    if (!opp) continue;
    const entry = categoryMap.get(opp.category) ?? { applications: 0, awarded: 0, totalAwarded: 0 };
    entry.awarded += 1;
    entry.totalAwarded += outcome.awarded_amount ?? 0;
    categoryMap.set(opp.category, entry);
  }
  const fundingByCategory = Array.from(categoryMap.entries())
    .map(([category, v]) => ({
      category,
      applications: v.applications,
      awarded: v.awarded,
      successRate: v.applications > 0 ? v.awarded / v.applications : null,
      totalAwarded: v.totalAwarded,
    }))
    .sort((a, b) => b.totalAwarded - a.totalAwarded);

  // ---- Monthly pipeline trend, last 12 months ----
  const monthBuckets: { key: string; label: string; date: Date }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthBuckets.push({
      key: monthKey(d),
      label: d.toLocaleDateString("en-US", { month: "short" }),
      date: d,
    });
  }
  const trend = monthBuckets.map((bucket) => {
    const nextMonth = new Date(bucket.date.getFullYear(), bucket.date.getMonth() + 1, 1);
    const found = opportunities.filter((o) => inRange(o.discovered_at, bucket.date, nextMonth)).length;
    const submitted = applications.filter((a) => inRange(a.submitted_at, bucket.date, nextMonth)).length;
    const awarded = outcomes.filter(
      (o) => o.result === "awarded" && inRange(o.recorded_at, bucket.date, nextMonth),
    ).length;
    return { month: bucket.label, found, submitted, awarded };
  });

  // ---- Top funders ----
  const funderStats = new Map<
    string,
    { timesApplied: number; timesAwarded: number; totalAwarded: number; lastAwardDate: string | null }
  >();
  for (const app of applications) {
    if (!app.submitted_at) continue;
    const opp = opportunityById.get(app.opportunity_id);
    if (!opp?.funder_id) continue;
    const entry = funderStats.get(opp.funder_id) ?? {
      timesApplied: 0,
      timesAwarded: 0,
      totalAwarded: 0,
      lastAwardDate: null,
    };
    entry.timesApplied += 1;
    funderStats.set(opp.funder_id, entry);
  }
  for (const outcome of outcomes) {
    if (outcome.result !== "awarded") continue;
    const app = applicationById.get(outcome.application_id);
    if (!app) continue;
    const opp = opportunityById.get(app.opportunity_id);
    if (!opp?.funder_id) continue;
    const entry = funderStats.get(opp.funder_id) ?? {
      timesApplied: 0,
      timesAwarded: 0,
      totalAwarded: 0,
      lastAwardDate: null,
    };
    entry.timesAwarded += 1;
    entry.totalAwarded += outcome.awarded_amount ?? 0;
    if (!entry.lastAwardDate || new Date(outcome.recorded_at) > new Date(entry.lastAwardDate)) {
      entry.lastAwardDate = outcome.recorded_at;
    }
    funderStats.set(opp.funder_id, entry);
  }
  const topFunders = Array.from(funderStats.entries())
    .map(([funderId, v]) => ({
      funderId,
      funderName: funderById.get(funderId)?.name ?? "Unknown Funder",
      timesApplied: v.timesApplied,
      timesAwarded: v.timesAwarded,
      successRate: v.timesApplied > 0 ? v.timesAwarded / v.timesApplied : null,
      avgAwardAmount: v.timesAwarded > 0 ? v.totalAwarded / v.timesAwarded : null,
      lastAwardDate: v.lastAwardDate,
    }))
    .filter((f) => f.timesAwarded > 0)
    .sort((a, b) => b.timesAwarded - a.timesAwarded)
    .slice(0, 10);

  return NextResponse.json({
    period,
    dateRange: { from: start ? start.toISOString() : null, to: now.toISOString() },
    summary: {
      totalOpportunitiesTracked,
      totalApplied,
      totalRequested,
      totalAwardedCount,
      totalAwardedAmount,
      successRate,
      successRateTrend,
      pipelineValue,
    },
    fundingBySource: sourceBuckets,
    fundingByCategory,
    trend,
    topFunders,
  });
}
