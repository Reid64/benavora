import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addDays, differenceInCalendarDays, format } from "date-fns";

import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import { naicsLabel } from "@/lib/donor-discovery/naics-labels";
import { FlipCards, type FlipCardData } from "@/components/dashboard/FlipCards";
import { AiTriggerPanel, type AiTrigger } from "@/components/dashboard/AiTriggerPanel";

// Dashboard reflects live session-scoped data; never cache (CLAUDE.md).
export const dynamic = "force-dynamic";

const NAVY = "#0A1628";
const CARD_BG = "#0D1E35";
const ROYAL = "#0077B6";
const SKY = "#0EA5E9";
const CYAN = "#00D4FF";
const TEAL = "#0891B2";
const PURPLE = "#7C3AED";
const AMBER = "#D97706";
const GREEN = "#10B981";
const RED = "#EF4444";
const WHITE = "#FFFFFF";
const MUTED = "rgba(255,255,255,0.6)";

type ApplicationRow = {
  id: string;
  requested_amount: number | null;
  submitted_at: string | null;
  draft_content: string | null;
  draft_confidence_score: number | null;
  stage: string;
  awarded_amount: number | null;
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
// of each agent's short number, matched by prefix rather than exact string.
type AgentDecisionRow = {
  id: string;
  agent_id: string;
  decision_type: string;
  reasoning: string;
  confidence_score: number | null;
  action_taken: string;
  created_at: string;
};

type TopOpportunityRow = {
  id: string;
  name: string;
  funder_id: string | null;
  amount_available: number | null;
  match_percentage: number | null;
  deadline: string | null;
  status: string;
};

type AutomationSessionRow = {
  id: string;
  status: string;
};

type AutomationSessionDetail = {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  funder_id: string | null;
  target_url: string | null;
};

type AlertRow = {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  link: string | null;
  created_at: string;
};

type ProspectDirectoryRow = {
  id: string;
  directory: { naics_codes: string[] | null } | null;
};

type OnboardingProgress = { completed_steps?: string[] } | null;

const URGENCY_COLOR: Record<string, string> = {
  immediate: RED,
  urgent: AMBER,
  normal: SKY,
  low: MUTED,
};

const URGENCY_PRIORITY: Record<string, number> = {
  immediate: 0,
  urgent: 1,
  normal: 2,
  low: 3,
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: RED,
  warning: AMBER,
  info: SKY,
};

// Mirrors src/app/(dashboard)/settings/organization-setup/page.tsx's STEP_INFO —
// the real 7-step wizard (organizations.onboarding_progress.completed_steps
// stores stringified "1".."7", not 11 steps).
const ONBOARDING_STEPS: { id: string; title: string }[] = [
  { id: "1", title: "Organization Profile" },
  { id: "2", title: "Programs" },
  { id: "3", title: "Knowledge Base" },
  { id: "4", title: "Board Members" },
  { id: "5", title: "Documents" },
  { id: "6", title: "Search Profile" },
  { id: "7", title: "Plan Selection" },
];
const TOTAL_ONBOARDING_STEPS = ONBOARDING_STEPS.length;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function decisionDotColor(agentId: string): string {
  if (agentId.startsWith("ag-17")) return CYAN;
  if (agentId.startsWith("ag-15")) return SKY;
  if (agentId.startsWith("ag-05")) return PURPLE;
  if (agentId.startsWith("ag-18")) return AMBER;
  if (agentId.startsWith("ag-19")) return GREEN;
  return MUTED;
}

function confidenceColor(score: number): string {
  if (score < 60) return RED;
  if (score < 80) return AMBER;
  return GREEN;
}

function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

const panelStyle: CSSProperties = {
  backgroundColor: CARD_BG,
  borderRadius: "14px",
  border: "1px solid rgba(255,255,255,0.08)",
};

const panelHeaderStyle: CSSProperties = {
  padding: "16px 20px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  fontSize: "15px",
  fontWeight: 800,
  color: WHITE,
};

function Panel({ title, children, style }: { title: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ ...panelStyle, ...style }}>
      <div style={panelHeaderStyle}>{title}</div>
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </div>
  );
}

