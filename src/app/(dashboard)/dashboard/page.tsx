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

  const statCards: Array<{ label: string; value: string; icon: LucideIcon; accent: string }> = [
    { label: "Total Opportunities", value: metricCount(totalOpportunities), icon: Search, accent: "#0077B6" },
    { label: "Applications Submitted", value: metricCount(submittedCount), icon: Send, accent: "#0096C7" },
    { label: "Drafts Generated", value: metricCount(draftsGenerated), icon: FileText, accent: "#6B48CC" },
    { label: "Deadlines This Week", value: metricCount(deadlinesThisWeek), icon: CalendarClock, accent: "#1A2B3C" },
  ];

  const metricCards: Array<{
    label: string;
    value: string;
    icon: LucideIcon;
    accent: string;
    hint?: string;
  }> = [
    { label: "Total Requested", value: metricCurrency(totalRequested), icon: DollarSign, accent: "#0077B6" },
    { label: "Total Awarded", value: metricCurrency(summary.totalAwarded), icon: Award, accent: "#00B4D8" },
    {
      label: "Success Rate",
      value: successRateValue,
      icon: Percent,
      accent: "#4C3D8F",
      hint:
        summary.successRate != null
          ? `${summary.awarded} awarded of ${summary.total}`
          : `Needs ${MIN_OUTCOMES_FOR_RATE}+ outcomes`,
    },
  ];

  const fundingSummaryRows = [
    { label: "Total Requested", value: metricCurrency(totalRequested) },
    { label: "Total Awarded", value: metricCurrency(summary.totalAwarded) },
    { label: "Success Rate", value: successRateValue },
  ];

  return (
    <div style={{ backgroundColor: "#C8D4DC", minHeight: "100vh", padding: "32px" }}>
      {/* Hero banner */}
      <div
        style={{
          background: "linear-gradient(135deg, #1A2B3C 0%, #0077B6 100%)",
          borderRadius: "20px",
          padding: "32px 40px",
          marginBottom: "28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "0 8px 32px rgba(0,0,0,0.20)",
        }}
      >
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#FFFFFF", letterSpacing: "-0.02em", margin: 0 }}>
            Your Funding Command Center
          </h1>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.65)", marginTop: "6px" }}>
            Faith Foundation &middot; {format(now, "MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex gap-3">
          <div
            style={{
              backgroundColor: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "999px",
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
              color: "#FFFFFF",
            }}
          >
            {totalOpportunities} Active Opportunities
          </div>
          <div
            style={{
              backgroundColor: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "999px",
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
              color: "#FFFFFF",
            }}
          >
            {deadlinesThisWeek} Deadlines This Week
          </div>
        </div>
      </div>

      {hasNoData && (
        <div className="mb-7 rounded-xl border border-teal-200 bg-teal-50 px-5 py-4">
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

      {/* Two-column layout */}
      <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", marginTop: "24px" }}>
        {/* -- Left column -- */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Stat cards tray */}
          <div
            style={{
              backgroundColor: "#B8C4CC",
              borderRadius: "20px",
              padding: "20px",
              boxShadow: "inset 0 2px 8px rgba(0,0,0,0.12)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
              {statCards.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.label}
                    style={{
                      borderRadius: "16px",
                      overflow: "hidden",
                      boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                      backgroundColor: "#FFFFFF",
                    }}
                  >
                    <div style={{ height: "8px", backgroundColor: card.accent }} />
                    <div style={{ padding: "24px" }}>
                      <div className="flex items-center justify-between">
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "#64748B",
                          }}
                        >
                          {card.label}
                        </div>
                        <Icon className="h-5 w-5" style={{ color: card.accent }} aria-hidden />
                      </div>
                      <div
                        style={{
                          fontSize: "40px",
                          fontWeight: 900,
                          color: "#0F172A",
                          lineHeight: 1,
                          marginTop: "12px",
                        }}
                      >
                        {card.value}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Metric cards tray */}
          <div
            style={{
              backgroundColor: "#B8C4CC",
              borderRadius: "20px",
              padding: "20px",
              boxShadow: "inset 0 2px 8px rgba(0,0,0,0.12)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
              {metricCards.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.label}
                    style={{
                      borderRadius: "16px",
                      overflow: "hidden",
                      boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
                      backgroundColor: "#FFFFFF",
                    }}
                  >
                    <div style={{ height: "8px", backgroundColor: card.accent }} />
                    <div style={{ padding: "24px" }}>
                      <div className="flex items-center justify-between">
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "#64748B",
                          }}
                        >
                          {card.label}
                        </div>
                        <Icon className="h-5 w-5" style={{ color: card.accent }} aria-hidden />
                      </div>
                      <div
                        style={{
                          fontSize: "40px",
                          fontWeight: 900,
                          color: "#0F172A",
                          lineHeight: 1,
                          marginTop: "12px",
                        }}
                      >
                        {card.value}
                      </div>
                      {card.hint && (
                        <p style={{ marginTop: "8px", fontSize: "12px", color: "#6B7280" }}>
                          {card.hint}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pipeline tray */}
          <div
            style={{
              backgroundColor: "#B8C4CC",
              borderRadius: "20px",
              padding: "20px",
              boxShadow: "inset 0 2px 8px rgba(0,0,0,0.12)",
            }}
          >
            <div
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: "16px",
                padding: "28px",
                boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
              }}
            >
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginBottom: "16px" }}>
                Pipeline
              </h2>
              <PipelineSummary counts={pipelineCounts} />
            </div>
          </div>

          {/* Recent activity tray */}
          <div
            style={{
              backgroundColor: "#B8C4CC",
              borderRadius: "20px",
              padding: "20px",
              boxShadow: "inset 0 2px 8px rgba(0,0,0,0.12)",
            }}
          >
            <div
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: "16px",
                padding: "28px",
                boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
              }}
            >
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginBottom: "16px" }}>
                Recent Activity
              </h2>
              <RecentActivityFeed items={activityItems} />
            </div>
          </div>
        </div>

        {/* -- Right column -- */}
        <div style={{ width: "320px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Funding summary chip card */}
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "16px",
              padding: "20px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
              borderLeft: "4px solid #00B4D8",
            }}
          >
            {fundingSummaryRows.map((row, i) => (
              <div
                key={row.label}
                style={{
                  paddingTop: i === 0 ? 0 : "10px",
                  paddingBottom: i === fundingSummaryRows.length - 1 ? 0 : "10px",
                  borderBottom: i === fundingSummaryRows.length - 1 ? "none" : "1px solid #F1F5F9",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "#64748B",
                  }}
                >
                  {row.label}
                </div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#0F172A", marginTop: "4px" }}>
                  {row.value}
                </div>
              </div>
            ))}
          </div>

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
                  style={{ color: "#FFFFFF" }}
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

// redeploy 07/16/2026 18:25:17
