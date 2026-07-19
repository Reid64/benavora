import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import { Sparkles } from "lucide-react";

import { FlightPathHUD } from "@/components/dashboard/FlightPathHUD";
import {
  DeadlineWidget,
  type DeadlineWidgetItem,
} from "@/components/dashboard/DeadlineWidget";
import { PipelineSummary } from "@/components/dashboard/PipelineSummary";
import type { PipelineStage } from "@/components/applications/pipeline";
import { createClient } from "@/lib/supabase/server";
import {
  analyzeOutcomes,
  type OutcomeInput,
} from "@/lib/ai/learning/outcome-analyzer";
import { PIPELINE_STAGES } from "@/lib/utils/constants";
import { formatCurrency, formatRelative, humanizeEnum } from "@/lib/utils/formatters";

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

type UpcomingOpportunityRow = {
  id: string;
  name: string;
  deadline: string;
};

// strategic_recommendations (migration 086_strategic_advisor.sql) is
// org_id-scoped, not organization_id — see AG-40 Strategic Advisor.
type StrategicRecommendationUrgencyRow = {
  urgency: "immediate" | "urgent" | "normal" | "low";
};

const URGENCY_COLOR: Record<string, string> = {
  immediate: "#DC2626",
  urgent: "#F59E0B",
  normal: "#0EA5E9",
  low: "#6B7280",
};

// agent_decisions.agent_id (migration 080) — real ids are suffixed forms
// of each agent's short number (see e.g. draft-generation-agent.ts's
// "ag-05-draft", opportunity-discovery-agent.ts's "ag-17-discovery"), so
// this matches by prefix rather than exact string.
type AgentDecisionRow = {
  id: string;
  agent_id: string;
  decision_type: string;
  reasoning: string;
  confidence_score: number | null;
  action_taken: string;
  created_at: string;
};

/** Returns "-" instead of "0" so empty metrics don't imply active tracking. */
function metricCount(n: number): string {
  return n === 0 ? "-" : String(n);
}

