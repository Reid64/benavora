import Link from "next/link";
import { redirect } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Award,
  CalendarClock,
  DollarSign,
  FileText,
  Percent,
  Search,
  Send,
} from "lucide-react";
import { addDays, differenceInCalendarDays, format } from "date-fns";

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

const STAT_ACCENTS: Record<StatAccent, { bg: string; shadow: string }> = {
  blue: { bg: "#0077B6", shadow: "0 8px 24px rgba(0,119,182,0.3)" },
  cyan: { bg: "#00B4D8", shadow: "0 8px 24px rgba(0,180,216,0.3)" },
  violet: { bg: "#6B48CC", shadow: "0 8px 24px rgba(107,72,204,0.3)" },
  navy: { bg: "#1A2B3C", shadow: "0 8px 24px rgba(26,43,60,0.3)" },
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
  const { bg, shadow } = STAT_ACCENTS[accent];
  return (
    <div
      style={{
        backgroundColor: bg,
        borderRadius: "16px",
        padding: "24px",
        boxShadow: shadow,
        color: "#FFFFFF",
      }}
    >
      <div className="flex items-center justify-between">
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.8,
          }}
        >
          {label}
        </div>
        <Icon className="h-5 w-5" style={{ opacity: 0.7 }} aria-hidden />
      </div>
      <div
        style={{
          fontSize: "40px",
          fontWeight: 900,
          lineHeight: 1,
          marginTop: "12px",
        }}
      >
        {value}
      </div>
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
    <div className="min-h-screen" style={{ backgroundColor: "#D6E4F0", padding: "32px" }}>
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#0F172A", letterSpacing: "-0.02em" }}>
          Dashboard
        </h1>
        <p style={{ fontSize: "14px", color: "#64748B", marginTop: "4px" }}>
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
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            border: "1px solid #CBD5E1",
          }}
          labelClassName="text-[13px] font-semibold text-[#64748B]"
          valueClassName="mt-2 text-[32px] font-extrabold text-[#0F172A]"
          hintClassName="mt-2 text-xs text-[#6B7280]"
        />
        <MetricCard
          label="Total Awarded"
          value={metricCurrency(summary.totalAwarded)}
          icon={Award}
          hue="indigo"
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            border: "1px solid #CBD5E1",
          }}
          labelClassName="text-[13px] font-semibold text-[#64748B]"
          valueClassName="mt-2 text-[32px] font-extrabold text-[#0F172A]"
          hintClassName="mt-2 text-xs text-[#6B7280]"
        />
        <MetricCard
          label="Success Rate"
          value={successRateValue}
          icon={Percent}
          hue="emerald"
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: "16px",
            padding: "24px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            border: "1px solid #CBD5E1",
          }}
          labelClassName="text-[13px] font-semibold text-[#64748B]"
          valueClassName="mt-2 text-[32px] font-extrabold text-[#0F172A]"
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
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "16px",
          padding: "28px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          border: "1px solid #CBD5E1",
          marginTop: "24px",
          marginBottom: "32px",
        }}
      >
        <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginBottom: "16px" }}>
          Pipeline
        </h2>
        <PipelineSummary counts={pipelineCounts} />
      </div>

      {/* Two-column layout: left = activity, right = deadlines + actions */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_300px]">
        {/* -- Left column -- */}
        <div className="space-y-6">
          {/* Recent activity */}
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "16px",
              padding: "28px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              border: "1px solid #CBD5E1",
            }}
          >
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginBottom: "16px" }}>
              Recent Activity
            </h2>
            <RecentActivityFeed items={activityItems} />
          </div>
        </div>

        {/* -- Right column -- */}
        <div className="space-y-6">
          {/* Upcoming deadlines */}
          <div
            style={{
              backgroundColor: "#1A2B3C",
              borderRadius: "16px",
              padding: "0",
              overflow: "hidden",
              boxShadow: "0 4px 16px rgba(26,43,60,0.2)",
            }}
          >
            <div style={{ padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
              <div className="flex items-center justify-between">
                <h2
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#FFFFFF",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  Upcoming Deadlines
                </h2>
                <Link
                  href="/deadlines"
                  className="text-xs font-medium"
                  style={{ color: "#9CA3AF" }}
                >
                  View all
                </Link>
              </div>
            </div>
            <div style={{ padding: "8px 0" }}>
              <DeadlineWidget items={deadlineItems} dark />
            </div>
          </div>

          {/* Quick actions */}
          <div
            style={{
              backgroundColor: "#0077B6",
              borderRadius: "16px",
              padding: "24px",
              boxShadow: "0 4px 16px rgba(0,119,182,0.3)",
            }}
          >
            <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#FFFFFF", marginBottom: "16px" }}>
              Quick Actions
            </h3>
            <div>
              <Link
                href="/research"
                style={{
                  display: "block",
                  width: "100%",
                  padding: "12px 16px",
                  backgroundColor: "rgba(255,255,255,0.15)",
                  borderRadius: "8px",
                  color: "#FFFFFF",
                  fontSize: "13px",
                  fontWeight: 600,
                  marginBottom: "8px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                Run Research
              </Link>
              <Link
                href="/draft-generator"
                style={{
                  display: "block",
                  width: "100%",
                  padding: "12px 16px",
                  backgroundColor: "rgba(255,255,255,0.15)",
                  borderRadius: "8px",
                  color: "#FFFFFF",
                  fontSize: "13px",
                  fontWeight: 600,
                  marginBottom: "8px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                Generate Drafts
              </Link>
              <Link
                href="/draft-generator/queue"
                style={{
                  display: "block",
                  width: "100%",
                  padding: "12px 16px",
                  backgroundColor: "rgba(255,255,255,0.15)",
                  borderRadius: "8px",
                  color: "#FFFFFF",
                  fontSize: "13px",
                  fontWeight: 600,
                  marginBottom: "8px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                Review Queue
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
