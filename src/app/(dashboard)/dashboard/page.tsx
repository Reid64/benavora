import Link from "next/link";
import { redirect } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Award,
  CalendarClock,
  ClipboardList,
  DollarSign,
  FileText,
  Percent,
  PenLine,
  Search,
  Send,
  Zap,
} from "lucide-react";
import { addDays, differenceInCalendarDays, format } from "date-fns";

import { cn } from "@/lib/utils/cn";
import { Card } from "@/components/ui";
import { FlightPathHUD } from "@/components/dashboard/FlightPathHUD";
import { MetricCard } from "@/components/dashboard/MetricCard";
import {
  DeadlineWidget,
  type DeadlineWidgetItem,
} from "@/components/dashboard/DeadlineWidget";
import { PipelineSummary } from "@/components/dashboard/PipelineSummary";
import {
  RecentActivityFeed,
  type RecentActivityItem,
} from "@/components/dashboard/RecentActivityFeed";
import type { PipelineStage } from "@/components/applications/pipeline";
import { createClient } from "@/lib/supabase/server";
import {
  analyzeOutcomes,
  type OutcomeInput,
} from "@/lib/ai/learning/outcome-analyzer";
import { MIN_OUTCOMES_FOR_RATE, PIPELINE_STAGES } from "@/lib/utils/constants";
import { formatCurrency } from "@/lib/utils/formatters";

// Dashboard reflects live session-scoped data; never cache (CLAUDE.md).
export const dynamic = "force-dynamic";

type ApplicationRow = {
  id: string;
  stage: PipelineStage;
  requested_amount: number | null;
  submitted_at: string | null;
  draft_content: string | null;
};

type DeadlineRow = {
  id: string;
  title: string;
  deadline_type: string;
  due_date: string;
  application_id: string | null;
  opportunity_id: string | null;
};

type AgentRunRow = {
  id: string;
  agent_type: string;
  status: string | null;
  output_summary: string | null;
  created_at: string;
};

/** Returns "â€”" instead of "0" so empty metrics don't imply active tracking. */
function metricCount(n: number): string {
  return n === 0 ? "â€”" : String(n);
}

function metricCurrency(n: number): string {
  return n === 0 ? "â€”" : formatCurrency(n);
}

type StatAccent = "blue" | "violet" | "amber" | "red";

const STAT_ACCENTS: Record<
  StatAccent,
  { bg: string; iconBg: string; iconText: string }
> = {
  blue: {
    bg: "bg-[#0077B6]",
    iconBg:
      "absolute top-4 right-4 w-10 h-10 rounded-lg flex items-center justify-center bg-white/10",
    iconText: "text-white/70",
  },
  violet: {
    bg: "bg-[#005F92]",
    iconBg:
      "absolute top-4 right-4 w-10 h-10 rounded-lg flex items-center justify-center bg-white/10",
    iconText: "text-white/70",
  },
  amber: {
    bg: "bg-[#00B4D8]",
    iconBg:
      "absolute top-4 right-4 w-10 h-10 rounded-lg flex items-center justify-center bg-white/10",
    iconText: "text-white/70",
  },
  red: {
    bg: "bg-[#023E8A]",
    iconBg:
      "absolute top-4 right-4 w-10 h-10 rounded-lg flex items-center justify-center bg-white/10",
    iconText: "text-white/70",
  },
};

/** One of the four primary dashboard stat tiles, accented by function (BLUEPRINT Â§4.1). */
function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  accent: StatAccent;
}) {
  const styles = STAT_ACCENTS[accent];
  return (
    <div
      className={cn(
        styles.bg,
        "rounded-xl shadow-md p-5 relative overflow-hidden",
      )}
    >
      <div className={styles.iconBg}>
        <Icon className={cn("h-5 w-5", styles.iconText)} aria-hidden />
      </div>
      <p className="text-white/70 text-xs font-semibold uppercase tracking-wide">
        {label}
      </p>
      <p className="text-white text-3xl font-bold mt-2">{value}</p>
    </div>
  );
}

