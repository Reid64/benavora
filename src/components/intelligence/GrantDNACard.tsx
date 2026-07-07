"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Activity, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { GrantDNAScore } from "@/lib/intelligence/grant-dna";

export interface GrantDNAResult extends GrantDNAScore {
  percentile: number;
  comparison: string;
}

interface Props {
  result: GrantDNAResult;
  scoring?: boolean;
  onReScore?: () => void;
}

const DIMENSION_LABELS: Record<string, string> = {
  clarity: "Clarity",
  evidence_density: "Evidence",
  outcome_specificity: "Outcomes",
  funder_alignment: "Alignment",
  innovation: "Innovation",
  sustainability: "Sustain.",
  feasibility: "Feasibility",
  impact_scope: "Impact",
};

const DIMENSION_HINTS: Record<string, string> = {
  clarity: "Use shorter sentences and clearer headings. Avoid jargon and passive voice.",
  evidence_density: "Add citations, statistics, and research references. Quantify the problem with local data.",
  outcome_specificity: "Replace vague goals with SMART objectives: specific, measurable, time-bound targets.",
  funder_alignment: "Mirror the funder's language and priority areas. Reference their stated mission.",
  innovation: "Describe what makes your approach unique. Explain why existing solutions fall short.",
  sustainability: "Detail how the program continues after the grant ends. Name future revenue sources.",
  feasibility: "Break the timeline into phases. Show your team has the capacity and experience.",
  impact_scope: "Quantify how many people you will serve. Describe the ripple effect beyond direct beneficiaries.",
};

// Lazy-load Recharts to avoid SSR issues.
const DNARadarChart = dynamic(
  () =>
    import("recharts").then(
      ({ RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer }) => {
        function Chart({ data }: { data: Array<{ dim: string; score: number }> }) {
          return (
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={data} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
                <PolarGrid stroke="#1e293b" />
                <PolarAngleAxis
                  dataKey="dim"
                  tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: 500 }}
                />
                <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
                <Radar
                  dataKey="score"
                  stroke="#6366f1"
                  fill="#6366f1"
                  fillOpacity={0.25}
                  strokeWidth={2}
                />
              </RadarChart>
            </ResponsiveContainer>
          );
        }
        return Chart;
      },
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-[220px] animate-pulse rounded-lg bg-surface-raised" />
    ),
  },
);

export function GrantDNACard({ result, scoring = false, onReScore }: Props) {
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Scale composite (0-10) to display as 0-100.
  const displayScore = Math.round(result.composite * 10);
  const scoreColor =
    displayScore >= 75
      ? "text-success-text"
      : displayScore >= 50
        ? "text-warning-text"
        : "text-error-text";
  const scoreBg =
    displayScore >= 75
      ? "border-success-border bg-success-bg"
      : displayScore >= 50
        ? "border-warning-border bg-warning-bg"
        : "border-error-border bg-error-bg";

  const radarData = Object.entries(DIMENSION_LABELS).map(([key, dim]) => ({
    dim,
    score: result.dimensions[key] ?? 0,
  }));

  // Pair recommendations with lowest-scoring dimensions.
  const sortedDims = Object.entries(result.dimensions).sort(([, a], [, b]) => a - b);
  const perDimSuggestions = sortedDims.map(([key, score], i) => ({
    key,
    label: DIMENSION_LABELS[key] ?? key,
    score,
    hint: result.recommendations[i] ?? DIMENSION_HINTS[key] ?? "",
  }));

  return (
    <div className="rounded-xl border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-base font-semibold text-text">Grant DNA Score</h3>
        </div>
        {onReScore && (
          <button
            type="button"
            onClick={onReScore}
            disabled={scoring}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-surface text-primary px-3 py-1.5 text-xs font-medium transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${scoring ? "animate-spin" : ""}`} aria-hidden />
            {scoring ? "Scoring..." : "Re-score"}
          </button>
        )}
      </div>

      <div className="space-y-4 p-5">
        {/* Composite score + percentile */}
        <div className="flex items-center gap-4">
          <div
            className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border ${scoreBg}`}
          >
            <span className={`text-2xl font-bold leading-none ${scoreColor}`}>
              {displayScore}
            </span>
            <span className="mt-0.5 text-[10px] font-medium text-text-muted">/100</span>
          </div>
          <div className="min-w-0 flex-1">
            <Badge variant="info">
              Top {100 - result.percentile}% of funded proposals
            </Badge>
            <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
              {result.comparison}
            </p>
          </div>
        </div>

        {/* Radar chart */}
        <DNARadarChart data={radarData} />

        {/* Dimension mini-bars */}
        <div className="space-y-1.5">
          {Object.entries(DIMENSION_LABELS).map(([key, label]) => {
            const val = result.dimensions[key] ?? 0;
            const pct = val * 10;
            const barColor =
              pct >= 75 ? "bg-success-text" : pct >= 50 ? "bg-warning-text" : "bg-error-text";
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-text-muted">{label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right text-xs font-medium text-text">
                  {val.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Expandable improvement suggestions */}
        <div className="border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setShowSuggestions((p) => !p)}
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={showSuggestions}
          >
            <span className="text-sm font-medium text-text">
              Improvement suggestions
            </span>
            {showSuggestions ? (
              <ChevronUp className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            )}
          </button>

          {showSuggestions && (
            <div className="mt-3 space-y-2">
              {perDimSuggestions.slice(0, 5).map(({ key, label, score, hint }) => {
                const pct = score * 10;
                const dimColor =
                  pct >= 75
                    ? "border-success-border bg-success-bg"
                    : pct >= 50
                      ? "border-warning-border bg-warning-bg"
                      : "border-error-border bg-error-bg";
                const labelColor =
                  pct >= 75
                    ? "text-success-text"
                    : pct >= 50
                      ? "text-warning-text"
                      : "text-error-text";
                return (
                  <div
                    key={key}
                    className={`rounded-lg border p-3 ${dimColor}`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className={`text-xs font-semibold ${labelColor}`}>{label}</span>
                      <span className={`text-xs font-bold ${labelColor}`}>
                        {score.toFixed(1)}/10
                      </span>
                    </div>
                    {hint && (
                      <p className="text-xs leading-relaxed text-text-muted">{hint}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
