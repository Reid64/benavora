import { redirect } from "next/navigation";
import {
  Award,
  CalendarClock,
  DollarSign,
  FileText,
  Percent,
  Search,
  Send,
} from "lucide-react";
import { addDays, differenceInCalendarDays, format, isValid } from "date-fns";

import { Card } from "@/components/ui";
import { MetricCard } from "@/components/dashboard/MetricCard";
import {
  OpportunityFeed,
  type OpportunityFeedItem,
} from "@/components/dashboard/OpportunityFeed";
import {
  DeadlineWidget,
  type DeadlineWidgetItem,
} from "@/components/dashboard/DeadlineWidget";
import { PipelineSummary } from "@/components/dashboard/PipelineSummary";
import {
  SuccessRateChart,
  type SuccessRatePoint,
} from "@/components/dashboard/SuccessRateChart";
import type { PipelineStage } from "@/components/applications/pipeline";
import { createClient } from "@/lib/supabase/server";
import {
  analyzeOutcomes,
  type OutcomeInput,
} from "@/lib/ai/learning/outcome-analyzer";
import { MIN_OUTCOMES_FOR_RATE, PIPELINE_STAGES } from "@/lib/utils/constants";
import { formatCurrency } from "@/lib/utils/formatters";

// The dashboard reflects live, session-scoped data and must never be cached or
// statically rendered (CLAUDE.md: no cached dashboard HTML).
export const dynamic = "force-dynamic";

type OpportunityRow = {
  id: string;
  name: string;
  category: string;
  funder_id: string | null;
  deadline: string | null;
  discovered_at: string;
  amount_min: number | null;
  amount_max: number | null;
  amount_available: number | null;
};

type ApplicationRow = {
  id: string;
  stage: PipelineStage;
  requested_amount: number | null;
  submitted_at: string | null;
};

type DeadlineRow = {
  id: string;
  title: string;
  deadline_type: string;
  due_date: string;
  application_id: string | null;
  opportunity_id: string | null;
};

/** Best available request amount for an opportunity, formatted, or null. */
function amountLabel(opp: OpportunityRow): string | null {
  const amount = opp.amount_max ?? opp.amount_available ?? opp.amount_min;
  return amount != null ? formatCurrency(amount) : null;
}

/** Builds the trailing-12-month success-rate series (awarded / total). */
function buildSuccessSeries(
  outcomes: Pick<OutcomeInput, "result" | "recorded_at">[],
  now: Date,
): SuccessRatePoint[] {
  const byMonth = new Map<string, { awarded: number; total: number }>();
  for (const o of outcomes) {
    if (!o.recorded_at) continue;
    const date = new Date(o.recorded_at);
    if (!isValid(date)) continue;
    const key = format(date, "yyyy-MM");
    const bucket = byMonth.get(key) ?? { awarded: 0, total: 0 };
    bucket.total += 1;
    if (o.result === "awarded") bucket.awarded += 1;
    byMonth.set(key, bucket);
  }

  const series: SuccessRatePoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = format(date, "yyyy-MM");
    const bucket = byMonth.get(key);
    series.push({
      month: key,
      label: format(date, "MMM"),
      rate:
        bucket && bucket.total > 0
          ? Math.round((bucket.awarded / bucket.total) * 100)
          : null,
      total: bucket?.total ?? 0,
    });
  }
  return series;
}

/**
 * Main dashboard (BLUEPRINT §4.1). All data is read server-side via the
 * session-bound Supabase client; organization_id is derived from the
 * authenticated user's profile (never a request body) and used to scope every
 * query, with RLS as the second barrier. Empty states are handled per widget,
 * with a welcome banner when the organization has no data at all.
 */
