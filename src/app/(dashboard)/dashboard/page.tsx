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

/** Returns "-" instead of "0" so empty metrics don't imply active tracking. */
function metricCount(n: number): string {
  return n === 0 ? "-" : String(n);
}

function metricCurrency(n: number): string {
  return n === 0 ? "-" : formatCurrency(n);
}

type StatAccent = "blue" | "cyan" | "violet" | "navy";

// Restrained fintech treatment: every card is the same crisp white surface —
// color signals live only in the thin top bar and the small icon chip, not
// as a full-bleed background. Confidence comes from the number, not the tile.
const STAT_ACCENTS: Record<
  StatAccent,
  { topBar: string; chipBg: string; chipText: string }
> = {
  blue: { topBar: "bg-[#0077B6]", chipBg: "bg-[#EAF3FA]", chipText: "text-[#0077B6]" },
  cyan: { topBar: "bg-[#00B4D8]", chipBg: "bg-[#E6F8FC]", chipText: "text-[#0089A8]" },
  violet: { topBar: "bg-[#6B48CC]", chipBg: "bg-[#F1EDFB]", chipText: "text-[#6B48CC]" },
  navy: { topBar: "bg-[#1A2B3C]", chipBg: "bg-[#ECEEF1]", chipText: "text-[#1A2B3C]" },
};

/** One of the four primary dashboard stat tiles, accented by function (BLUEPRINT §4.1). */
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
      className="relative overflow-hidden rounded-lg border border-[#E5E7EB] p-5"
      style={{
        backgroundColor: "#FFFFFF",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
      }}
    >
      <span
        className={cn("absolute inset-x-0 top-0 h-[3px]", styles.topBar)}
        aria-hidden
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
          {label}
        </span>
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            styles.chipBg,
          )}
        >
          <Icon className={cn("h-4 w-4", styles.chipText)} aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-[32px] font-bold leading-none tracking-tight text-[#0A0E1A] tabular-nums">
        {value}
      </p>
    </div>
  );
}

/**
 * Main dashboard (BLUEPRINT §4.1). All data is read server-side via the
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
    summary.successRate != null ? `${summary.successRate}%` : "-";

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
    <div
      className="min-h-screen p-6"
      style={{ backgroundColor: "#F7F8FA" }}
    >
      <div className="mb-8">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
          Overview
        </p>
        <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight text-[#0A0E1A]">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
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
          accent="cyan"
        />
        <StatCard
          label="Drafts Generated"
          value={metricCount(draftsGenerated)}
          icon={FileText}
          accent="violet"
        />
        <StatCard
          label="Deadlines This Week"
          value={metricCount(deadlinesThisWeek)}
          icon={CalendarClock}
          accent="navy"
        />
      </div>

      {/* 3 financial metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 mb-8">
        <MetricCard
          label="Total Requested"
          value={metricCurrency(totalRequested)}
          icon={DollarSign}
          hue="blue"
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E5E7EB",
            boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
          }}
          labelClassName="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]"
          valueClassName="mt-3 text-[26px] font-bold leading-none tracking-tight text-[#0A0E1A] tabular-nums"
          hintClassName="mt-2 text-xs text-[#6B7280]"
        />
        <MetricCard
          label="Total Awarded"
          value={metricCurrency(summary.totalAwarded)}
          icon={Award}
          hue="indigo"
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E5E7EB",
            boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
          }}
          labelClassName="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]"
          valueClassName="mt-3 text-[26px] font-bold leading-none tracking-tight text-[#0A0E1A] tabular-nums"
          hintClassName="mt-2 text-xs text-[#6B7280]"
        />
        <MetricCard
          label="Success Rate"
          value={successRateValue}
          icon={Percent}
          hue="emerald"
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E5E7EB",
            boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
          }}
          labelClassName="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]"
          valueClassName="mt-3 text-[26px] font-bold leading-none tracking-tight text-[#0A0E1A] tabular-nums"
          hintClassName="mt-2 text-xs text-[#6B7280]"
          hint={
            summary.successRate != null
              ? `${summary.awarded} awarded of ${summary.total}`
              : `Needs ${MIN_OUTCOMES_FOR_RATE}+ outcomes`
          }
        />
      </div>

      {/* Pipeline */}
      <div
        className="rounded-lg p-6 mb-8"
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E5E7EB",
          boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
        }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
          Pipeline
        </p>
        <h2 className="text-lg font-bold tracking-tight text-[#0A0E1A] mb-4">
          Applications by stage
        </h2>
        <PipelineSummary counts={pipelineCounts} />
      </div>

      {/* Two-column layout: left = activity, right = deadlines + actions */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_300px]">
        {/* -- Left column -- */}
        <div className="space-y-6">
          {/* Recent activity */}
          <div
            className="rounded-lg p-6"
            style={{
              backgroundColor: "#FFFFFF",
              border: "1px solid #E5E7EB",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
              Activity
            </p>
            <h2 className="text-lg font-bold tracking-tight text-[#0A0E1A] mb-4">
              Recent Activity
            </h2>
            <RecentActivityFeed items={activityItems} />
          </div>
        </div>

        {/* -- Right column -- */}
        <div className="space-y-6">
          {/* Upcoming deadlines */}
          <div
            className="rounded-lg overflow-hidden"
            style={{
              backgroundColor: "#FFFFFF",
              border: "1px solid #E5E7EB",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            }}
          >
            <div className="bg-[#0A0E1A] px-5 py-4 flex items-center justify-between">
              <span className="text-white font-semibold text-sm">
                Upcoming Deadlines
              </span>
              <Link
                href="/deadlines"
                className="text-xs font-medium text-[#9CA3AF] hover:text-white"
              >
                View all
              </Link>
            </div>
            <div className="p-5">
              <DeadlineWidget items={deadlineItems} />
            </div>
          </div>

          {/* Quick actions */}
          <div
            className="rounded-lg p-5"
            style={{
              backgroundColor: "#FFFFFF",
              border: "1px solid #E5E7EB",
              boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] mb-3">
              Quick Actions
            </p>
            <div className="space-y-2">
              <Link
                href="/research"
                className="flex w-full items-center gap-3 rounded-md border border-[#E5E7EB] px-4 py-3 text-sm font-medium text-[#1F2937] transition hover:border-[#00B4D8] hover:bg-[#E6F8FC]"
              >
                <Zap className="h-4 w-4 shrink-0 text-[#00B4D8]" aria-hidden />
                Run Research
              </Link>
              <Link
                href="/draft-generator"
                className="flex w-full items-center gap-3 rounded-md border border-[#E5E7EB] px-4 py-3 text-sm font-medium text-[#1F2937] transition hover:border-[#0077B6] hover:bg-[#EAF3FA]"
              >
                <PenLine className="h-4 w-4 shrink-0 text-[#0077B6]" aria-hidden />
                Generate Drafts
              </Link>
              <Link
                href="/draft-generator/queue"
                className="flex w-full items-center gap-3 rounded-md border border-[#E5E7EB] px-4 py-3 text-sm font-medium text-[#1F2937] transition hover:border-[#10B981] hover:bg-[#ECFDF5]"
              >
                <ClipboardList className="h-4 w-4 shrink-0 text-[#10B981]" aria-hidden />
                Review Queue
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
