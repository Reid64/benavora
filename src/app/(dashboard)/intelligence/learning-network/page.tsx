"use client";

// Platform Learning Network (AUTONOMOUS_PLATFORM_VISION.md Phase 4 "Global
// Learning Network", AGENTS_v2.md AG-36). Reads GET
// /api/intelligence/learning-network — never queries platform_learning_patterns
// or org_learning_contributions directly from the client, since neither
// table carries an RLS policy (migration 083's own comments: "RLS disabled
// intentionally"). The route resolves organizationId server-side from the
// session before touching either table.

import { useEffect, useState } from "react";
import { Network, Sparkles } from "lucide-react";

import { Badge, EmptyState, LoadingSpinner } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";

interface LearningNetworkStats {
  totalPatterns: number;
  patternsAppliedToYourDrafts: number;
  yourContributions: number;
  networkEffectScore: number;
}

interface PatternRow {
  id: string;
  pattern_type: string;
  funder_category: string | null;
  ntee_code: string | null;
  success_rate: number | null;
  sample_count: number;
  last_updated: string;
}

const PATTERN_TYPE_BADGE_COLOR: Record<string, BadgeColor> = {
  narrative_language: "blue",
  budget_structure: "purple",
  keyword: "teal",
  timing: "orange",
  attachment_type: "gray",
  funder_preference: "green",
  ntee_success: "pink",
};

function patternTypeLabel(patternType: string): string {
  return patternType.replace(/_/g, " ");
}

function successRateColor(rate: number): string {
  if (rate >= 0.7) return "#15803D";
  if (rate >= 0.4) return "#B45309";
  return "#64748B";
}

interface StatCardProps {
  label: string;
  value: string;
  accent: string;
}

function StatCard({ label, value, accent }: StatCardProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="h-1.5" style={{ backgroundColor: accent }} aria-hidden />
      <div className="p-5">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-3xl font-black text-slate-900">{value}</p>
      </div>
    </div>
  );
}

export default function LearningNetworkPage() {
  const [stats, setStats] = useState<LearningNetworkStats | null>(null);
  const [patterns, setPatterns] = useState<PatternRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/intelligence/learning-network");
        const payload = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setError(
            (payload as { error?: string }).error ??
              "Could not load the platform learning network.",
          );
          return;
        }
        setStats((payload as { stats?: LearningNetworkStats }).stats ?? null);
        setPatterns((payload as { patterns?: PatternRow[] }).patterns ?? []);
      } catch {
        if (active) setError("Could not reach the learning network service.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const showEmpty = !loading && !error && patterns.length === 0;

  return (
    <div className="min-h-screen space-y-6 bg-[#EEF2F7] p-6 page-bg">
      <PageHeader
        title="Platform Learning Network"
        description="Anonymized intelligence from successful grants across the platform."
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading the platform learning network..." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Patterns"
              value={(stats?.totalPatterns ?? 0).toLocaleString()}
              accent="#3D6B50"
            />
            <StatCard
              label="Patterns Applied to Your Drafts"
              value={(stats?.patternsAppliedToYourDrafts ?? 0).toLocaleString()}
              accent="#6B48CC"
            />
            <StatCard
              label="Your Contributions"
              value={(stats?.yourContributions ?? 0).toLocaleString()}
              accent="#C49A4F"
            />
            <StatCard
              label="Network Effect Score"
              value={`${stats?.networkEffectScore ?? 0}/100`}
              accent="#4C3D8F"
            />
          </div>

          {showEmpty ? (
            <EmptyState
              icon={Network}
              title="No platform patterns yet"
              description="Patterns appear here once the Learning Network Aggregator has anonymized enough awarded outcomes across the platform."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
              <div className="flex items-center gap-2 border-b border-border px-5 py-4">
                <Sparkles className="h-4 w-4 text-[#3D6B50]" aria-hidden />
                <h2 className="text-base font-semibold text-slate-900">
                  Cross-Org Patterns
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs font-bold uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-3">Pattern Type</th>
                      <th className="px-5 py-3">Funder Category</th>
                      <th className="px-5 py-3">NTEE Code</th>
                      <th className="px-5 py-3">Success Rate</th>
                      <th className="px-5 py-3">Sample Count</th>
                      <th className="px-5 py-3">Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patterns.map((pattern) => {
                      const rate = pattern.success_rate ?? 0;
                      const ratePercent = Math.round(rate * 100);
                      return (
                        <tr key={pattern.id} className="border-b border-border last:border-0">
                          <td className="px-5 py-3">
                            <Badge
                              color={PATTERN_TYPE_BADGE_COLOR[pattern.pattern_type] ?? "gray"}
                            >
                              {patternTypeLabel(pattern.pattern_type)}
                            </Badge>
                          </td>
                          <td className="px-5 py-3 text-slate-700">
                            {pattern.funder_category
                              ? pattern.funder_category.replace(/_/g, " ")
                              : "All categories"}
                          </td>
                          <td className="px-5 py-3 text-slate-700">
                            {pattern.ntee_code ?? "—"}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[#F1F5F9]">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${ratePercent}%`,
                                    backgroundColor: successRateColor(rate),
                                  }}
                                />
                              </div>
                              <span className="text-xs font-semibold text-slate-600">
                                {ratePercent}%
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-slate-700">{pattern.sample_count}</td>
                          <td className="px-5 py-3 text-slate-500">
                            {new Date(pattern.last_updated).toLocaleDateString("en-US", {
                              dateStyle: "medium",
                            })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