export default async function DashboardPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  if (!profile?.organization_id) {
    // No resolvable organization — surface rather than guess (Contracts §1/§2).
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        We couldn&rsquo;t resolve your organization. Please sign in again.
      </div>
    );
  }

  const orgId = profile.organization_id;
  const now = new Date();
  const horizon = format(addDays(now, 7), "yyyy-MM-dd");

  const [
    oppCountRes,
    recentOppsRes,
    applicationsRes,
    deadlinesRes,
    fundersRes,
    outcomesRes,
  ] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("opportunities")
      .select(
        "id, name, category, funder_id, deadline, discovered_at, amount_min, amount_max, amount_available",
      )
      .eq("organization_id", orgId)
      .order("discovered_at", { ascending: false })
      .limit(10),
    supabase
      .from("applications")
      .select("id, stage, requested_amount, submitted_at")
      .eq("organization_id", orgId),
    supabase
      .from("deadlines")
      .select(
        "id, title, deadline_type, due_date, application_id, opportunity_id",
      )
      .eq("organization_id", orgId)
      .or("is_completed.is.null,is_completed.eq.false")
      .lte("due_date", horizon)
      .order("due_date", { ascending: true }),
    supabase.from("funders").select("id, name").eq("organization_id", orgId),
    supabase
      .from("outcomes")
      .select(
        "result, awarded_amount, requested_amount, funder_category, opportunity_category, denial_reason, recorded_at",
      )
      .eq("organization_id", orgId),
  ]);

  const totalOpportunities = oppCountRes.count ?? 0;
  const recentOpps = (recentOppsRes.data ?? []) as OpportunityRow[];
  const applications = (applicationsRes.data ?? []) as ApplicationRow[];
  const deadlines = (deadlinesRes.data ?? []) as DeadlineRow[];
  const outcomes = (outcomesRes.data ?? []) as OutcomeInput[];

  const funderNames = new Map<string, string>();
  for (const f of (fundersRes.data ?? []) as { id: string; name: string }[]) {
    funderNames.set(f.id, f.name);
  }

  // --- metrics ---------------------------------------------------------------
  const submittedCount = applications.filter(
    (a) => a.submitted_at !== null,
  ).length;
  const draftsPendingReview = applications.filter(
    (a) => a.stage === "ready_for_review",
  ).length;
  const totalRequested = applications.reduce(
    (sum, a) => sum + (a.requested_amount ?? 0),
    0,
  );

  const deadlinesThisWeek = deadlines.filter((d) => {
    const days = differenceInCalendarDays(new Date(d.due_date), now);
    return days >= 0 && days <= 7;
  }).length;

  const analysis = analyzeOutcomes(outcomes);
  const { summary } = analysis;
  const successRateValue =
    summary.successRate != null ? `${summary.successRate}%` : "—";

  // --- pipeline counts -------------------------------------------------------
  const pipelineCounts = PIPELINE_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = 0;
      return acc;
    },
    {} as Record<PipelineStage, number>,
  );
  for (const app of applications) {
    if (app.stage in pipelineCounts) {
      pipelineCounts[app.stage] += 1;
    }
  }

  // --- widget data -----------------------------------------------------------
  const feedItems: OpportunityFeedItem[] = recentOpps.map((opp) => ({
    id: opp.id,
    name: opp.name,
    category: opp.category,
    funderName: opp.funder_id
      ? (funderNames.get(opp.funder_id) ?? null)
      : null,
    amountLabel: amountLabel(opp),
    deadline: opp.deadline,
    discoveredAt: opp.discovered_at,
  }));

  const deadlineItems: DeadlineWidgetItem[] = deadlines
    .slice(0, 6)
    .map((d) => ({
      id: d.id,
      title: d.title,
      deadlineType: d.deadline_type,
      dueDate: d.due_date,
      href: d.application_id
        ? `/applications/${d.application_id}`
        : d.opportunity_id
          ? `/opportunities/${d.opportunity_id}`
          : "/deadlines",
    }));

  const successSeries = buildSuccessSeries(outcomes, now);

  const hasNoData =
    totalOpportunities === 0 &&
    applications.length === 0 &&
    deadlines.length === 0 &&
    outcomes.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Your funding pipeline at a glance.
        </p>
      </div>

      {hasNoData && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-5 py-4">
          <h2 className="text-sm font-semibold text-teal-900">
            Welcome to Benavora
          </h2>
          <p className="mt-1 text-sm text-teal-700">
            You don&rsquo;t have any data yet. Start by adding a funding
            opportunity or completing your organization profile in the Knowledge
            Base — the metrics and charts below fill in as you work.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total Opportunities"
          value={String(totalOpportunities)}
          icon={Search}
        />
        <MetricCard
          label="Applications Submitted"
          value={String(submittedCount)}
          icon={Send}
        />
        <MetricCard
          label="Drafts Pending Review"
          value={String(draftsPendingReview)}
          icon={FileText}
        />
        <MetricCard
          label="Deadlines This Week"
          value={String(deadlinesThisWeek)}
          icon={CalendarClock}
          trend={
            deadlinesThisWeek > 0
              ? { direction: "neutral", label: "Next 7 days" }
              : undefined
          }
        />
        <MetricCard
          label="Total Dollars Requested"
          value={formatCurrency(totalRequested)}
          icon={DollarSign}
        />
        <MetricCard
          label="Total Dollars Awarded"
          value={formatCurrency(summary.totalAwarded)}
          icon={Award}
        />
        <MetricCard
          label="Overall Success Rate"
          value={successRateValue}
          icon={Percent}
          hint={
            summary.successRate != null
              ? `${summary.awarded} awarded of ${summary.total}`
              : `Needs ${MIN_OUTCOMES_FOR_RATE}+ outcomes`
          }
        />
      </div>

      <Card title="Pipeline summary" description="Applications by stage.">
        <PipelineSummary counts={pipelineCounts} />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Recent opportunities"
          description="The last 10 opportunities discovered."
        >
          <OpportunityFeed items={feedItems} />
        </Card>
        <Card
          title="Upcoming deadlines"
          description="Due in the next 7 days (and anything overdue)."
        >
          <DeadlineWidget items={deadlineItems} />
        </Card>
      </div>

      <Card
        title="Success rate trend"
        description="Monthly grant success rate over the last 12 months."
      >
        <SuccessRateChart points={successSeries} />
      </Card>
    </div>
  );
}
