// Outcomes analytics aggregation — pure, deterministic transforms that turn raw
// rows from the outcomes / applications / opportunities / deadlines / agent_runs
// tables into the chart-ready datasets rendered by the Outcomes Analytics
// dashboard (BLUEPRINT §4.10).
//
// No AI, no I/O, no mocks — every figure is arithmetic over rows the caller has
// already fetched (RLS-scoped to the organization). Kept separate from the
// presentational component so the math is reproducible and unit-testable, the
// same split used by {@link analyzeOutcomes} in ai/learning/outcome-analyzer.ts.

import { format, isValid } from "date-fns";

import {
  PIPELINE_STAGES,
  TIER_PLANS,
  type SubscriptionTier,
} from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";

// --- Input row shapes -------------------------------------------------------
// Deliberately minimal & decoupled from the generated Database types: the
// browser Supabase client surfaces rows as `any` (see lib/supabase/client.ts),
// so the page maps each row into these shapes before handing them here.

export interface OutcomeRow {
  result: "awarded" | "denied" | "partial";
  awarded_amount: number | null;
  requested_amount: number | null;
  funder_category: string | null;
  opportunity_category: string | null;
  recorded_at: string;
  application_id: string;
}

export interface ApplicationRow {
  id: string;
  stage: string;
  requested_amount: number | null;
  awarded_amount: number | null;
  created_at: string;
  submitted_at: string | null;
}

export interface OpportunityRow {
  category: string | null;
  source_type: string | null;
  deadline: string | null;
}

export interface DeadlineRow {
  due_date: string;
  is_completed: boolean | null;
}

export interface AgentRunRow {
  agent_type: string;
  status: string | null;
  created_at: string;
  items_found: number | null;
}

// --- Shared helpers ---------------------------------------------------------

function num(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** YYYY-MM bucket key from an ISO timestamp; null if unparseable. */
function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return isValid(date) ? format(date, "yyyy-MM") : null;
}

function monthLabel(key: string): string {
  const date = new Date(`${key}-01T00:00:00`);
  return isValid(date) ? format(date, "MMM yyyy") : key;
}

function daysBetween(startIso: string, endIso: string): number | null {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!isValid(start) || !isValid(end)) return null;
  const diff = end.getTime() - start.getTime();
  if (diff < 0) return null;
  return diff / (1000 * 60 * 60 * 24);
}

