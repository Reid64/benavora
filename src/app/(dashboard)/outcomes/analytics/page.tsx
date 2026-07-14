"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Lightbulb,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Badge, Button, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import { AnalyticsDashboard } from "@/components/outcomes/AnalyticsDashboard";
import { createClient } from "@/lib/supabase/client";
import {
  SUBSCRIPTION_TIERS,
  type SubscriptionTier,
} from "@/lib/utils/constants";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type {
  AgentRunRow,
  ApplicationRow,
  DeadlineRow,
  OpportunityRow,
  OutcomeRow,
} from "@/lib/analytics/dashboard";
import type { SuccessPatternAnalysis, SuccessPatternEntry } from "@/types/ai";

type DashboardData = {
  outcomes: OutcomeRow[];
  applications: ApplicationRow[];
  opportunities: OpportunityRow[];
  deadlines: DeadlineRow[];
  agentRuns: AgentRunRow[];
  subscriptionTier: SubscriptionTier;
};

type NarrativeRow = {
  id: string;
  funder_category: string | null;
  success_patterns: unknown;
  effectiveness_score: number | null;
  success_count: number | null;
  section_type: string | null;
  narrative_text: string;
  last_used_at: string | null;
};

/** One funder-category bucket of discovered language patterns. */
type CategoryPatterns = {
  funderCategory: string;
  analysis: SuccessPatternAnalysis;
};

const EMPTY: DashboardData = {
  outcomes: [],
  applications: [],
  opportunities: [],
  deadlines: [],
  agentRuns: [],
  subscriptionTier: "free",
};

function asTier(value: unknown): SubscriptionTier {
  return SUBSCRIPTION_TIERS.includes(value as SubscriptionTier)
    ? (value as SubscriptionTier)
    : "free";
}

/**
 * Outcomes & Analytics dashboard (BLUEPRINT §4.10). Fetches real, RLS-scoped
 * rows from the outcomes, applications, opportunities, deadlines, agent_runs,
 * and organizations tables, then renders the full charting dashboard. All
 * aggregation is client-side over fetched rows - no mocks, no server roundtrip.
 */
