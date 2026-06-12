"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button, LoadingSpinner } from "@/components/ui";
import { AnalyticsDashboard } from "@/components/outcomes/AnalyticsDashboard";
import { createClient } from "@/lib/supabase/client";
import {
  SUBSCRIPTION_TIERS,
  type SubscriptionTier,
} from "@/lib/utils/constants";
import type {
  AgentRunRow,
  ApplicationRow,
  DeadlineRow,
  OpportunityRow,
  OutcomeRow,
} from "@/lib/analytics/dashboard";

type DashboardData = {
  outcomes: OutcomeRow[];
  applications: ApplicationRow[];
  opportunities: OpportunityRow[];
  deadlines: DeadlineRow[];
  agentRuns: AgentRunRow[];
  subscriptionTier: SubscriptionTier;
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
 * aggregation is client-side over fetched rows — no mocks, no server roundtrip.
 */
export default function OutcomeAnalyticsPage() {
  const [data, setData] = useState<DashboardData>(EMPTY);
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
    ]);

    // Outcomes + applications power most charts — treat their failure as fatal;
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
          — all from your real funding data.
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
        <AnalyticsDashboard
          outcomes={data.outcomes}
          applications={data.applications}
          opportunities={data.opportunities}
          deadlines={data.deadlines}
          agentRuns={data.agentRuns}
          subscriptionTier={data.subscriptionTier}
        />
      )}
    </div>
  );
}
