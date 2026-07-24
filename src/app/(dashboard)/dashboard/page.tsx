import { Suspense, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import {
  BookOpen,
  FileText,
  Search,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";

import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { LoadingCard } from "@/components/ui/LoadingCard";
import { createClient } from "@/lib/supabase/server";
import {
  analyzeOutcomes,
  type OutcomeInput,
} from "@/lib/ai/learning/outcome-analyzer";
import { formatRelative, humanizeEnum } from "@/lib/utils/formatters";

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

type OnboardingProgress = { completed_steps?: string[] } | null;

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
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        marginBottom: "14px",
      }}
    >
      {children}
    </div>
  );
}

/** Today's Priorities — independently fetched so it can stream/fail on its own. */
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
      { color: "#F59E0B", text: "New opportunities discovered", count: metricCount(discoveryMatchesCount), href: "/opportunities" },
      { color: "#6B48CC", text: "Drafts needing attention", count: metricCount(draftsGenerated), href: "/draft-generator" },
      { color: "#0077B6", text: "Deadlines approaching", count: metricCount(deadlinesThisWeek), href: "/deadlines" },
      { color: "#0EA5E9", text: "Funder alerts requiring review", count: metricCount(reputationAlertsCount), href: "/alerts" },
      { color: "#1A2B3C", text: "Applications awaiting review", count: metricCount(applications.filter((a) => a.submitted_at === null).length), href: "/applications" },
    ];

    return (
      <div style={{ backgroundColor: "#FFFFFF", borderRadius: "12px", padding: "20px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)", border: "1px solid #E2E8F0", marginBottom: "16px" }}>
        <PanelHeader>Today&rsquo;s Priorities</PanelHeader>
        {actionItems.map((item) => (
          <Link
            key={item.text}
            href={item.href}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 0",
              borderBottom: "1px solid #F1F5F9",
              textDecoration: "none",
            }}
          >
            <span style={{ fontSize: "13px", color: "#374151" }}>{item.text}</span>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#FFFFFF",
                backgroundColor: item.color,
                borderRadius: "999px",
                padding: "2px 8px",
                flexShrink: 0,
              }}
            >
              {item.count}
            </span>
          </Link>
        ))}
      </div>
    );
  } catch {
    return <SectionError message="Couldn't load today's priorities." />;
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
    agentRunsCountRes,
    donorDiscoveryCountRes,
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
    supabase
      .from("organizations")
      .select("name, onboarding_progress")
      .eq("id", orgId)
      .single(),
    supabase
      .from("agent_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("donor_discovery_prospects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
  ]);

  const totalOpportunities = oppCountRes.count ?? 0;
  const applications = (applicationsRes.data ?? []) as ApplicationRow[];
  const deadlines = (deadlinesRes.data ?? []) as DeadlineRow[];
  const outcomes = (outcomesRes.data ?? []) as OutcomeInput[];
  const agentDecisions = (agentDecisionsRes.data ?? []) as AgentDecisionRow[];
  const strategicRecommendations = (strategicRecommendationsRes.data ??
    []) as StrategicRecommendationRow[];
  const autoapplyQueued = autoapplyQueueRes.count ?? 0;
  const orgRow = organizationRes.data as
    | { name: string; onboarding_progress: OnboardingProgress }
    | null;
  const orgName = orgRow?.name ?? "Your Organization";
  const onboardCount = orgRow?.onboarding_progress?.completed_steps?.length ?? 0;
  const researchCount = agentRunsCountRes.count ?? 0;
  const donorDiscoveryCount = donorDiscoveryCountRes.count ?? 0;

  const topInsights = [...strategicRecommendations]
    .sort((a, b) => {
      const p = (URGENCY_PRIORITY[a.urgency] ?? 9) - (URGENCY_PRIORITY[b.urgency] ?? 9);
      return p !== 0 ? p : b.generated_at.localeCompare(a.generated_at);
    })
    .slice(0, 3);

  // --- metrics ---------------------------------------------------------------
  const draftsCount = applications.filter(
    (a) => a.draft_content !== null && a.draft_content.trim().length > 0,
  ).length;
  const deadlinesThisWeek = deadlines.filter((d) => {
    const days = differenceInCalendarDays(new Date(d.due_date), now);
    return days >= 0 && days <= 7;
  }).length;

  // Kept for parity with the outcomes-driven empty state below; win-rate /
  // funded-rate figures are computed but not surfaced in this layout.
  analyzeOutcomes(outcomes);

  const hasNoData =
    totalOpportunities === 0 &&
    applications.length === 0 &&
    deadlines.length === 0 &&
    outcomes.length === 0;

  const statCards = [
    { label: "Active Apps", value: metricCount(applications.length), color: "#0077B6" },
    { label: "Opportunities", value: metricCount(totalOpportunities), color: "#7C3AED" },
    { label: "Drafts", value: metricCount(draftsCount), color: "#10B981" },
    { label: "Deadlines", value: metricCount(deadlinesThisWeek), color: "#D97706" },
    { label: "AutoApply Queue", value: metricCount(autoapplyQueued), color: "#00B4D8" },
  ];

  const stageCards = [
    { label: "Onboard", color: "#6366F1", count: onboardCount, href: "/onboarding" },
    { label: "Research", color: "#0077B6", count: researchCount, href: "/research" },
    { label: "Opportunities", color: "#0EA5E9", count: totalOpportunities, href: "/opportunities" },
    { label: "Grant Narratives", color: "#8B5CF6", count: draftsCount, href: "/draft-generator" },
    { label: "AutoApply", color: "#10B981", count: autoapplyQueued, href: "/admin/autoapply-ops" },
    { label: "Donor Discovery", color: "#F59E0B", count: donorDiscoveryCount, href: "/donor-discovery" },
  ];

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh", padding: "24px", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {/* ROW 1 — header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#0F172A", margin: 0 }}>{orgName}</h1>
        <span style={{ fontSize: "14px", color: "#64748B" }}>{format(now, "MMMM d, yyyy")}</span>
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

      {/* ROW 2 — 5 stat cards */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "24px" }}>
        {statCards.map((card) => (
          <div key={card.label} style={{ flex: "1", backgroundColor: "#FFFFFF", borderRadius: "12px", padding: "20px 24px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)", border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: "36px", fontWeight: 800, lineHeight: "1", color: card.color }}>
              {card.value}
            </div>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "6px" }}>
              {card.label}
            </div>
          </div>
        ))}
      </div>

      {/* ROW 3 — 60/40 split */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "24px" }}>
        {/* LEFT — Mission Control */}
        <div id="tour-flightpath-hud" style={{ flex: "1.5", backgroundColor: "#0F172A", borderRadius: "16px", padding: "24px" }}>
          <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.15em", color: "#00B4D8", textTransform: "uppercase", marginBottom: "16px" }}>
            Mission Control
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            {stageCards.map((stage) => (
              <Link
                key={stage.label}
                href={stage.href}
                style={{
                  display: "block",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  borderRadius: "8px",
                  padding: "14px",
                  borderLeft: `3px solid ${stage.color}`,
                  textDecoration: "none",
                }}
              >
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#F8FAFC" }}>{stage.label}</div>
                <div style={{ fontSize: "24px", fontWeight: 800, color: stage.color, marginTop: "4px" }}>
                  {metricCount(stage.count)}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* RIGHT — stacked panels */}
        <div style={{ flex: "1" }}>
          <ErrorBoundary>
            <Suspense fallback={<LoadingCard height={220} borderRadius={12} />}>
              <ActionItemsSection orgId={orgId} />
            </Suspense>
          </ErrorBoundary>

          <div style={{ backgroundColor: "#1A2B3C", borderRadius: "12px", padding: "20px", color: "#F8FAFC" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "14px" }}>
              Upcoming Deadlines
            </div>
            {deadlines.length === 0 ? (
              <p style={{ fontSize: "13px", color: "rgba(248,250,252,0.6)" }}>No deadlines in the next 7 days.</p>
            ) : (
              deadlines.slice(0, 4).map((d) => {
                const days = differenceInCalendarDays(new Date(d.due_date), now);
                const overdue = days <= 0;
                const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d`;
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
                      style={
                        overdue
                          ? { backgroundColor: "rgba(220,38,38,0.2)", color: "#FCA5A5", borderRadius: "4px", padding: "2px 8px", fontSize: "11px", fontWeight: 700, flexShrink: 0 }
                          : { backgroundColor: "rgba(245,158,11,0.2)", color: "#FCD34D", borderRadius: "4px", padding: "2px 8px", fontSize: "11px", fontWeight: 700, flexShrink: 0 }
                      }
                    >
                      {label}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ROW 4 — bottom 3 columns */}
      <div style={{ display: "flex", gap: "16px" }}>
        {/* Col 1 — Recent Activity */}
        <div style={{ flex: "1", backgroundColor: "#FFFFFF", borderRadius: "12px", padding: "20px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)", border: "1px solid #E2E8F0" }}>
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

        {/* Col 2 — Quick Actions */}
        <div style={{ flex: "1", backgroundColor: "#FFFFFF", borderRadius: "12px", padding: "20px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)", border: "1px solid #E2E8F0" }}>
          <PanelHeader>Quick Actions</PanelHeader>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
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
                    padding: "14px 10px",
                    textAlign: "center",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#374151",
                    textDecoration: "none",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Icon size={16} color="#0077B6" aria-hidden />
                  {action.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Col 3 — AI Insight */}
        <div style={{ flex: "1", background: "linear-gradient(135deg,#0077B6,#00B4D8)", borderRadius: "12px", padding: "20px", color: "#FFFFFF" }}>
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
      </div>
    </div>
  );
}