export default function OutcomeAnalyticsPage() {
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [patternGroups, setPatternGroups] = useState<CategoryPatterns[]>([]);
  const [topNarratives, setTopNarratives] = useState<NarrativeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [
      outcomesRes,
      appsRes,
      oppsRes,
      deadlinesRes,
      agentRunsRes,
      orgRes,
      narrativesRes,
    ] = await Promise.all([
      supabase
        .from("outcomes")
        .select(
          "result, awarded_amount, requested_amount, funder_category, opportunity_category, recorded_at, application_id",
        ),
      supabase
        .from("applications")
        .select(
          "id, stage, requested_amount, awarded_amount, created_at, submitted_at",
        ),
      supabase.from("opportunities").select("category, source_type, deadline"),
      supabase.from("deadlines").select("due_date, is_completed"),
      supabase
        .from("agent_runs")
        .select("agent_type, status, created_at, items_found"),
      supabase.from("organizations").select("subscription_tier"),
      // Load proven_narratives for both the top-narratives table and the
      // pattern insights panel. Order by effectiveness_score so the table
      // gets pre-sorted data.
      supabase
        .from("proven_narratives")
        .select(
          "id, funder_category, success_patterns, effectiveness_score, success_count, section_type, narrative_text, last_used_at",
        )
        .order("effectiveness_score", { ascending: false, nullsFirst: false })
        .limit(50),
    ]);

    // Outcomes + applications power most charts - treat their failure as fatal;
    // the rest degrade gracefully to empty datasets.
    if (outcomesRes.error || appsRes.error) {
      setError("Could not load analytics.");
      setLoading(false);
      return;
    }

    const orgRow = (orgRes.data ?? [])[0] as
      | { subscription_tier?: unknown }
      | undefined;

    setData({
      outcomes: (outcomesRes.data ?? []) as OutcomeRow[],
      applications: (appsRes.data ?? []) as ApplicationRow[],
      opportunities: (oppsRes.data ?? []) as OpportunityRow[],
      deadlines: (deadlinesRes.data ?? []) as DeadlineRow[],
      agentRuns: (agentRunsRes.data ?? []) as AgentRunRow[],
      subscriptionTier: asTier(orgRow?.subscription_tier),
    });

    const allNarratives = (narrativesRes.data ?? []) as NarrativeRow[];

    // Group success_patterns by funder_category - one analysis per category
    // (take the first row that has patterns for each category).
    const categoryMap = new Map<string, SuccessPatternAnalysis>();
    for (const row of allNarratives) {
      const category = row.funder_category;
      if (!category || categoryMap.has(category)) continue;
      const raw = row.success_patterns;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const analysis = raw as Partial<SuccessPatternAnalysis>;
      if (
        Array.isArray(analysis.winning_patterns) &&
        analysis.winning_patterns.length > 0
      ) {
        categoryMap.set(category, {
          winning_patterns: analysis.winning_patterns as SuccessPatternEntry[],
          losing_patterns: (analysis.losing_patterns ?? []) as SuccessPatternEntry[],
          recommendations: (analysis.recommendations ?? []) as string[],
        });
      }
    }
    setPatternGroups(
      Array.from(categoryMap.entries()).map(([funderCategory, analysis]) => ({
        funderCategory,
        analysis,
      })),
    );

    // Top performing narratives: those with a numeric effectiveness_score,
    // already sorted desc by the query.
    setTopNarratives(
      allNarratives.filter((n) => n.effectiveness_score !== null),
    );

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/outcomes"
          className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to outcomes
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-primary">
          Outcomes &amp; Analytics
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Pipeline funnel, success rates over time, dollar efficiency, source
          mix, deadline density, agent activity, ROI, and year-over-year trends
          - all from your real funding data.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading analytics..." />
      ) : (
        <>
          <AnalyticsDashboard
            outcomes={data.outcomes}
            applications={data.applications}
            opportunities={data.opportunities}
            deadlines={data.deadlines}
            agentRuns={data.agentRuns}
            subscriptionTier={data.subscriptionTier}
          />
          <TopNarrativesTable narratives={topNarratives} />
          <PatternInsightsSection groups={patternGroups} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top performing narratives table - ranked by effectiveness_score
// ---------------------------------------------------------------------------

function TopNarrativesTable({ narratives }: { narratives: NarrativeRow[] }) {
  if (narratives.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No scored narratives yet"
        description="Effectiveness scores are assigned after recording awarded outcomes. Awarded drafts are saved as proven narratives and scored based on how often they lead to funding."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-navy-900">
          Top performing narratives
        </h2>
        <p className="mt-1 text-sm text-navy-500">
          Proven narrative sections ranked by effectiveness score. Higher scores
          mean these narratives have been used more and led to funded outcomes.
        </p>
      </div>
      <Card noPadding>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sidebar">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-white">
                <th className="px-4 py-3 w-10">#</th>
                <th className="px-4 py-3">Narrative snippet</th>
                <th className="px-4 py-3 hidden sm:table-cell">Section</th>
                <th className="px-4 py-3 hidden md:table-cell">Category</th>
                <th className="px-4 py-3 text-right">Score</th>
                <th className="px-4 py-3 text-right hidden sm:table-cell">Uses</th>
                <th className="px-4 py-3 text-right hidden lg:table-cell">Last used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {narratives.slice(0, 20).map((n, i) => {
                const score = n.effectiveness_score ?? 0;
                const pct = Math.min(100, Math.max(0, score));
                const barColor =
                  pct >= 75
                    ? "bg-teal-400"
                    : pct >= 50
                      ? "bg-blue-400"
                      : pct >= 25
                        ? "bg-amber-400"
                        : "bg-red-400";
                return (
                  <tr key={n.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 text-navy-400 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="line-clamp-2 text-navy-700">
                        {n.narrative_text.slice(0, 160)}
                        {n.narrative_text.length > 160 ? "…" : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {n.section_type ? (
                        <Badge color="indigo">{humanizeEnum(n.section_type)}</Badge>
                      ) : (
                        <span className="text-navy-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-navy-500">
                      {n.funder_category ? humanizeEnum(n.funder_category) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="hidden sm:block w-16 h-1.5 rounded-full bg-white/10">
                          <div
                            className={`h-1.5 rounded-full ${barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="font-semibold tabular-nums text-navy-900">
                          {score}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell text-navy-500 tabular-nums">
                      {n.success_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell text-navy-400">
                      {n.last_used_at ? formatDate(n.last_used_at) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {narratives.length > 20 && (
          <p className="border-t border-navy-100 px-4 py-2 text-xs text-navy-400">
            Showing top 20 of {narratives.length} scored narratives.
          </p>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pattern insights - discovered language patterns grouped by funder category
// ---------------------------------------------------------------------------

function PatternInsightsSection({ groups }: { groups: CategoryPatterns[] }) {
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={Lightbulb}
        title="No language patterns discovered yet"
        description="Pattern analysis runs automatically when an awarded outcome is recorded. Awarded narratives are compared against denials to surface winning language patterns."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-navy-900">
          Discovered language patterns
        </h2>
        <p className="mt-1 text-sm text-navy-500">
          Winning and losing language patterns identified by the recursive learning
          system, grouped by funder category. Applied automatically when generating
          future drafts.
        </p>
      </div>
      {groups.map(({ funderCategory, analysis }) => (
        <Card
          key={funderCategory}
          title={humanizeEnum(funderCategory)}
          description={`${analysis.winning_patterns.length} winning pattern${analysis.winning_patterns.length === 1 ? "" : "s"} · ${analysis.recommendations.length} recommendation${analysis.recommendations.length === 1 ? "" : "s"}`}
        >
          <div className="space-y-5">
            {analysis.winning_patterns.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-green-700">
                  <TrendingUp className="h-4 w-4" aria-hidden />
                  Winning patterns
                </div>
                <ul className="space-y-2">
                  {analysis.winning_patterns.map((p, i) => (
                    <li key={i} className="rounded-lg border border-green-100 bg-green-50 p-3">
                      <p className="text-sm font-medium text-green-900">{p.description}</p>
                      {p.example && (
                        <p className="mt-1 text-xs italic text-green-700">
                          &ldquo;{p.example}&rdquo;
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.losing_patterns.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-red-700">
                  <TrendingDown className="h-4 w-4" aria-hidden />
                  Patterns to avoid
                </div>
                <ul className="space-y-2">
                  {analysis.losing_patterns.map((p, i) => (
                    <li key={i} className="rounded-lg border border-red-100 bg-red-50 p-3">
                      <p className="text-sm font-medium text-red-900">{p.description}</p>
                      {p.example && (
                        <p className="mt-1 text-xs italic text-red-700">
                          &ldquo;{p.example}&rdquo;
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.recommendations.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-navy-700">
                  <Lightbulb className="h-4 w-4" aria-hidden />
                  Recommendations
                </div>
                <ul className="space-y-1.5">
                  {analysis.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-navy-600">
                      <Badge color="indigo">{i + 1}</Badge>
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