function metricCurrency(n: number): string {
  return n === 0 ? "-" : formatCurrency(n);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function decisionDotColor(agentId: string): string {
  if (agentId.startsWith("ag-17")) return "#06B6D4";
  if (agentId.startsWith("ag-15")) return "#0EA5E9";
  if (agentId.startsWith("ag-05")) return "#8B5CF6";
  if (agentId.startsWith("ag-18")) return "#F59E0B";
  if (agentId.startsWith("ag-19")) return "#10B981";
  return "#6B7280";
}

function confidenceBadgeColor(score: number | null): string {
  if (score == null) return "#6B7280";
  if (score >= 70) return "#10B981";
  if (score >= 50) return "#F59E0B";
  return "#EF4444";
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
    discoveryMatchesRes,
    reputationAlertsRes,
    upcomingOpportunitiesRes,
    agentDecisionsRes,
    strategicRecommendationsRes,
    organizationRes,
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
      .from("discovery_matches")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "pending"),
    supabase
      .from("reputation_alerts")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "unread"),
    supabase
      .from("opportunities")
      .select("id, name, deadline")
      .eq("organization_id", orgId)
      .not("deadline", "is", null)
      .gte("deadline", format(now, "yyyy-MM-dd"))
      .order("deadline", { ascending: true })
      .limit(3),
    supabase
      .from("agent_decisions")
      .select(
        "id, agent_id, decision_type, reasoning, confidence_score, action_taken, created_at",
      )
      .eq("org_id", orgId)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("strategic_recommendations")
      .select("urgency")
      .eq("org_id", orgId)
      .eq("status", "pending"),
    supabase.from("organizations").select("name").eq("id", orgId).single(),
  ]);

  const totalOpportunities = oppCountRes.count ?? 0;
  const applications = (applicationsRes.data ?? []) as ApplicationRow[];
  const deadlines = (deadlinesRes.data ?? []) as DeadlineRow[];
  const outcomes = (outcomesRes.data ?? []) as OutcomeInput[];
  const discoveryMatchesCount = discoveryMatchesRes.count ?? 0;
  const reputationAlertsCount = reputationAlertsRes.count ?? 0;
  const upcomingOpportunities = (upcomingOpportunitiesRes.data ??
    []) as UpcomingOpportunityRow[];
  const agentDecisions = (agentDecisionsRes.data ?? []) as AgentDecisionRow[];
  const strategicRecommendations = (strategicRecommendationsRes.data ??
    []) as StrategicRecommendationUrgencyRow[];
  const orgName =
    (organizationRes.data as { name: string } | null)?.name ??
    "Your Organization";

  const strategicUrgencyCounts = strategicRecommendations.reduce(
    (acc, r) => {
      acc[r.urgency] = (acc[r.urgency] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

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

  const hasNoData =
    totalOpportunities === 0 &&
    applications.length === 0 &&
    deadlines.length === 0 &&
    outcomes.length === 0;

  const heroChips = [
    { label: "Active Apps", value: metricCount(applications.length) },
    { label: "Submitted", value: metricCount(submittedCount) },
    { label: "Drafts", value: metricCount(draftsGenerated) },
    { label: "Deadlines", value: metricCount(deadlinesThisWeek) },
  ];

  const actionItems = [
    { dot: "#EF4444", text: "Parsed emails awaiting review", count: "-", href: "/emails" },
    { dot: "#F59E0B", text: "New opportunities discovered", count: metricCount(discoveryMatchesCount), href: "/opportunities" },
    { dot: "#6B48CC", text: "Drafts needing attention", count: metricCount(draftsGenerated), href: "/draft-generator" },
    { dot: "#0077B6", text: "Deadlines approaching", count: metricCount(deadlinesThisWeek), href: "/deadlines" },
    { dot: "#0096C7", text: "Applications missing documents", count: "-", href: "/applications" },
    { dot: "#10B981", text: "AutoApply gates awaiting approval", count: "-", href: "/admin/autoapply-ops" },
    { dot: "#1A2B3C", text: "Research runs completed", count: metricCount(submittedCount), href: "/research" },
    { dot: "#0EA5E9", text: "Funder alerts requiring review", count: metricCount(reputationAlertsCount), href: "/alerts" },
  ];

  const fundingSummaryRows = [
    { label: "Total Requested", value: metricCurrency(totalRequested) },
    { label: "Total Awarded", value: metricCurrency(summary.totalAwarded) },
    { label: "Success Rate", value: successRateValue },
  ];

  const sectionHeaderStyle = {
    fontSize: "13px",
    fontWeight: 700,
    color: "#0F172A",
    marginBottom: "16px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  };

  const trayStyle = {
    backgroundColor: "#B8C4CC",
    borderRadius: "16px",
    padding: "16px",
    boxShadow: "inset 0 2px 8px rgba(0,0,0,0.10)",
  };

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh", padding: "32px" }}>
      {/* Hero banner */}
      <div
        style={{
          background: "linear-gradient(135deg, #1A2B3C 0%, #0077B6 100%)",
          borderRadius: "20px",
          padding: "0",
          marginBottom: "20px",
          display: "flex",
          alignItems: "stretch",
          overflow: "hidden",
          height: "200px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.20)",
          position: "relative",
        }}
      >
        <div style={{ width: "260px", flexShrink: 0, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 0 0 16px" }}>
          <Image
            src="/hero-illustration.png"
            alt="Funding manager"
            width={240}
            height={190}
            style={{ objectFit: "contain", objectPosition: "bottom center" }}
          />
        </div>
        <div style={{ flex: 1, padding: "32px 40px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#FFFFFF", letterSpacing: "-0.02em", margin: "0 0 4px 0" }}>
            {orgName}
          </h1>
          <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.65)", margin: "0 0 20px 0" }}>
            {format(now, "MMMM d, yyyy")}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", maxWidth: "360px" }}>
            {heroChips.map((chip) => (
              <div
                key={chip.label}
                style={{
                  backgroundColor: "rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                }}
              >
                <div
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  {chip.label}
                </div>
                <div style={{ fontSize: "20px", fontWeight: 900, color: "#FFFFFF", lineHeight: 1, marginTop: "2px" }}>
                  {chip.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {hasNoData && (
        <div
          style={{
            backgroundColor: "#F0FDFA",
            border: "1px solid #99F6E4",
            borderRadius: "12px",
            padding: "16px 20px",
            marginBottom: "20px",
          }}
        >
          <h2 style={{ fontSize: "14px", fontWeight: 600, color: "#134E4A", margin: 0 }}>
            Welcome to Benavora
          </h2>
          <p style={{ fontSize: "14px", color: "#0F766E", marginTop: "4px" }}>
            You don&rsquo;t have any data yet. Start by adding a funding
            opportunity or completing your organization profile in the Knowledge
            Base &mdash; the metrics and charts below fill in as you work.
          </p>
        </div>
      )}

      {/* Mission Control lifecycle HUD */}
      <FlightPathHUD />

      {/* Three column grid: action items | pipeline | upcoming deadlines */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "16px" }}>
        {/* Today's Action Items */}
        <div style={trayStyle}>
          <div style={{ backgroundColor: "#FFFFFF", borderRadius: "12px", overflow: "hidden", padding: "20px", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: "#FFFFFF",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                backgroundColor: "#6B48CC",
                padding: "14px 20px",
                margin: "0",
              }}
            >
              Today&rsquo;s Action Items
            </div>
            {actionItems.map((item) => (
              <Link key={item.text} href={item.href} style={{ textDecoration: "none", display: "block" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 0",
                    borderBottom: "1px solid #F1F5F9",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, backgroundColor: item.dot }} />
                  <div style={{ flex: 1, fontSize: "13px", color: "#334155" }}>{item.text}</div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#FFFFFF",
                      backgroundColor: item.dot,
                      borderRadius: "999px",
                      padding: "2px 8px",
                    }}
                  >
                    {item.count}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Pipeline (compact) */}
        <div style={trayStyle}>
          <div style={{ backgroundColor: "#FFFFFF", borderRadius: "12px", padding: "20px", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
            <div style={sectionHeaderStyle}>Pipeline</div>
            <PipelineSummary counts={pipelineCounts} />

            <div style={{ marginTop: "16px" }}>
              <div style={sectionHeaderStyle}>Upcoming Opportunities</div>
              {upcomingOpportunities.length === 0 ? (
                <p style={{ fontSize: "13px", color: "#64748B" }}>
                  No open opportunities — run Research to discover funding.
                </p>
              ) : (
                upcomingOpportunities.map((opp) => {
                  const daysOut = differenceInCalendarDays(
                    new Date(opp.deadline),
                    now,
                  );
                  const deadlineColor =
                    daysOut <= 14
                      ? "#EF4444"
                      : daysOut <= 30
                        ? "#F59E0B"
                        : "#64748B";
                  return (
                    <div
                      key={opp.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "12px",
                        padding: "8px 0",
                        borderBottom: "1px solid #F1F5F9",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: "13px",
                            color: "#334155",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {truncate(opp.name, 40)}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: deadlineColor,
                          }}
                        >
                          {format(new Date(opp.deadline), "MMM d")}
                        </div>
                      </div>
                      <Link
                        href={`/opportunities/${opp.id}`}
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#0077B6",
                          flexShrink: 0,
                        }}
                      >
                        View
                      </Link>
                    </div>
                  );
                })
              )}
            </div>
          </div>
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
      </div>

      {/* Bottom two column grid: quick actions | funding summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
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

        {/* Funding Summary (compact) */}
        <div style={trayStyle}>
          <div style={{ backgroundColor: "#FFFFFF", borderRadius: "12px", padding: "20px" }}>
            <div style={sectionHeaderStyle}>Funding Summary</div>
            {fundingSummaryRows.map((row) => (
              <div key={row.label}>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#64748B",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {row.label}
                </div>
                <div style={{ fontSize: "22px", fontWeight: 800, color: "#0F172A", marginTop: "2px", marginBottom: "12px" }}>
                  {row.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Autonomous activity — last 24 hours of agent_decisions (migration 080) */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "12px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          padding: "24px",
          marginTop: "16px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "16px",
          }}
        >
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#1A2B3C" }}>
            AI Working For You — Last 24 Hours
          </span>
          {agentDecisions.length > 0 && (
            <span
              className="animate-pulse"
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#10B981",
              }}
              aria-hidden
            />
          )}
        </div>

        {agentDecisions.length === 0 ? (
          <p
            style={{
              fontSize: "13px",
              color: "#6B7280",
              textAlign: "center",
              padding: "32px 0",
            }}
          >
            No autonomous activity yet. Enable agents in Settings &gt; Agents
            to activate your AI pipeline.
          </p>
        ) : (
          <div>
            {agentDecisions.map((decision) => (
              <div
                key={decision.id}
                style={{
                  display: "flex",
                  gap: "12px",
                  padding: "10px 0",
                  borderBottom: "1px solid #F3F4F6",
                }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: decisionDotColor(decision.agent_id),
                    marginTop: "5px",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#1A2B3C" }}>
                    {humanizeEnum(decision.decision_type)}
                  </span>
                  <span style={{ fontSize: "12px", color: "#6B7280", marginLeft: "6px" }}>
                    {truncate(decision.reasoning, 80)}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: "4px",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#FFFFFF",
                      backgroundColor: confidenceBadgeColor(decision.confidence_score),
                      borderRadius: "999px",
                      padding: "2px 8px",
                    }}
                  >
                    {decision.confidence_score != null
                      ? `${decision.confidence_score}%`
                      : "-"}
                  </span>
                  <span style={{ fontSize: "11px", color: "#9CA3AF" }}>
                    {formatRelative(decision.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Strategic Advisor — pending strategic_recommendations (AG-40) */}
      <Link
        href="/intelligence/strategic-advisor"
        style={{ textDecoration: "none", display: "block", marginTop: "16px", maxWidth: "360px" }}
      >
        <div
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: "12px",
            padding: "20px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            cursor: "pointer",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "10px",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 700, color: "#1A2B3C" }}>
              Strategic Advisor
            </span>
            <Sparkles size={16} color="#8B5CF6" aria-hidden />
          </div>
          <div style={{ fontSize: "32px", fontWeight: 900, color: "#0F172A", lineHeight: 1 }}>
            {metricCount(strategicRecommendations.length)}
          </div>
          <div style={{ fontSize: "12px", color: "#64748B", margin: "4px 0 12px" }}>
            pending recommendation{strategicRecommendations.length === 1 ? "" : "s"}
          </div>
          {strategicRecommendations.length > 0 && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {(["immediate", "urgent", "normal", "low"] as const)
                .filter((urgency) => (strategicUrgencyCounts[urgency] ?? 0) > 0)
                .map((urgency) => (
                  <span
                    key={urgency}
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      color: "#FFFFFF",
                      backgroundColor: URGENCY_COLOR[urgency],
                      borderRadius: "999px",
                      padding: "2px 10px",
                      textTransform: "uppercase",
                      letterSpacing: "0.03em",
                    }}
                  >
                    {urgency}: {strategicUrgencyCounts[urgency]}
                  </span>
                ))}
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}

// redeploy 07/16/2026 18:25:17