function round(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// --- 1. Pipeline funnel -----------------------------------------------------
// Applications that have *reached at least* each stage, producing a true
// monotonically-narrowing funnel from the single current `stage` per app
// (an app in "awarded" has, by definition, passed through "discovered").

export interface FunnelStage {
  stage: string;
  label: string;
  count: number;
}

/** Funnel milestones — a readable subset of the 12-stage pipeline. */
const FUNNEL_MILESTONES = [
  "discovered",
  "qualified",
  "drafting",
  "submitted",
  "awarded",
] as const;

export function buildFunnel(apps: ApplicationRow[]): FunnelStage[] {
  const stageIndex = new Map<string, number>(
    PIPELINE_STAGES.map((s, i) => [s, i]),
  );
  // "denied" sits past "awarded" in the enum but is a terminal sibling, not a
  // deeper funnel step — treat reaching it as having reached "submitted".
  const reachedIndex = (stage: string): number => {
    if (stage === "denied") return stageIndex.get("submitted") ?? 0;
    return stageIndex.get(stage) ?? 0;
  };

  return FUNNEL_MILESTONES.map((milestone) => {
    const target = stageIndex.get(milestone) ?? 0;
    const count = apps.filter((a) => reachedIndex(a.stage) >= target).length;
    return { stage: milestone, label: humanizeEnum(milestone), count };
  });
}

// --- 2 & 3. Monthly success rate + dollars ----------------------------------

export interface MonthlyOutcomePoint {
  month: string;
  label: string;
  total: number;
  awarded: number;
  denied: number;
  partial: number;
  /** awarded / total as a 0-100 percentage (0 when no outcomes that month). */
  successRate: number;
  /** (awarded + partial) / total as a 0-100 percentage. */
  fundedRate: number;
  requested: number;
  awardedDollars: number;
}

export function buildMonthly(outcomes: OutcomeRow[]): MonthlyOutcomePoint[] {
  const months = new Map<
    string,
    {
      total: number;
      awarded: number;
      denied: number;
      partial: number;
      requested: number;
      awardedDollars: number;
    }
  >();

  for (const o of outcomes) {
    const key = monthKey(o.recorded_at);
    if (!key) continue;
    const b =
      months.get(key) ??
      {
        total: 0,
        awarded: 0,
        denied: 0,
        partial: 0,
        requested: 0,
        awardedDollars: 0,
      };
    b.total += 1;
    if (o.result === "awarded") b.awarded += 1;
    else if (o.result === "denied") b.denied += 1;
    else if (o.result === "partial") b.partial += 1;
    b.requested += num(o.requested_amount);
    b.awardedDollars += num(o.awarded_amount);
    months.set(key, b);
  }

  return Array.from(months.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, b]) => ({
      month,
      label: monthLabel(month),
      total: b.total,
      awarded: b.awarded,
      denied: b.denied,
      partial: b.partial,
      successRate: b.total > 0 ? round((b.awarded / b.total) * 100) : 0,
      fundedRate:
        b.total > 0 ? round(((b.awarded + b.partial) / b.total) * 100) : 0,
      requested: b.requested,
      awardedDollars: b.awardedDollars,
    }));
}

// --- 4. Source-category pie -------------------------------------------------

export interface SourceSlice {
  key: string;
  label: string;
  value: number;
}

export function buildSourcePie(opps: OpportunityRow[]): SourceSlice[] {
  const counts = new Map<string, number>();
  for (const o of opps) {
    const key = o.source_type ?? "unclassified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, value]) => ({
      key,
      label: key === "unclassified" ? "Unclassified" : humanizeEnum(key),
      value,
    }))
    .sort((a, b) => b.value - a.value);
}

// --- 5. Deadline density heatmap --------------------------------------------

export interface HeatmapDay {
  /** yyyy-MM-dd. */
  date: string;
  count: number;
}

export interface DeadlineHeatmap {
  /** Columns of weeks, each a 7-element array (index 0 = Sunday). */
  weeks: (HeatmapDay | null)[][];
  monthLabels: { index: number; label: string }[];
  maxCount: number;
  total: number;
}

/** Local yyyy-MM-dd key for a Date (avoids UTC offset drift on date-only data). */
function dayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Build a GitHub-style contribution grid of deadline density for the trailing
 * `weeks` weeks (default 26 ≈ 6 months), aligned to whole Sun→Sat weeks.
 */
