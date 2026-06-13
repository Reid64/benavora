// Outcome pattern analyzer - powers the Outcomes & Analytics dashboards
// (BLUEPRINT §4.10) and feeds the Recursive Learning Agent's analytics step
// (AGENTS.md Agent 10).
//
// Pure, deterministic aggregation over outcome rows - no AI, no I/O. The agent
// does the AI work (narrative extraction); the patterns here are arithmetic over
// recorded results so they are exact and reproducible.
//
// Rate rules (Behavioral Contracts §10): a success-rate percentage is only shown
// once a bucket has at least MIN_OUTCOMES_FOR_RATE outcomes; below that the rate
// is null and the UI shows "Insufficient data". Success rate is
// awarded / total (Contracts §10). Partial awards are surfaced separately and
// rolled into a secondary "funded" rate (awarded + partial) / total.

import { format, isValid } from "date-fns";

import { MIN_OUTCOMES_FOR_RATE } from "@/lib/utils/constants";
import {
  computeEffectiveness,
  shouldFlagForRetirement,
  totalUses,
  type EffectivenessTier,
  effectivenessTier,
} from "@/lib/ai/learning/narrative-scorer";
import type { Enums, Tables } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

/** Minimum subset of an outcomes row the analyzer needs. */
export type OutcomeInput = Pick<
  Tables<"outcomes">,
  | "result"
  | "awarded_amount"
  | "requested_amount"
  | "funder_category"
  | "opportunity_category"
  | "denial_reason"
  | "recorded_at"
>;

export interface OutcomeSummary {
  total: number;
  awarded: number;
  denied: number;
  partial: number;
  /** awarded / total, as a 0-100 percentage. null below MIN_OUTCOMES_FOR_RATE. */
  successRate: number | null;
  /** (awarded + partial) / total, as a 0-100 percentage. null below the floor. */
  fundedRate: number | null;
  totalRequested: number;
  totalAwarded: number;
  /** total_awarded / total_requested * 100 (Contracts §10). null when no requests. */
  dollarEfficiency: number | null;
  /** Whether enough outcomes exist to show percentages. */
  hasEnoughForRate: boolean;
}

export interface CategoryStat {
  category: FunderCategory;
  total: number;
  awarded: number;
  denied: number;
  partial: number;
  successRate: number | null;
  totalRequested: number;
  totalAwarded: number;
  /** Mean award across funded (awarded + partial) outcomes. null when none. */
  averageAward: number | null;
}

export interface MonthlyPoint {
  /** Sort key, e.g. "2026-06". */
  month: string;
  /** Display label, e.g. "Jun 2026". */
  label: string;
  total: number;
  awarded: number;
  denied: number;
  partial: number;
  successRate: number | null;
  totalRequested: number;
  totalAwarded: number;
}

export interface DenialPattern {
  reason: string;
  count: number;
}

export interface OutcomeAnalysis {
  summary: OutcomeSummary;
  byFunderCategory: CategoryStat[];
  byOpportunityCategory: CategoryStat[];
  overTime: MonthlyPoint[];
  denialPatterns: DenialPattern[];
}

/** awarded/total as a rounded percentage, or null below the rate floor. */
function rate(awarded: number, total: number): number | null {
  if (total < MIN_OUTCOMES_FOR_RATE || total === 0) return null;
  return Math.round((awarded / total) * 100);
}

