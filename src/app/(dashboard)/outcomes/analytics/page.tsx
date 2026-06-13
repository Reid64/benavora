"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lightbulb, TrendingUp, TrendingDown } from "lucide-react";

import { Badge, Button, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import { AnalyticsDashboard } from "@/components/outcomes/AnalyticsDashboard";
import { createClient } from "@/lib/supabase/client";
import {
  SUBSCRIPTION_TIERS,
  type SubscriptionTier,
} from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
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
      // Load proven_narratives with success_patterns for the pattern panel.
      supabase
        .from("proven_narratives")
        .select("funder_category, success_patterns")
        .not("success_patterns", "is", null),
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

    // Group success_patterns by funder_category - one analysis per category
    // (take the first row that has patterns for each category).
    const categoryMap = new Map<string, SuccessPatternAnalysis>();
    for (const row of narrativesRes.data ?? []) {
      const category = row.funder_category as string | null;
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
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900">
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
        <LoadingSpinner center label="Loading analytics…" />
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
          <PatternInsightsSection groups={patternGroups} />
        </>
      )}
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