export function buildDeadlineHeatmap(
  deadlines: DeadlineRow[],
  today: Date,
  weeks = 26,
): DeadlineHeatmap {
  const counts = new Map<string, number>();
  let total = 0;
  for (const d of deadlines) {
    const raw = (d.due_date ?? "").slice(0, 10);
    if (!raw) continue;
    const date = new Date(`${raw}T00:00:00`);
    if (!isValid(date)) continue;
    const key = dayKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }

  // End on the Saturday of the current week; start `weeks` Sundays earlier.
  const end = new Date(today);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + (6 - end.getDay())); // forward to Saturday
  const start = new Date(end);
  start.setDate(start.getDate() - (weeks * 7 - 1)); // back to first Sunday

  const grid: (HeatmapDay | null)[][] = [];
  const monthLabels: { index: number; label: string }[] = [];
  let maxCount = 0;
  let lastMonth = "";

  const cursor = new Date(start);
  for (let w = 0; w < weeks; w += 1) {
    const column: (HeatmapDay | null)[] = [];
    for (let d = 0; d < 7; d += 1) {
      const key = dayKey(cursor);
      const count = counts.get(key) ?? 0;
      if (count > maxCount) maxCount = count;
      column.push({ date: key, count });
      if (d === 0) {
        const m = format(cursor, "MMM");
        if (m !== lastMonth) {
          monthLabels.push({ index: w, label: m });
          lastMonth = m;
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    grid.push(column);
  }

  return { weeks: grid, monthLabels, maxCount, total };
}

// --- 6. Agent activity ------------------------------------------------------

export interface AgentActivity {
  type: string;
  label: string;
  runs: number;
  completed: number;
  failed: number;
  itemsFound: number;
}

export function buildAgentActivity(runs: AgentRunRow[]): AgentActivity[] {
  const groups = new Map<string, AgentActivity>();
  for (const r of runs) {
    const g =
      groups.get(r.agent_type) ??
      {
        type: r.agent_type,
        label: humanizeEnum(r.agent_type),
        runs: 0,
        completed: 0,
        failed: 0,
        itemsFound: 0,
      };
    g.runs += 1;
    if (r.status === "completed") g.completed += 1;
    else if (r.status === "failed") g.failed += 1;
    g.itemsFound += num(r.items_found);
    groups.set(r.agent_type, g);
  }
  return Array.from(groups.values()).sort((a, b) => b.runs - a.runs);
}

// --- 7. Pipeline velocity ---------------------------------------------------

export interface PipelineVelocity {
  /** Mean days from application creation to submission. null when none. */
  avgDaysToSubmit: number | null;
  /** Mean days from application creation to a recorded outcome. null when none. */
  avgDaysToOutcome: number | null;
  submittedCount: number;
  decidedCount: number;
}

export function computeVelocity(
  apps: ApplicationRow[],
  outcomes: OutcomeRow[],
): PipelineVelocity {
  const submitSpans: number[] = [];
  for (const a of apps) {
    if (!a.submitted_at) continue;
    const span = daysBetween(a.created_at, a.submitted_at);
    if (span != null) submitSpans.push(span);
  }

  const appCreatedById = new Map(apps.map((a) => [a.id, a.created_at]));
  const outcomeSpans: number[] = [];
  for (const o of outcomes) {
    const created = appCreatedById.get(o.application_id);
    if (!created) continue;
    const span = daysBetween(created, o.recorded_at);
    if (span != null) outcomeSpans.push(span);
  }

  const mean = (xs: number[]): number | null =>
    xs.length > 0 ? round(xs.reduce((s, x) => s + x, 0) / xs.length, 1) : null;

  return {
    avgDaysToSubmit: mean(submitSpans),
    avgDaysToOutcome: mean(outcomeSpans),
    submittedCount: submitSpans.length,
    decidedCount: outcomeSpans.length,
  };
}

// --- 8. Top performing categories -------------------------------------------

export interface CategoryPerformance {
  category: string;
  label: string;
  total: number;
  awarded: number;
  awardedDollars: number;
  /** awarded / total as a 0-100 percentage. */
  successRate: number;
}

export function buildTopCategories(
  outcomes: OutcomeRow[],
  limit = 6,
): CategoryPerformance[] {
  const groups = new Map<
    string,
    { total: number; awarded: number; awardedDollars: number }
  >();
  for (const o of outcomes) {
    const cat = o.funder_category ?? o.opportunity_category;
    if (!cat) continue;
    const g = groups.get(cat) ?? { total: 0, awarded: 0, awardedDollars: 0 };
    g.total += 1;
    if (o.result === "awarded" || o.result === "partial") {
      g.awarded += 1;
      g.awardedDollars += num(o.awarded_amount);
    }
    groups.set(cat, g);
  }
  return Array.from(groups.entries())
    .map(([category, g]) => ({
      category,
      label: humanizeEnum(category),
      total: g.total,
      awarded: g.awarded,
      awardedDollars: g.awardedDollars,
      successRate: g.total > 0 ? round((g.awarded / g.total) * 100) : 0,
    }))
    .sort((a, b) => b.awardedDollars - a.awardedDollars || b.total - a.total)
    .slice(0, limit);
}

// --- 9. ROI analysis --------------------------------------------------------

export interface RoiAnalysis {
  tier: SubscriptionTier;
  tierName: string;
  monthlyCost: number;
  annualCost: number;
  totalWon: number;
  /** totalWon / annualCost. null when the plan is free (no cost basis). */
  roiMultiple: number | null;
  netGain: number;
}

export function computeRoi(
  outcomes: OutcomeRow[],
  tier: SubscriptionTier,
): RoiAnalysis {
  const plan = TIER_PLANS[tier] ?? TIER_PLANS.free;
  const monthlyCost = plan.monthlyPrice;
  const annualCost = monthlyCost * 12;
  const totalWon = outcomes.reduce((s, o) => s + num(o.awarded_amount), 0);
  return {
    tier,
    tierName: plan.name,
    monthlyCost,
    annualCost,
    totalWon,
    roiMultiple: annualCost > 0 ? round(totalWon / annualCost, 1) : null,
    netGain: totalWon - annualCost,
  };
}

// --- 10. Year-over-year -----------------------------------------------------

export interface YearPoint {
  year: string;
  total: number;
  awarded: number;
  denied: number;
  partial: number;
  requestedDollars: number;
  awardedDollars: number;
  successRate: number;
}

export function buildYearOverYear(outcomes: OutcomeRow[]): YearPoint[] {
  const years = new Map<
    string,
    {
      total: number;
      awarded: number;
      denied: number;
      partial: number;
      requestedDollars: number;
      awardedDollars: number;
    }
  >();
  for (const o of outcomes) {
    const date = new Date(o.recorded_at);
    if (!isValid(date)) continue;
    const year = format(date, "yyyy");
    const b =
      years.get(year) ??
      {
        total: 0,
        awarded: 0,
        denied: 0,
        partial: 0,
        requestedDollars: 0,
        awardedDollars: 0,
      };
    b.total += 1;
    if (o.result === "awarded") b.awarded += 1;
    else if (o.result === "denied") b.denied += 1;
    else if (o.result === "partial") b.partial += 1;
    b.requestedDollars += num(o.requested_amount);
    b.awardedDollars += num(o.awarded_amount);
    years.set(year, b);
  }
  return Array.from(years.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, b]) => ({
      year,
      total: b.total,
      awarded: b.awarded,
      denied: b.denied,
      partial: b.partial,
      requestedDollars: b.requestedDollars,
      awardedDollars: b.awardedDollars,
      successRate: b.total > 0 ? round((b.awarded / b.total) * 100) : 0,
    }));
}

// --- Top-line KPIs ----------------------------------------------------------

export interface AnalyticsKpis {
  totalOutcomes: number;
  successRate: number;
  totalAwarded: number;
  totalRequested: number;
  dollarEfficiency: number;
  activeApplications: number;
}

const TERMINAL_STAGES = new Set(["awarded", "denied"]);

export function computeKpis(
  outcomes: OutcomeRow[],
  apps: ApplicationRow[],
): AnalyticsKpis {
  const total = outcomes.length;
  const awarded = outcomes.filter((o) => o.result === "awarded").length;
  const totalAwarded = outcomes.reduce(
    (s, o) => s + num(o.awarded_amount),
    0,
  );
  const totalRequested = outcomes.reduce(
    (s, o) => s + num(o.requested_amount),
    0,
  );
  return {
    totalOutcomes: total,
    successRate: total > 0 ? round((awarded / total) * 100) : 0,
    totalAwarded,
    totalRequested,
    dollarEfficiency:
      totalRequested > 0 ? round((totalAwarded / totalRequested) * 100) : 0,
    activeApplications: apps.filter((a) => !TERMINAL_STAGES.has(a.stage)).length,
  };
}