function num(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** YYYY-MM bucket key from an ISO timestamp; "unknown" if unparseable. */
function monthKey(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const date = new Date(iso);
  return isValid(date) ? format(date, "yyyy-MM") : "unknown";
}

function monthLabel(key: string): string {
  if (key === "unknown") return "Unknown";
  const date = new Date(`${key}-01T00:00:00`);
  return isValid(date) ? format(date, "MMM yyyy") : key;
}

/** Mutable accumulator used while grouping. */
interface Bucket {
  total: number;
  awarded: number;
  denied: number;
  partial: number;
  totalRequested: number;
  totalAwarded: number;
}

function emptyBucket(): Bucket {
  return {
    total: 0,
    awarded: 0,
    denied: 0,
    partial: 0,
    totalRequested: 0,
    totalAwarded: 0,
  };
}

function tally(bucket: Bucket, o: OutcomeInput): void {
  bucket.total += 1;
  if (o.result === "awarded") bucket.awarded += 1;
  else if (o.result === "denied") bucket.denied += 1;
  else if (o.result === "partial") bucket.partial += 1;
  bucket.totalRequested += num(o.requested_amount);
  bucket.totalAwarded += num(o.awarded_amount);
}

function toCategoryStat(category: FunderCategory, b: Bucket): CategoryStat {
  const funded = b.awarded + b.partial;
  return {
    category,
    total: b.total,
    awarded: b.awarded,
    denied: b.denied,
    partial: b.partial,
    successRate: rate(b.awarded, b.total),
    totalRequested: b.totalRequested,
    totalAwarded: b.totalAwarded,
    averageAward: funded > 0 ? Math.round(b.totalAwarded / funded) : null,
  };
}

function groupByCategory(
  outcomes: OutcomeInput[],
  pick: (o: OutcomeInput) => FunderCategory | null,
): CategoryStat[] {
  const groups = new Map<FunderCategory, Bucket>();
  for (const o of outcomes) {
    const category = pick(o);
    if (!category) continue;
    const bucket = groups.get(category) ?? emptyBucket();
    tally(bucket, o);
    groups.set(category, bucket);
  }
  return Array.from(groups.entries())
    .map(([category, bucket]) => toCategoryStat(category, bucket))
    .sort((a, b) => b.total - a.total);
}

/**
 * Aggregate a set of outcomes into the full analytics model. Safe on an empty
 * array (returns zeroed summary and empty groups).
 */
export function analyzeOutcomes(outcomes: OutcomeInput[]): OutcomeAnalysis {
  const overall = emptyBucket();
  const months = new Map<string, Bucket>();
  const denials = new Map<string, number>();

  for (const o of outcomes) {
    tally(overall, o);

    const key = monthKey(o.recorded_at);
    const monthBucket = months.get(key) ?? emptyBucket();
    tally(monthBucket, o);
    months.set(key, monthBucket);

    if (o.result === "denied") {
      const reason = (o.denial_reason ?? "").trim() || "Unspecified";
      denials.set(reason, (denials.get(reason) ?? 0) + 1);
    }
  }

  const summary: OutcomeSummary = {
    total: overall.total,
    awarded: overall.awarded,
    denied: overall.denied,
    partial: overall.partial,
    successRate: rate(overall.awarded, overall.total),
    fundedRate: rate(overall.awarded + overall.partial, overall.total),
    totalRequested: overall.totalRequested,
    totalAwarded: overall.totalAwarded,
    dollarEfficiency:
      overall.totalRequested > 0
        ? Math.round((overall.totalAwarded / overall.totalRequested) * 100)
        : null,
    hasEnoughForRate: overall.total >= MIN_OUTCOMES_FOR_RATE,
  };

  const overTime: MonthlyPoint[] = Array.from(months.entries())
    .filter(([key]) => key !== "unknown")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, b]) => ({
      month,
      label: monthLabel(month),
      total: b.total,
      awarded: b.awarded,
      denied: b.denied,
      partial: b.partial,
      successRate: rate(b.awarded, b.total),
      totalRequested: b.totalRequested,
      totalAwarded: b.totalAwarded,
    }));

  const denialPatterns: DenialPattern[] = Array.from(denials.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    summary,
    byFunderCategory: groupByCategory(outcomes, (o) => o.funder_category),
    byOpportunityCategory: groupByCategory(
      outcomes,
      (o) => o.opportunity_category,
    ),
    overTime,
    denialPatterns,
  };
}

// --- proven narrative ranking -----------------------------------------------

/** Minimum proven_narratives fields needed to rank top performers. */
export type NarrativeRankInput = Pick<
  Tables<"proven_narratives">,
  | "id"
  | "narrative_text"
  | "section_type"
  | "funder_category"
  | "success_count"
  | "effectiveness_score"
  | "last_used_at"
>;

export interface RankedNarrative {
  id: string;
  excerpt: string;
  sectionType: string | null;
  funderCategory: FunderCategory | null;
  successCount: number;
  effectivenessScore: number | null;
  tier: EffectivenessTier;
  flaggedForRetirement: boolean;
  lastUsedAt: string | null;
}

/** Single-line excerpt of a narrative for compact list display. */
function excerpt(text: string, max = 160): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/**
 * Rank proven narratives best-first for the "top performing narrative patterns"
 * panel (BLUEPRINT §4.10): by effectiveness, then by number of wins.
 *
 * Retirement is computed against the narrative's wins vs. denials in the same
 * funder_category; the caller supplies that denial tally as `failuresByCategory`
 * (defaults to 0 when unknown), keeping the wins/(wins+failures) shape from
 * Contracts §10.
 */
export function rankNarratives(
  narratives: NarrativeRankInput[],
  failuresByCategory: Map<FunderCategory, number> = new Map(),
  limit = 5,
): RankedNarrative[] {
  return narratives
    .map((n) => {
      const successCount = num(n.success_count);
      const failures = n.funder_category
        ? (failuresByCategory.get(n.funder_category) ?? 0)
        : 0;
      const uses = totalUses(successCount, failures);
      const effectivenessScore =
        n.effectiveness_score ??
        (uses > 0 ? computeEffectiveness(successCount, failures) : null);
      return {
        id: n.id,
        excerpt: excerpt(n.narrative_text),
        sectionType: n.section_type,
        funderCategory: n.funder_category,
        successCount,
        effectivenessScore,
        tier: effectivenessTier(effectivenessScore, Math.max(uses, successCount)),
        flaggedForRetirement: shouldFlagForRetirement(successCount, failures),
        lastUsedAt: n.last_used_at,
      } satisfies RankedNarrative;
    })
    .sort((a, b) => {
      const scoreDelta =
        (b.effectivenessScore ?? 0) - (a.effectivenessScore ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      return b.successCount - a.successCount;
    })
    .slice(0, limit);
}