/**
 * Main dashboard (BLUEPRINT §4.1, v4 design). All data is read server-side
 * via the session-bound Supabase client; organization_id derived from the
 * authenticated user's profile (never from a request body), with RLS as the
 * second barrier.
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
      <div style={{ backgroundColor: NAVY, minHeight: "100vh", padding: "24px", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
        <div
          style={{
            borderRadius: "12px",
            border: "1px solid rgba(239,68,68,0.4)",
            backgroundColor: "rgba(239,68,68,0.1)",
            padding: "16px 20px",
            fontSize: "14px",
            color: WHITE,
          }}
        >
          We couldn&rsquo;t resolve your organization. Please sign in again.
        </div>
      </div>
    );
  }

  const orgId = profile.organization_id;
  const now = new Date();
  const horizon = format(addDays(now, 7), "yyyy-MM-dd");
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    organizationRes,
    applicationsRes,
    deadlinesRes,
    agentDecisionsRes,
    strategicRecommendationsRes,
    oppCountRes,
    oppOpenCountRes,
    topOpportunitiesRes,
    oppSourceTypesRes,
    agentRunsCountRes,
    donorDiscoveryCountRes,
    corporateIntentSignalsRes,
    foundationTotalRes,
    foundationHighMatchRes,
    foundationNewThisWeekRes,
    automationSessionsRecentRes,
    automationSessionLastRes,
    prospectDirectoryRes,
    twinRes,
    alertsRes,
  ] = await Promise.all([
    supabase.from("organizations").select("name, onboarding_progress").eq("id", orgId).single(),
    supabase
      .from("applications")
      .select("id, requested_amount, submitted_at, draft_content, draft_confidence_score, stage, awarded_amount")
      .eq("organization_id", orgId),
    supabase
      .from("deadlines")
      .select("id, title, deadline_type, due_date, application_id, opportunity_id")
      .eq("organization_id", orgId)
      .or("is_completed.is.null,is_completed.eq.false")
      .lte("due_date", horizon)
      .order("due_date", { ascending: true }),
    supabase
      .from("agent_decisions")
      .select("id, agent_id, decision_type, reasoning, confidence_score, action_taken, created_at")
      .eq("org_id", orgId)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("strategic_recommendations")
      .select("id, title, recommendation, urgency, generated_at")
      .eq("org_id", orgId)
      .eq("status", "pending"),
    supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "open"),
    supabase
      .from("opportunities")
      .select("id, name, funder_id, amount_available, match_percentage, deadline, status")
      .eq("organization_id", orgId)
      .order("match_percentage", { ascending: false, nullsFirst: false })
      .limit(5),
    supabase.from("opportunities").select("source_type").eq("organization_id", orgId),
    supabase.from("agent_runs").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabase
      .from("donor_discovery_prospects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("corporate_intent_signals")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId),
    supabase.from("foundation_directory").select("id", { count: "exact", head: true }),
    supabase
      .from("foundation_directory")
      .select("id", { count: "exact", head: true })
      .gt("asset_amount", 1_000_000),
    supabase
      .from("foundation_directory")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekAgo),
    supabase
      .from("automation_sessions")
      .select("id, status")
      .eq("organization_id", orgId)
      .gte("created_at", thirtyDaysAgo),
    supabase
      .from("automation_sessions")
      .select("id, status, created_at, started_at, completed_at, funder_id, target_url")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("donor_discovery_prospects")
      .select("id, directory:donor_discovery_directory(naics_codes)")
      .eq("organization_id", orgId)
      .limit(200),
    supabase
      .from("organizational_digital_twins")
      .select("twin_completeness_score")
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("alerts")
      .select("id, type, severity, message, link, created_at")
      .eq("organization_id", orgId)
      .eq("is_dismissed", false)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const orgRow = organizationRes.data as { name: string; onboarding_progress: OnboardingProgress } | null;
  const orgName = orgRow?.name ?? "Your Organization";
  const completedSteps = orgRow?.onboarding_progress?.completed_steps ?? [];
  const onboardCount = completedSteps.length;

  const applications = (applicationsRes.data ?? []) as ApplicationRow[];
  const deadlines = (deadlinesRes.data ?? []) as DeadlineRow[];
  const agentDecisions = (agentDecisionsRes.data ?? []) as AgentDecisionRow[];
  const strategicRecommendations = (strategicRecommendationsRes.data ?? []) as StrategicRecommendationRow[];
  const totalOpportunities = oppCountRes.count ?? 0;
  const openOpportunities = oppOpenCountRes.count ?? 0;
  const reviewedOpportunities = Math.max(totalOpportunities - openOpportunities, 0);
  const topOpportunities = (topOpportunitiesRes.data ?? []) as TopOpportunityRow[];
  const oppSourceTypes = (oppSourceTypesRes.data ?? []) as { source_type: string | null }[];
  const researchCount = agentRunsCountRes.count ?? 0;
  const donorDiscoveryCount = donorDiscoveryCountRes.count ?? 0;
  const intentSignalsCount = corporateIntentSignalsRes.count ?? 0;
  const foundationTotal = foundationTotalRes.count ?? 0;
  const foundationHighMatch = foundationHighMatchRes.count ?? 0;
  const foundationNewThisWeek = foundationNewThisWeekRes.count ?? 0;
  const automationSessionsRecent = (automationSessionsRecentRes.data ?? []) as AutomationSessionRow[];
  const automationSessionLast = automationSessionLastRes.data as AutomationSessionDetail | null;
  const prospectDirectoryRows = (prospectDirectoryRes.data ?? []) as unknown as ProspectDirectoryRow[];
  const twinCompletenessScore =
    (twinRes.data as { twin_completeness_score: number | null } | null)?.twin_completeness_score ?? 0;
  const alerts = (alertsRes.data ?? []) as AlertRow[];

  // --- second-wave lookups (depend on first wave's ids) -----------------------
  const funderIds = [...new Set(topOpportunities.map((o) => o.funder_id).filter((id): id is string => Boolean(id)))];
  if (automationSessionLast?.funder_id) funderIds.push(automationSessionLast.funder_id);

  const [funderNamesRes] = await Promise.all([
    funderIds.length > 0
      ? supabase.from("funders").select("id, name").in("id", funderIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const funderNameById = new Map((funderNamesRes.data ?? []).map((f) => [f.id, f.name]));

  // --- derived metrics ---------------------------------------------------------
  const draftsCount = applications.filter(
    (a) => a.draft_content !== null && a.draft_content.trim().length > 0,
  ).length;
  const confidenceScores = applications
    .map((a) => a.draft_confidence_score)
    .filter((s): s is number => s != null);
  const avgConfidence =
    confidenceScores.length > 0
      ? Math.round(confidenceScores.reduce((sum, s) => sum + s, 0) / confidenceScores.length)
      : 0;
  const awardedApplications = applications.filter((a) => a.stage === "awarded");
  const recentDrafts = applications
    .filter((a) => a.draft_content !== null && a.draft_content.trim().length > 0)
    .slice(0, 4);

  const automationSubmitted = automationSessionsRecent.filter((s) => s.status === "submitted").length;
  const automationTerminal = automationSessionsRecent.filter((s) =>
    ["submitted", "failed", "cancelled"].includes(s.status),
  ).length;
  const automationSuccessRate =
    automationTerminal > 0 ? Math.round((automationSubmitted / automationTerminal) * 100) : null;

  const industryCounts = new Map<string, number>();
  for (const row of prospectDirectoryRows) {
    const codes = row.directory?.naics_codes ?? [];
    for (const code of codes) {
      industryCounts.set(code, (industryCounts.get(code) ?? 0) + 1);
    }
  }
  const topIndustries = [...industryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, count]) => ({ label: naicsLabel(code), count }));

  const sourceTypeCounts = new Map<string, number>();
  for (const row of oppSourceTypes) {
    const key = row.source_type ?? "unclassified";
    sourceTypeCounts.set(key, (sourceTypeCounts.get(key) ?? 0) + 1);
  }
  const opportunityMix = [...sourceTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([sourceType, count]) => ({ label: humanizeEnum(sourceType), count }));
  const maxMixCount = Math.max(1, ...opportunityMix.map((m) => m.count));

  const topInsights = [...strategicRecommendations]
    .sort((a, b) => {
      const p = (URGENCY_PRIORITY[a.urgency] ?? 9) - (URGENCY_PRIORITY[b.urgency] ?? 9);
      return p !== 0 ? p : b.generated_at.localeCompare(a.generated_at);
    })
    .slice(0, 5);

  const MIX_COLORS = [ROYAL, SKY, CYAN, TEAL, PURPLE, AMBER, GREEN, RED];

  // --- pipeline strip -----------------------------------------------------------
  const stages = [
    { label: "Onboard", color: GREEN, value: `${onboardCount}/${TOTAL_ONBOARDING_STEPS}`, href: "/onboarding" },
    { label: "Research", color: ROYAL, value: String(researchCount), href: "/research" },
    { label: "Opportunities", color: CYAN, value: String(totalOpportunities), href: "/opportunities", active: true },
    { label: "Narratives", color: PURPLE, value: String(draftsCount), href: "/draft-generator" },
    { label: "AutoApply", color: TEAL, value: String(automationSessionsRecent.length), href: "/autoapply" },
    { label: "Funding Secured", color: AMBER, value: String(awardedApplications.length), href: "/applications" },
  ];

  // --- flip cards -----------------------------------------------------------------
  const incompleteSteps = ONBOARDING_STEPS.filter((s) => !completedSteps.includes(s.id));
  const onboardingPct = Math.round((onboardCount / TOTAL_ONBOARDING_STEPS) * 100);

  const cards: FlipCardData[] = [
    {
      key: "onboarding",
      icon: "🚀",
      label: "ONBOARDING",
      value: `${onboardCount}/${TOTAL_ONBOARDING_STEPS}`,
      sub: `${onboardingPct}% complete`,
      frontGradient: "linear-gradient(135deg,#0B2D4A,#0D3560)",
      borderColor: "rgba(0,119,182,0.3)",
      accentGradient: "linear-gradient(90deg,#0077B6,#00D4FF)",
      href: "/onboarding",
      ctaLabel: "Complete setup →",
      back: (
        <div>
          {incompleteSteps.length === 0 ? (
            <div style={{ fontSize: "12px", color: WHITE }}>All steps complete.</div>
          ) : (
            incompleteSteps.map((step) => (
              <Link
                key={step.id}
                href="/onboarding"
                style={{
                  display: "block",
                  fontSize: "12px",
                  color: WHITE,
                  padding: "4px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                  textDecoration: "none",
                }}
              >
                {step.title}
              </Link>
            ))
          )}
        </div>
      ),
    },
    {
      key: "research",
      icon: "🔬",
      label: "RESEARCH",
      value: String(foundationTotal),
      sub: `${foundationHighMatch} high-match`,
      frontGradient: "linear-gradient(135deg,#082838,#0A3548)",
      borderColor: "rgba(14,165,233,0.3)",
      accentGradient: "linear-gradient(90deg,#0EA5E9,#0077B6)",
      href: "/research",
      ctaLabel: "Open research →",
      back: (
        <div style={{ fontSize: "12px", color: WHITE, display: "flex", flexDirection: "column", gap: "6px" }}>
          <div>Total foundations: {foundationTotal}</div>
          <div>High-match (&gt;$1M assets): {foundationHighMatch}</div>
          <div>New this week: {foundationNewThisWeek}</div>
        </div>
      ),
    },
    {
      key: "outreach",
      icon: "📤",
      label: "OUTREACH",
      value: "0",
      sub: `${intentSignalsCount} intent signals`,
      frontGradient: "linear-gradient(135deg,#0A2D1E,#0C3A26)",
      borderColor: "rgba(16,185,129,0.3)",
      accentGradient: "linear-gradient(90deg,#10B981,#34D399)",
      href: "/donor-discovery",
      ctaLabel: "Start outreach →",
      back: (
        <div style={{ fontSize: "12px", color: WHITE, display: "flex", flexDirection: "column", gap: "6px" }}>
          <div>Emails sent: 0</div>
          <div>Opens: 0</div>
          <div>Intent signals: {intentSignalsCount}</div>
          <div>Prospects available: {donorDiscoveryCount}</div>
        </div>
      ),
    },
    {
      key: "narratives",
      icon: "✍️",
      label: "NARRATIVES",
      value: String(draftsCount),
      sub: `${avgConfidence}% avg confidence`,
      frontGradient: "linear-gradient(135deg,#1E0A3C,#2A1050)",
      borderColor: "rgba(124,58,237,0.3)",
      accentGradient: "linear-gradient(90deg,#7C3AED,#A855F7)",
      href: "/draft-generator",
      ctaLabel: "Open draft generator →",
      back: (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {recentDrafts.length === 0 ? (
            <div style={{ fontSize: "12px", color: WHITE }}>No drafts yet.</div>
          ) : (
            recentDrafts.map((draft) => (
              <Link
                key={draft.id}
                href="/draft-generator"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "12px",
                  color: WHITE,
                  padding: "3px 0",
                  textDecoration: "none",
                }}
              >
                <span>{formatCurrency(draft.requested_amount)}</span>
                <span style={{ color: confidenceColor(draft.draft_confidence_score ?? 0), fontWeight: 700 }}>
                  {draft.draft_confidence_score ?? "-"}
                </span>
              </Link>
            ))
          )}
        </div>
      ),
    },
    {
      key: "autoapply",
      icon: "⚡",
      label: "AUTOAPPLY",
      value: String(automationSessionsRecent.length),
      sub: automationSuccessRate != null ? `${automationSuccessRate}% success` : "No runs yet",
      frontGradient: "linear-gradient(135deg,#082830,#0A3540)",
      borderColor: "rgba(8,145,178,0.3)",
      accentGradient: "linear-gradient(90deg,#0891B2,#06B6D4)",
      href: "/autoapply",
      ctaLabel: "View AutoApply →",
      back: (
        <div style={{ fontSize: "12px", color: WHITE, display: "flex", flexDirection: "column", gap: "6px" }}>
          {automationSessionLast ? (
            <>
              <div>Portal: {funderNameById.get(automationSessionLast.funder_id ?? "") ?? automationSessionLast.target_url ?? "Unknown"}</div>
              <div>Status: {humanizeEnum(automationSessionLast.status)}</div>
              <div>Started: {formatRelative(automationSessionLast.started_at ?? automationSessionLast.created_at)}</div>
              {automationSessionLast.completed_at && automationSessionLast.started_at && (
                <div>
                  Duration:{" "}
                  {formatDurationSeconds(
                    Math.round(
                      (new Date(automationSessionLast.completed_at).getTime() -
                        new Date(automationSessionLast.started_at).getTime()) /
                        1000,
                    ),
                  )}
                </div>
              )}
            </>
          ) : (
            <div>No sessions yet.</div>
          )}
        </div>
      ),
    },
    {
      key: "donor-discovery",
      icon: "🎯",
      label: "DONOR DISCOVERY",
      value: String(donorDiscoveryCount),
      sub: `${intentSignalsCount} intent signals`,
      frontGradient: "linear-gradient(135deg,#2D1A00,#3A2200)",
      borderColor: "rgba(217,119,6,0.3)",
      accentGradient: "linear-gradient(90deg,#D97706,#F59E0B)",
      href: "/donor-discovery",
      ctaLabel: "Start discovery →",
      back: (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {topIndustries.length === 0 ? (
            <div style={{ fontSize: "12px", color: WHITE }}>No prospects yet.</div>
          ) : (
            topIndustries.map((ind) => (
              <div key={ind.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: WHITE }}>
                <span>{truncate(ind.label, 22)}</span>
                <span style={{ fontWeight: 700 }}>{ind.count}</span>
              </div>
            ))
          )}
        </div>
      ),
    },
  ];

  // --- AI triggers ----------------------------------------------------------------
  const aiTriggers: AiTrigger[] = [
    {
      key: "federal-scan",
      icon: "🏛️",
      title: "Federal Scan",
      sub: "Pull new opportunities from grants.gov, Simpler Grants & HUD",
      yieldText: `${totalOpportunities} opportunities on file`,
      action: { kind: "post", endpoint: "/api/agents/research", body: { sources: ["grants_gov", "simpler_grants", "hud"] } },
      ctaLabel: "Run scan",
    },
    {
      key: "geo-discovery",
      icon: "🗺️",
      title: "Geo Discovery",
      sub: "Launch a geographic donor/foundation discovery request",
      yieldText: `${donorDiscoveryCount} prospects found so far`,
      action: { kind: "link", href: "/donor-discovery/new" },
      ctaLabel: "Start discovery",
    },
    {
      key: "import-narratives",
      icon: "📝",
      title: "Import Narratives",
      sub: "Generate up to 3 queued draft narratives now",
      yieldText: `${draftsCount} narratives generated`,
      action: { kind: "post", endpoint: "/api/drafts/queue/trigger" },
      ctaLabel: "Generate now",
    },
  ];

  const statusDots = [
    { color: GREEN, label: "Database Connected" },
    { color: agentDecisions.length > 0 ? GREEN : MUTED, label: agentDecisions.length > 0 ? "AI Agents Active" : "AI Agents Idle" },
    { color: CYAN, label: `Live · ${format(now, "h:mm a")}` },
    { color: automationSessionsRecent.length > 0 ? GREEN : MUTED, label: `AutoApply · ${automationSessionsRecent.length} runs (30d)` },
  ];

  return (
    <div style={{ backgroundColor: NAVY, minHeight: "100vh", padding: "24px", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
      <style>{`
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 0 0 rgba(0,212,255,0.5); }
          50% { box-shadow: 0 0 14px 4px rgba(0,212,255,0.35); }
          100% { box-shadow: 0 0 0 0 rgba(0,212,255,0.5); }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 800, color: WHITE, margin: 0 }}>{orgName}</h1>
        <span style={{ fontSize: "14px", color: WHITE }}>{format(now, "MMMM d, yyyy")}</span>
      </div>

      {/* Pipeline strip */}
      <div
        style={{
          background: "linear-gradient(135deg,#0D1E35,#0A1A2E)",
          borderRadius: "16px",
          border: "1px solid rgba(0,212,255,0.15)",
          padding: "18px 22px",
          marginBottom: "18px",
        }}
      >
        <div style={{ fontSize: "15px", fontWeight: 800, color: WHITE, marginBottom: "14px" }}>🔗 Pipeline</div>
        <div style={{ display: "flex", alignItems: "center", gap: "0" }}>
          {stages.flatMap((stage, i) => [
            <Link
              key={stage.label}
              href={stage.href}
              style={{
                flex: "1",
                backgroundColor: "rgba(255,255,255,0.06)",
                borderRadius: "10px",
                padding: "12px 14px",
                borderTop: `2px solid ${stage.color}`,
                textDecoration: "none",
                ...(stage.active ? { animation: "pulseGlow 2.2s ease-in-out infinite" } : {}),
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 700, color: WHITE, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {stage.label}
              </div>
              <div style={{ fontSize: "24px", fontWeight: 800, color: stage.color, lineHeight: 1, marginTop: "4px" }}>
                {stage.value}
              </div>
            </Link>,
            ...(i < stages.length - 1
              ? [
                  <div key={`${stage.label}-arrow`} style={{ color: RED, fontSize: "18px", fontWeight: 900, padding: "0 8px", flexShrink: 0 }}>
                    →
                  </div>,
                ]
              : []),
          ])}
        </div>
      </div>

      {/* Flip cards */}
      <FlipCards cards={cards} />

      {/* 3-column grid */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "16px", alignItems: "flex-start" }}>
        {/* Left */}
        <div style={{ flex: "1.5", display: "flex", flexDirection: "column", gap: "16px" }}>
          <Panel title="📋 Action Queue">
            {topInsights.length === 0 ? (
              <p style={{ fontSize: "13px", color: MUTED, margin: 0 }}>No pending recommendations right now.</p>
            ) : (
              topInsights.map((rec) => (
                <Link
                  key={rec.id}
                  href="/intelligence/strategic-advisor"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "9px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    textDecoration: "none",
                  }}
                >
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: URGENCY_COLOR[rec.urgency] ?? MUTED,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: "13px", color: WHITE, flex: 1 }}>{truncate(rec.title, 48)}</span>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      color: WHITE,
                      backgroundColor: URGENCY_COLOR[rec.urgency] ?? MUTED,
                      borderRadius: "999px",
                      padding: "2px 8px",
                      flexShrink: 0,
                    }}
                  >
                    {rec.urgency}
                  </span>
                </Link>
              ))
            )}
          </Panel>

          <Panel title="🎯 Top Opportunities">
            {topOpportunities.length === 0 ? (
              <p style={{ fontSize: "13px", color: MUTED, margin: 0 }}>No opportunities on file yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {topOpportunities.map((opp) => (
                  <Link
                    key={opp.id}
                    href={`/opportunities/${opp.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "9px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      textDecoration: "none",
                    }}
                  >
                    <span style={{ fontSize: "13px", color: WHITE, flex: 1.4 }}>{truncate(opp.name, 34)}</span>
                    <span style={{ fontSize: "12px", color: MUTED, flex: 1 }}>
                      {opp.funder_id ? truncate(funderNameById.get(opp.funder_id) ?? "—", 20) : "—"}
                    </span>
                    <span style={{ fontSize: "12px", color: WHITE, flex: "0 0 70px" }}>{formatCurrency(opp.amount_available)}</span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color: CYAN,
                        flex: "0 0 40px",
                      }}
                    >
                      {opp.match_percentage != null ? `${opp.match_percentage}%` : "—"}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Center */}
        <div style={{ flex: "1" }}>
          <Panel title="🤖 AI Triggers">
            <AiTriggerPanel triggers={aiTriggers} />
          </Panel>
        </div>

        {/* Right */}
        <div style={{ flex: "0 0 300px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <Panel title="🔔 Alerts">
            {alerts.length === 0 ? (
              <p style={{ fontSize: "13px", color: MUTED, margin: 0 }}>No active alerts.</p>
            ) : (
              alerts.map((alert) => (
                <Link
                  key={alert.id}
                  href={alert.link ?? "/alerts"}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                    padding: "8px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    textDecoration: "none",
                  }}
                >
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: SEVERITY_COLOR[alert.severity],
                      marginTop: "4px",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: "12px", color: WHITE, flex: 1 }}>{truncate(alert.message, 60)}</span>
                </Link>
              ))
            )}
          </Panel>

          <Panel title="⏰ Deadlines">
            {deadlines.length === 0 ? (
              <p style={{ fontSize: "13px", color: MUTED, margin: 0 }}>No deadlines in the next 7 days.</p>
            ) : (
              deadlines.slice(0, 5).map((d) => {
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
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      textDecoration: "none",
                    }}
                  >
                    <span style={{ fontSize: "13px", color: WHITE, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {truncate(d.title, 26)}
                    </span>
                    <span
                      style={{
                        backgroundColor: overdue ? "rgba(239,68,68,0.25)" : "rgba(217,119,6,0.25)",
                        color: WHITE,
                        borderRadius: "4px",
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {label}
                    </span>
                  </Link>
                );
              })
            )}
          </Panel>
        </div>
      </div>

      {/* Bottom row — 4 columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "16px" }}>
        <Panel title="📊 Recent Activity">
          {agentDecisions.length === 0 ? (
            <p style={{ fontSize: "12px", color: MUTED, margin: 0 }}>No autonomous activity in the last 24h.</p>
          ) : (
            agentDecisions.slice(0, 5).map((decision) => (
              <div key={decision.id} style={{ display: "flex", gap: "8px", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    backgroundColor: decisionDotColor(decision.agent_id),
                    marginTop: "5px",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: WHITE }}>{humanizeEnum(decision.decision_type)}</div>
                  <div style={{ fontSize: "11px", color: MUTED }}>{truncate(decision.reasoning, 48)}</div>
                </div>
                <span style={{ fontSize: "10px", color: MUTED, flexShrink: 0 }}>{formatRelative(decision.created_at)}</span>
              </div>
            ))
          )}
        </Panel>

        <Panel title="📈 Performance">
          {[
            { label: "Opportunities Reviewed", value: reviewedOpportunities, total: totalOpportunities, color: CYAN },
            { label: "Drafts Generated", value: draftsCount, total: Math.max(applications.length, 1), color: PURPLE },
            { label: "KB Completeness", value: twinCompletenessScore, total: 100, color: GREEN },
            { label: "Avg Confidence", value: avgConfidence, total: 100, color: AMBER },
          ].map((bar) => {
            const pct = bar.total > 0 ? Math.min(100, Math.round((bar.value / bar.total) * 100)) : 0;
            return (
              <div key={bar.label} style={{ marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: WHITE, marginBottom: "4px" }}>
                  <span>{bar.label}</span>
                  <span style={{ fontWeight: 700 }}>{pct}%</span>
                </div>
                <div style={{ height: "6px", borderRadius: "3px", backgroundColor: "rgba(255,255,255,0.08)" }}>
                  <div style={{ height: "100%", width: `${pct}%`, borderRadius: "3px", backgroundColor: bar.color }} />
                </div>
              </div>
            );
          })}
        </Panel>

        <Panel title="🧭 Opportunity Mix">
          {opportunityMix.length === 0 ? (
            <p style={{ fontSize: "12px", color: MUTED, margin: 0 }}>No opportunities to chart yet.</p>
          ) : (
            opportunityMix.map((mix, i) => (
              <div key={mix.label} style={{ marginBottom: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: WHITE, marginBottom: "4px" }}>
                  <span>{mix.label}</span>
                  <span style={{ fontWeight: 700 }}>{mix.count}</span>
                </div>
                <div style={{ height: "6px", borderRadius: "3px", backgroundColor: "rgba(255,255,255,0.08)" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round((mix.count / maxMixCount) * 100)}%`,
                      borderRadius: "3px",
                      backgroundColor: MIX_COLORS[i % MIX_COLORS.length],
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </Panel>

        <Panel title="💚 Platform Health">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <PlatformHealthDonut
              outerPct={automationSuccessRate ?? 0}
              innerPct={twinCompletenessScore}
              outerColor={TEAL}
              innerColor={GREEN}
            />
            <div style={{ fontSize: "11px", color: WHITE, display: "flex", gap: "14px" }}>
              <span>
                <span style={{ color: TEAL, fontWeight: 700 }}>●</span> AutoApply {automationSuccessRate ?? 0}%
              </span>
              <span>
                <span style={{ color: GREEN, fontWeight: 700 }}>●</span> KB {twinCompletenessScore}%
              </span>
            </div>
          </div>
        </Panel>
      </div>

      {/* Status bar */}
      <div
        style={{
          background: "#060D1A",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "0 0 8px 8px",
          padding: "10px 24px",
          marginTop: "16px",
          display: "flex",
          alignItems: "center",
          gap: "20px",
        }}
      >
        {statusDots.map((dot) => (
          <div key={dot.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: dot.color, flexShrink: 0 }} />
            <span style={{ fontSize: "11px", color: WHITE }}>{dot.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlatformHealthDonut({
  outerPct,
  innerPct,
  outerColor,
  innerColor,
}: {
  outerPct: number;
  innerPct: number;
  outerColor: string;
  innerColor: string;
}) {
  const size = 120;
  const center = size / 2;
  const outerR = 52;
  const innerR = 36;
  const outerCirc = 2 * Math.PI * outerR;
  const innerCirc = 2 * Math.PI * innerR;
  const outerDash = (outerPct / 100) * outerCirc;
  const innerDash = (innerPct / 100) * innerCirc;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={center} cy={center} r={outerR} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={10} />
      <circle
        cx={center}
        cy={center}
        r={outerR}
        fill="none"
        stroke={outerColor}
        strokeWidth={10}
        strokeDasharray={`${outerDash} ${outerCirc}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${center} ${center})`}
      />
      <circle cx={center} cy={center} r={innerR} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={10} />
      <circle
        cx={center}
        cy={center}
        r={innerR}
        fill="none"
        stroke={innerColor}
        strokeWidth={10}
        strokeDasharray={`${innerDash} ${innerCirc}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}
