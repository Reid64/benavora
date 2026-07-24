import { Suspense, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import {
  BookOpen,
  Compass,
  FileText,
  Search,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";

import { FlightPathHUD } from "@/components/dashboard/FlightPathHUD";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { LoadingCard } from "@/components/ui/LoadingCard";
import { createClient } from "@/lib/supabase/server";
import {
  analyzeOutcomes,
  type OutcomeInput,
} from "@/lib/ai/learning/outcome-analyzer";
import { formatCurrency, formatRelative, humanizeEnum } from "@/lib/utils/formatters";

// Dashboard reflects live session-scoped data; never cache (CLAUDE.md).
export const dynamic = "force-dynamic";

type ApplicationRow = {
  id: string;
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

// strategic_recommendations (migration 086_strategic_advisor.sql) is
// org_id-scoped, not organization_id — see AG-40 Strategic Advisor.
type StrategicRecommendationRow = {
  id: string;
  title: string;
  recommendation: string;
  urgency: "immediate" | "urgent" | "normal" | "low";
  generated_at: string;
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

const URGENCY_COLOR: Record<string, string> = {
  immediate: "#DC2626",
  urgent: "#D97706",
  normal: "#0EA5E9",
  low: "#6B7280",
};

const URGENCY_PRIORITY: Record<string, number> = {
  immediate: 0,
  urgent: 1,
  normal: 2,
  low: 3,
};

/** Returns "-" instead of "0" so empty metrics don't imply active tracking. */
function metricCount(n: number): string {
  return n === 0 ? "-" : String(n);
}

function metricCurrency(n: number): string {
  return n === 0 ? "-" : formatCurrency(n);
}

/** Formats a 0-100 rate, or "-" when analyzeOutcomes withheld it (below
 * MIN_OUTCOMES_FOR_RATE — Behavioral Contracts §10 "insufficient data" rule). */
function ratePercent(n: number | null): string {
  return n == null ? "-" : `${n}%`;
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

const cardStyle: CSSProperties = {
  backgroundColor: "#FFFFFF",
  borderRadius: "12px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  border: "1px solid #E2E8F0",
};

function SectionError({ message }: { message: string }) {
  return (
    <div
      style={{
        ...cardStyle,
        borderLeft: "4px solid #DC2626",
        padding: "20px",
        fontSize: "13px",
        color: "#B91C1C",
      }}
    >
      {message}
    </div>
  );
}

function PanelHeader({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: "12px",
        fontWeight: 700,
        color: "#0F172A",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: "14px",
      }}
    >
      {children}
    </div>
  );
}

/** Today's Priority Actions — independently fetched so it can stream/fail on its own. */
async function ActionItemsSection({ orgId }: { orgId: string }) {
  const supabase = createClient();

  try {
    const [applicationsRes, deadlinesRes, discoveryMatchesRes, reputationAlertsRes] =
      await Promise.all([
        supabase
          .from("applications")
          .select("id, submitted_at, draft_content")
          .eq("organization_id", orgId),
        supabase
          .from("deadlines")
          .select("id, due_date")
          .eq("organization_id", orgId)
          .or("is_completed.is.null,is_completed.eq.false"),
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
      ]);

    if (applicationsRes.error) throw applicationsRes.error;
    if (deadlinesRes.error) throw deadlinesRes.error;

    const now = new Date();
    const applications = applicationsRes.data ?? [];
    const draftsGenerated = applications.filter(
      (a) => a.draft_content !== null && a.draft_content.trim().length > 0,
    ).length;
    const deadlinesThisWeek = (deadlinesRes.data ?? []).filter((d) => {
      const days = differenceInCalendarDays(new Date(d.due_date), now);
      return days >= 0 && days <= 7;
    }).length;
    const discoveryMatchesCount = discoveryMatchesRes.count ?? 0;
    const reputationAlertsCount = reputationAlertsRes.count ?? 0;

    const actionItems = [
      { dot: "#F59E0B", text: "New opportunities discovered", count: metricCount(discoveryMatchesCount), href: "/opportunities" },
      { dot: "#6B48CC", text: "Drafts needing attention", count: metricCount(draftsGenerated), href: "/draft-generator" },
      { dot: "#0077B6", text: "Deadlines approaching", count: metricCount(deadlinesThisWeek), href: "/deadlines" },
      { dot: "#0EA5E9", text: "Funder alerts requiring review", count: metricCount(reputationAlertsCount), href: "/alerts" },
      { dot: "#1A2B3C", text: "Applications awaiting review", count: metricCount(applications.filter((a) => a.submitted_at === null).length), href: "/applications" },
    ];

    return (
      <div style={{ ...cardStyle, padding: "20px", marginBottom: "16px" }}>
        <PanelHeader>Today&rsquo;s Priority Actions</PanelHeader>
        {actionItems.map((item) => (
          <div
            key={item.text}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 0",
              borderBottom: "1px solid #F1F5F9",
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
            <Link
              href={item.href}
              style={{
                backgroundColor: "#0077B6",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "8px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                textDecoration: "none",
              }}
            >
              Go
            </Link>
          </div>
        ))}
      </div>
    );
  } catch {
    return <SectionError message="Couldn't load today's priority actions." />;
  }
}

const QUICK_ACTIONS = [
  { label: "New Opportunity", href: "/opportunities/new", icon: Zap },
  { label: "Start Draft", href: "/draft-generator", icon: FileText },
  { label: "Run AutoApply", href: "/autoapply", icon: Sparkles },
  { label: "Find Donors", href: "/donor-discovery", icon: Users },
  { label: "View Research", href: "/research", icon: Search },
  { label: "Intelligence Library", href: "/intelligence-library", icon: BookOpen },
];

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
      <div
        style={{
          borderRadius: "8px",
          border: "1px solid #FECACA",
          backgroundColor: "#FEF2F2",
          padding: "12px 16px",
          fontSize: "14px",
          color: "#B91C1C",
        }}
      >
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
    agentDecisionsRes,
    strategicRecommendationsRes,
    autoapplyQueueRes,
    organizationRes,
  ] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("applications")
      .select("id, requested_amount, submitted_at, draft_content")
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
      .select("id, title, recommendation, urgency, generated_at")
      .eq("org_id", orgId)
      .eq("status", "pending"),
    // submission_queue (migration 045_autoapply_tables.sql) has no 'queued'
    // status value — its enum is pending/processing/completed/failed/skipped.
    // 'pending' is the queued-and-waiting equivalent (matches nav-counts route).
    supabase
      .from("submission_queue")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "pending"),
    supabase.from("organizations").select("name").eq("id", orgId).single(),
  ]);

  const totalOpportunities = oppCountRes.count ?? 0;
  const applications = (applicationsRes.data ?? []) as ApplicationRow[];
  const deadlines = (deadlinesRes.data ?? []) as DeadlineRow[];
  const outcomes = (outcomesRes.data ?? []) as OutcomeInput[];
  const agentDecisions = (agentDecisionsRes.data ?? []) as AgentDecisionRow[];
  const strategicRecommendations = (strategicRecommendationsRes.data ??
    []) as StrategicRecommendationRow[];
  const autoapplyQueued = autoapplyQueueRes.count ?? 0;
  const orgName =
    (organizationRes.data as { name: string } | null)?.name ??
    "Your Organization";

  const topInsights = [...strategicRecommendations]
    .sort((a, b) => {
      const p = (URGENCY_PRIORITY[a.urgency] ?? 9) - (URGENCY_PRIORITY[b.urgency] ?? 9);
      return p !== 0 ? p : b.generated_at.localeCompare(a.generated_at);
    })
    .slice(0, 3);

  // --- metrics ---------------------------------------------------------------
  const submittedCount = applications.filter(
    (a) => a.submitted_at !== null,
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

  const hasNoData =
    totalOpportunities === 0 &&
    applications.length === 0 &&
    deadlines.length === 0 &&
    outcomes.length === 0;

  const statCards = [
    {
      label: "Active Applications",
      value: metricCount(applications.length),
      color: "#0077B6",
    },
    {
      label: "Total Funding Pursued",
      value: metricCurrency(totalRequested),
      color: "#16A34A",
    },
    {
      label: "Win Rate",
      value: ratePercent(summary.successRate),
      color: "#7C3AED",
    },
    {
      label: "Deadlines This Week",
      value: metricCount(deadlinesThisWeek),
      color: deadlinesThisWeek > 0 ? "#D97706" : "#64748B",
    },
    {
      label: "AutoApply Queue",
      value: metricCount(autoapplyQueued),
      color: "#00B4D8",
    },
  ];

  const performanceRows = [
    { label: "Win Rate", value: summary.successRate },
    { label: "Funded Rate", value: summary.fundedRate },
    { label: "Dollar Efficiency", value: summary.dollarEfficiency },
  ];

  return (
    <div style={{ backgroundColor: "#E4E9F0", minHeight: "100vh", padding: "32px", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#0F172A", letterSpacing: "-0.02em", margin: "0 0 4px 0" }}>
          {orgName}
        </h1>
        <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>{format(now, "MMMM d, yyyy")}</p>
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
            Base &mdash; the metrics below fill in as you work.
          </p>
        </div>
      )}

      {/* ZONE 1 — stat bar */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
        {statCards.map((card) => (
          <div key={card.label} style={{ ...cardStyle, padding: "20px 24px", flex: "1", minWidth: "180px" }}>
            <div style={{ fontSize: "32px", fontWeight: 800, lineHeight: 1, color: card.color }}>
              {card.value}
            </div>
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "4px" }}>
              {card.label}
            </div>
          </div>
        ))}
      </div>

      {/* ZONE 2 — 60/40 split */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: "16px", marginBottom: "16px", alignItems: "start" }}>
        {/* LEFT — Mission Control */}
        <div style={{ backgroundColor: "#0F172A", borderRadius: "16px", padding: "24px", color: "#F8FAFC" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.15em", color: "#00B4D8", textTransform: "uppercase", marginBottom: "16px" }}>
            Mission Control
          </div>
          <FlightPathHUD />
        </div>

        {/* RIGHT — 3 stacked panels */}
        <div>
          <ErrorBoundary>
            <Suspense fallback={<LoadingCard height={220} borderRadius={12} />}>
              <ActionItemsSection orgId={orgId} />
            </Suspense>
          </ErrorBoundary>

          <div style={{ backgroundColor: "#1A2B3C", borderRadius: "12px", padding: "20px", color: "#F8FAFC", marginBottom: "16px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#FFFFFF", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "14px" }}>
              Upcoming Deadlines
            </div>
            {deadlines.length === 0 ? (
              <p style={{ fontSize: "13px", color: "rgba(248,250,252,0.6)" }}>No deadlines in the next 7 days.</p>
            ) : (
              deadlines.slice(0, 4).map((d) => {
                const days = differenceInCalendarDays(new Date(d.due_date), now);
                const href = d.application_id
                  ? `/applications/${d.application_id}`
                  : d.opportunity_id
                    ? `/opportunities/${d.opportunity_id}`
                    : "/deadlines";
                return (
                  <Link
                    key={d.id}
                    href={href}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "10px",
                      padding: "8px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.08)",
                      textDecoration: "none",
                    }}
                  >
                    <span style={{ fontSize: "13px", color: "#F8FAFC", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {truncate(d.title, 32)}
                    </span>
                    <span
                      style={{
                        backgroundColor: "rgba(220,38,38,0.2)",
                        color: "#FCA5A5",
                        borderRadius: "6px",
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {days <= 0 ? "Due today" : `${days}d`}
                    </span>
                  </Link>
                );
              })
            )}
          </div>

          <div style={{ ...cardStyle, padding: "20px" }}>
            <PanelHeader>Quick Actions</PanelHeader>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    style={{
                      backgroundColor: "#F8FAFC",
                      border: "1px solid #E2E8F0",
                      borderRadius: "10px",
                      padding: "14px",
                      textAlign: "center",
                      cursor: "pointer",
                      textDecoration: "none",
                      color: "#0F172A",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}
                  >
                    <Icon size={16} color="#0077B6" aria-hidden />
                    {action.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ZONE 3 — bottom 3-column row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
        {/* Col 1 — Recent Activity */}
        <div style={{ ...cardStyle, padding: "20px" }}>
          <PanelHeader>Recent Activity</PanelHeader>
          {agentDecisions.length === 0 ? (
            <p style={{ fontSize: "13px", color: "#6B7280", textAlign: "center", padding: "24px 0" }}>
              No autonomous activity yet. Enable agents in Settings &gt; Agents.
            </p>
          ) : (
            agentDecisions.slice(0, 5).map((decision, i) => (
              <div
                key={decision.id}
                style={{
                  display: "flex",
                  gap: "10px",
                  padding: "10px 8px",
                  borderRadius: "6px",
                  backgroundColor: i % 2 === 0 ? "transparent" : "#F8FAFC",
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
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#1A2B3C" }}>
                    {humanizeEnum(decision.decision_type)}
                  </div>
                  <div style={{ fontSize: "11px", color: "#6B7280" }}>{truncate(decision.reasoning, 60)}</div>
                </div>
                <span style={{ fontSize: "10px", color: "#9CA3AF", flexShrink: 0 }}>
                  {formatRelative(decision.created_at)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Col 2 — AI Insights */}
        <div style={{ background: "linear-gradient(135deg,#0077B6,#00B4D8)", borderRadius: "12px", padding: "20px", color: "#FFFFFF" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "14px" }}>
            <Sparkles size={14} aria-hidden />
            <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              AI Insights
            </span>
          </div>
          {topInsights.length === 0 ? (
            <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.85)" }}>
              No pending recommendations right now.
            </p>
          ) : (
            topInsights.map((rec) => (
              <Link
                key={rec.id}
                href="/intelligence/strategic-advisor"
                style={{
                  display: "block",
                  backgroundColor: "rgba(255,255,255,0.15)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: "10px",
                  padding: "12px 14px",
                  marginBottom: "10px",
                  textDecoration: "none",
                  color: "#FFFFFF",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700 }}>{truncate(rec.title, 34)}</span>
                  <span
                    style={{
                      fontSize: "9px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      backgroundColor: URGENCY_COLOR[rec.urgency],
                      borderRadius: "999px",
                      padding: "2px 8px",
                      flexShrink: 0,
                    }}
                  >
                    {rec.urgency}
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.85)" }}>
                  {truncate(rec.recommendation, 70)}
                </div>
              </Link>
            ))
          )}
        </div>

        {/* Col 3 — Performance Radar */}
        <div style={{ ...cardStyle, padding: "20px" }}>
          <PanelHeader>Performance Radar</PanelHeader>
          {performanceRows.map((row) => (
            <div key={row.label} style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "6px" }}>
                <span style={{ color: "#64748B", fontWeight: 600 }}>{row.label}</span>
                <span style={{ color: "#0F172A", fontWeight: 700 }}>{ratePercent(row.value)}</span>
              </div>
              <div style={{ backgroundColor: "#F1F5F9", borderRadius: "3px", height: "6px", overflow: "hidden" }}>
                <div
                  style={{
                    backgroundColor: "#0077B6",
                    height: "6px",
                    borderRadius: "3px",
                    width: `${row.value ?? 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
