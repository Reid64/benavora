"use client";

import { Award, TrendingUp } from "lucide-react";

import { Badge, Card, EmptyState } from "@/components/ui";
import { MIN_OUTCOMES_FOR_RATE } from "@/lib/utils/constants";
import { formatCurrency, formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type {
  CategoryStat,
  MonthlyPoint,
  OutcomeAnalysis,
  RankedNarrative,
} from "@/lib/ai/learning/outcome-analyzer";
import type { EffectivenessTier } from "@/lib/ai/learning/narrative-scorer";
import type { BadgeColor } from "@/components/ui";

export type SuccessAnalyticsProps = {
  analysis: OutcomeAnalysis;
  /** Pre-ranked proven narratives for the "top performers" panel. */
  topNarratives: RankedNarrative[];
};

const TIER_COLOR: Record<EffectivenessTier, BadgeColor> = {
  high: "green",
  moderate: "yellow",
  low: "red",
  untested: "gray",
};

/**
 * Success-rate and dollar analytics for recorded outcomes (BLUEPRINT §4.10).
 *
 * All figures come from real outcome rows aggregated by {@link analyzeOutcomes}.
 * Percentages are suppressed until a bucket reaches {@link MIN_OUTCOMES_FOR_RATE}
 * outcomes (Behavioral Contracts §10) — those buckets show "Insufficient data".
 */
export function SuccessAnalytics({
  analysis,
  topNarratives,
}: SuccessAnalyticsProps) {
  const { summary, byFunderCategory, byOpportunityCategory, overTime, denialPatterns } =
    analysis;

  if (summary.total === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No outcomes recorded yet"
        description="Record application outcomes to unlock success-rate trends, dollar efficiency, and your top performing narratives."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Outcomes recorded" value={String(summary.total)} />
        <StatCard
          label="Success rate"
          value={formatRate(summary.successRate)}
          hint={
            summary.hasEnoughForRate
              ? `${summary.awarded} awarded of ${summary.total}`
              : `Needs ${MIN_OUTCOMES_FOR_RATE}+ outcomes`
          }
        />
        <StatCard
          label="Dollars awarded"
          value={formatCurrency(summary.totalAwarded)}
          hint={`of ${formatCurrency(summary.totalRequested)} requested`}
        />
        <StatCard
          label="Dollar efficiency"
          value={
            summary.dollarEfficiency != null
              ? `${summary.dollarEfficiency}%`
              : "—"
          }
          hint="Awarded ÷ requested"
        />
      </div>

      {!summary.hasEnoughForRate && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Success-rate percentages appear once you have at least{" "}
          {MIN_OUTCOMES_FOR_RATE} recorded outcomes in a category. You have{" "}
          {summary.total} so far.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Success rate by funder category">
          <CategoryRates stats={byFunderCategory} />
        </Card>
        <Card title="Success rate by grant category">
          <CategoryRates stats={byOpportunityCategory} />
        </Card>
      </div>

      <Card
        title="Success rate over time"
        description="Awarded vs. total outcomes by month."
      >
        <TrendChart points={overTime} />
      </Card>

      <Card
        title="Dollars requested vs. awarded"
        description="By month, across all outcomes."
      >
        <DollarsChart points={overTime} />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Top performing narratives">
          <TopNarratives narratives={topNarratives} />
        </Card>
        <Card title="Denial patterns">
          <DenialPatterns
            patterns={denialPatterns}
            totalDenied={summary.denied}
          />
        </Card>
      </div>
    </div>
  );
}

// --- summary -----------------------------------------------------------------

function formatRate(rate: number | null): string {
  return rate != null ? `${rate}%` : "—";
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-navy-200 bg-white p-4 shadow-sm">
      <div className="text-sm text-navy-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-navy-900">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-navy-400">{hint}</div>}
    </div>
  );
}

// --- category rates ----------------------------------------------------------

function CategoryRates({ stats }: { stats: CategoryStat[] }) {
  if (stats.length === 0) {
    return <p className="text-sm text-navy-500">No outcomes in any category yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {stats.map((stat) => (
        <li key={stat.category}>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-navy-700">
              {humanizeEnum(stat.category)}
            </span>
            <span className="text-navy-500">
              {stat.successRate != null ? (
                <span className="font-semibold text-navy-900">
                  {stat.successRate}%
                </span>
              ) : (
                <span className="text-navy-400">Insufficient data</span>
              )}{" "}
              · {stat.awarded}/{stat.total}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-navy-100">
            <div
              className="h-full rounded-full bg-teal-500"
              style={{ width: `${stat.successRate ?? 0}%` }}
              aria-hidden
            />
          </div>
          {stat.averageAward != null && (
            <div className="mt-1 text-xs text-navy-400">
              Avg award {formatCurrency(stat.averageAward)}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// --- trend chart -------------------------------------------------------------

function TrendChart({ points }: { points: MonthlyPoint[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-navy-500">No dated outcomes yet.</p>;
  }
  const maxTotal = Math.max(...points.map((p) => p.total), 1);

  return (
    <div className="flex items-end gap-3 overflow-x-auto pb-2">
      {points.map((p) => {
        const awardedPct = (p.awarded / maxTotal) * 100;
        const otherPct = ((p.total - p.awarded) / maxTotal) * 100;
        return (
          <div
            key={p.month}
            className="flex min-w-[3rem] flex-1 flex-col items-center gap-1"
          >
            <div className="flex h-32 w-full flex-col justify-end">
              <div
                className="w-full rounded-t bg-navy-200"
                style={{ height: `${otherPct}%` }}
                aria-hidden
              />
              <div
                className="w-full bg-green-500"
                style={{ height: `${awardedPct}%` }}
                aria-hidden
              />
            </div>
            <div className="text-center text-[11px] leading-tight text-navy-500">
              {p.successRate != null ? `${p.successRate}%` : "—"}
            </div>
            <div className="whitespace-nowrap text-[11px] text-navy-400">
              {p.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- dollars chart -----------------------------------------------------------

function DollarsChart({ points }: { points: MonthlyPoint[] }) {
  const withDollars = points.filter(
    (p) => p.totalRequested > 0 || p.totalAwarded > 0,
  );
  if (withDollars.length === 0) {
    return <p className="text-sm text-navy-500">No dollar amounts recorded yet.</p>;
  }
  const maxDollars = Math.max(
    ...withDollars.flatMap((p) => [p.totalRequested, p.totalAwarded]),
    1,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs text-navy-500">
        <LegendDot className="bg-navy-300" label="Requested" />
        <LegendDot className="bg-teal-500" label="Awarded" />
      </div>
      {withDollars.map((p) => (
        <div key={p.month} className="text-sm">
          <div className="flex items-center justify-between">
            <span className="text-navy-600">{p.label}</span>
            <span className="text-navy-400">
              {formatCurrency(p.totalAwarded)} / {formatCurrency(p.totalRequested)}
            </span>
          </div>
          <div className="mt-1 space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-navy-100">
              <div
                className="h-full rounded-full bg-navy-300"
                style={{ width: `${(p.totalRequested / maxDollars) * 100}%` }}
                aria-hidden
              />
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-navy-100">
              <div
                className="h-full rounded-full bg-teal-500"
                style={{ width: `${(p.totalAwarded / maxDollars) * 100}%` }}
                aria-hidden
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${className}`} aria-hidden />
      {label}
    </span>
  );
}

// --- top narratives ----------------------------------------------------------

function TopNarratives({ narratives }: { narratives: RankedNarrative[] }) {
  if (narratives.length === 0) {
    return (
      <p className="text-sm text-navy-500">
        Proven narratives appear here after your first awarded application.
      </p>
    );
  }
  return (
    <ul className="space-y-4">
      {narratives.map((n) => (
        <li key={n.id} className="border-b border-navy-100 pb-4 last:border-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            {n.sectionType && (
              <Badge color="indigo">{humanizeEnum(n.sectionType)}</Badge>
            )}
            <Badge color={TIER_COLOR[n.tier]}>
              <Award className="h-3.5 w-3.5" aria-hidden />
              {n.effectivenessScore != null
                ? `${Math.round(n.effectivenessScore * 100)}% effective`
                : "Untested"}
            </Badge>
            <span className="text-xs text-navy-400">
              {n.successCount} win{n.successCount === 1 ? "" : "s"}
            </span>
            {n.flaggedForRetirement && (
              <Badge color="red">Review for retirement</Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-navy-600">{n.excerpt}</p>
          {n.lastUsedAt && (
            <p className="mt-1 text-xs text-navy-400">
              Last used {formatRelative(n.lastUsedAt)}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// --- denial patterns ---------------------------------------------------------

function DenialPatterns({
  patterns,
  totalDenied,
}: {
  patterns: { reason: string; count: number }[];
  totalDenied: number;
}) {
  if (patterns.length === 0) {
    return (
      <p className="text-sm text-navy-500">
        No denials recorded — or none with a stated reason.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {patterns.map((p) => (
        <li
          key={p.reason}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span className="text-navy-700">{p.reason}</span>
          <Badge color="gray">
            {p.count} of {totalDenied}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