/**
 * Main dashboard (BLUEPRINT Â§4.1). All data is read server-side via the
 * session-bound Supabase client; organization_id derived from the authenticated
 * user's profile (never from a request body), with RLS as the second barrier.
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
    applicationsRes,
    deadlinesRes,
    outcomesRes,
    agentRunsRes,
  ] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("applications")
      .select("id, stage, requested_amount, submitted_at, draft_content")
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
    supabase
      .from("outcomes")
      .select(
        "result, awarded_amount, requested_amount, funder_category, opportunity_category, denial_reason, recorded_at",
      )
      .eq("organization_id", orgId),
    supabase
      .from("agent_runs")
      .select("id, agent_type, status, output_summary, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const totalOpportunities = oppCountRes.count ?? 0;
  const applications = (applicationsRes.data ?? []) as ApplicationRow[];
  const deadlines = (deadlinesRes.data ?? []) as DeadlineRow[];
  const outcomes = (outcomesRes.data ?? []) as OutcomeInput[];
  const agentRuns = (agentRunsRes.data ?? []) as AgentRunRow[];

  // --- metrics ---------------------------------------------------------------
  const submittedCount = applications.filter(
    (a) => a.submitted_at !== null,
  ).length;
  const draftsGenerated = applications.filter(
    (a) => a.draft_content !== null && a.draft_content.trim().length > 0,
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
    summary.successRate != null ? `${summary.successRate}%` : "â€”";

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
  const deadlineItems: DeadlineWidgetItem[] = deadlines
    .slice(0, 5)
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

  const activityItems: RecentActivityItem[] = agentRuns.map((r) => ({
    id: r.id,
    agentType: r.agent_type,
    status: r.status,
    outputSummary: r.output_summary,
    createdAt: r.created_at,
  }));

  const hasNoData =
    totalOpportunities === 0 &&
    applications.length === 0 &&
    deadlines.length === 0 &&
    outcomes.length === 0;

  return (
    <div className="min-h-screen bg-[#C4D0DC] p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-primary">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">
          Your funding pipeline at a glance.
        </p>
      </div>

      {hasNoData && (
        <div className="mb-8 rounded-xl border border-teal-200 bg-teal-50 px-5 py-4">
          <h2 className="text-sm font-semibold text-teal-900">
            Welcome to Benavora
          </h2>
          <p className="mt-1 text-sm text-teal-700">
            You don&rsquo;t have any data yet. Start by adding a funding
            opportunity or completing your organization profile in the Knowledge
            Base &mdash; the metrics and charts below fill in as you work.
          </p>
        </div>
      )}

      {/* Mission Control lifecycle HUD */}
      <FlightPathHUD />

      {/* 4 primary stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
        <StatCard
          label="Total Opportunities"
          value={metricCount(totalOpportunities)}
          icon={Search}
          accent="blue"
        />
        <StatCard
          label="Applications Submitted"
          value={metricCount(submittedCount)}
          icon={Send}
          accent="violet"
        />
        <StatCard
          label="Drafts Generated"
          value={metricCount(draftsGenerated)}
          icon={FileText}
          accent="amber"
        />
        <StatCard
          label="Deadlines This Week"
          value={metricCount(deadlinesThisWeek)}
          icon={CalendarClock}
          accent="red"
        />
      </div>

      {/* 3 financial metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-8">
        <MetricCard
          label="Total Requested"
          value={metricCurrency(totalRequested)}
          icon={DollarSign}
          hue="emerald"
        />
        <MetricCard
          label="Total Awarded"
          value={metricCurrency(summary.totalAwarded)}
          icon={Award}
          hue="emerald"
        />
        <MetricCard
          label="Success Rate"
          value={successRateValue}
          icon={Percent}
          hue="violet"
          hint={
            summary.successRate != null
              ? `${summary.awarded} awarded of ${summary.total}`
              : `Needs ${MIN_OUTCOMES_FOR_RATE}+ outcomes`
          }
        />
      </div>

      {/* Pipeline */}
      <div className="bg-white rounded-xl shadow-sm border border-border p-6 mb-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Pipeline</h2>
        <PipelineSummary counts={pipelineCounts} />
      </div>

      {/* Two-column layout: left = activity, right = deadlines + actions */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_300px]">
        {/* â”€â”€ Left column â”€â”€ */}
        <div className="space-y-6">
          {/* Recent activity */}
          <div className="bg-white rounded-xl shadow-sm border border-border p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Recent Activity
            </h2>
            <RecentActivityFeed items={activityItems} />
          </div>
        </div>

        {/* â”€â”€ Right column â”€â”€ */}
        <div className="space-y-6">
          {/* Upcoming deadlines */}
          <div className="bg-white rounded-xl shadow-sm border border-border overflow-hidden">
            <div className="bg-slate-800 px-5 py-4 flex items-center justify-between">
              <span className="text-white font-semibold text-sm">
                Upcoming Deadlines
              </span>
              <Link
                href="/deadlines"
                className="text-xs font-medium text-slate-300 hover:text-white"
              >
                View all
              </Link>
            </div>
            <div className="p-5">
              <DeadlineWidget items={deadlineItems} />
            </div>
          </div>

          {/* Quick actions */}
          <Card className="border-l-4 border-l-cyan-500" title="Quick Actions">
            <div className="space-y-2">
              <Link
                href="/research"
                className="flex w-full items-center gap-3 rounded-lg border border-navy-100 px-4 py-3 text-sm font-medium text-navy-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
              >
                <Zap className="h-4 w-4 shrink-0 text-teal-500" aria-hidden />
                Run Research
              </Link>
              <Link
                href="/draft-generator"
                className="flex w-full items-center gap-3 rounded-lg border border-navy-100 px-4 py-3 text-sm font-medium text-navy-700 transition hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
              >
                <PenLine
                  className="h-4 w-4 shrink-0 text-primary"
                  aria-hidden
                />
                Generate Drafts
              </Link>
              <Link
                href="/draft-generator/queue"
                className="flex w-full items-center gap-3 rounded-lg border border-navy-100 px-4 py-3 text-sm font-medium text-navy-700 transition hover:border-success-text/30 hover:bg-success-bg hover:text-success-text"
              >
                <ClipboardList
                  className="h-4 w-4 shrink-0 text-success-text"
                  aria-hidden
                />
                Review Queue
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
