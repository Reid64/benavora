import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addDays, differenceInCalendarDays, format, subMonths } from "date-fns";

import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import {
  computeSectionScores,
  SECTION_KEYS,
  SECTION_LABELS,
  type ExtendedProfile,
  type OrganizationProfileFields,
} from "@/lib/knowledge-base/profile";
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

type BoardMemberRow = { id: string; bio: string | null };
type ProgramRow = { id: string; description: string | null };
type FoundationRow = { id: string; name: string; asset_amount: number | null };
type IntelligenceProposalRow = { funder_type: string | null; created_at: string };

type OrgProfileRow = {
  name: string;
  onboarding_progress: { completed_steps?: string[] } | null;
  ein: string | null;
  tax_status: string | null;
  mission_statement: string | null;
  vision_statement: string | null;
  founding_date: string | null;
  founder_name: string | null;
  founder_bio: string | null;
  service_area: string | null;
  target_population: string | null;
  annual_budget: number | null;
  total_staff: number | null;
  total_volunteers: number | null;
  extended_profile: ExtendedProfile | null;
};

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

type KpiTrend = "UP" | "DOWN" | "NEUTRAL" | "NONE";

const TREND_META: Record<KpiTrend, { label: string; arrow: string; color: string }> = {
  UP: { label: "UP", arrow: "↑", color: "#34D399" },
  DOWN: { label: "DOWN", arrow: "↓", color: "#EF4444" },
  NEUTRAL: { label: "NEUTRAL", arrow: "→", color: "#FCD34D" },
  NONE: { label: "--", arrow: "—", color: "rgba(255,255,255,0.3)" },
};

type Kpi = { name: string; value: string; trend: KpiTrend; goal: string; goalMet: boolean | null };

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

function deadlineChipLabel(dueDate: string, now: Date): { label: string; overdue: boolean } {
  const days = differenceInCalendarDays(new Date(dueDate), now);
  const overdue = days <= 0;
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d`;
  return { label, overdue };
}

// Buckets the real opportunity_source_type enum (migration 010) into the 4
// funding-activity categories the chart shows — the task-given `category`/
// `source` fields don't exist on `opportunities`; source_type is the real
// physical column (see benavora-two-source-type-concepts memory).
type FundingActivityBucket = "federal" | "foundation" | "state" | "corporate" | "other";

function fundingActivityBucket(sourceType: string | null): FundingActivityBucket {
  if (sourceType === "government_federal") return "federal";
  if (sourceType === "government_state" || sourceType === "government_local") return "state";
  if (sourceType === "private_foundation" || sourceType === "community_foundation") return "foundation";
  if (sourceType === "corporate_giving") return "corporate";
  return "other";
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

function Panel({
  title,
  accent,
  children,
  style,
}: {
  title: string;
  accent: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ ...panelStyle, borderLeft: `3px solid ${accent}`, ...style }}>
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
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sixMonthsAgo = subMonths(now, 6).toISOString();

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
    automationSessionsRecentRes,
    automationSessionLastRes,
    alertsRes,
    boardMembersRes,
    programsRes,
    taxDocumentCountRes,
    foundationTotalRes,
    topFoundationsRes,
    intelligenceLibraryCountRes,
    intelligenceLibraryTypesRes,
    donorDiscoveryCountRes,
    automationSessions24hRes,
    oppByCategoryRes,
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select(
        "name, onboarding_progress, ein, tax_status, mission_statement, vision_statement, founding_date, founder_name, founder_bio, service_area, target_population, annual_budget, total_staff, total_volunteers, extended_profile",
      )
      .eq("id", orgId)
      .single(),
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
    supabase
      .from("automation_sessions")
      .select("id, status")
      .eq("organization_id", orgId)
      .gte("created_at", thirtyDaysAgo),
    supabase
      .from("automation_sessions")
      .select("id, status, created_at, target_url")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("alerts")
      .select("id, type, severity, message, link, created_at")
      .eq("organization_id", orgId)
      .eq("is_dismissed", false)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("board_members").select("id, bio").eq("organization_id", orgId),
    supabase.from("programs").select("id, description").eq("organization_id", orgId),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("category", "tax_documents"),
    supabase.from("foundation_directory").select("id", { count: "exact", head: true }),
    supabase
      .from("foundation_directory")
      .select("id, name, asset_amount")
      .order("asset_amount", { ascending: false, nullsFirst: false })
      .limit(3),
    supabase.from("intelligence_funded_proposals").select("id", { count: "exact", head: true }),
    supabase.from("intelligence_funded_proposals").select("funder_type, created_at"),
    supabase
      .from("donor_discovery_prospects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    // Change 2 (AutoApply trigger card) — a dedicated 24h count; the existing
    // automationSessionsRecentRes above is 30-day scoped for other cards.
    supabase
      .from("automation_sessions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .gte("created_at", twentyFourHoursAgo),
    // Change 1 (Funding Activity chart) — org + 6-month scoped, separate from
    // oppSourceTypesRes above (all-time, org-wide) so the existing
    // "Opportunity Mix" panel's meaning is untouched.
    supabase
      .from("opportunities")
      .select("source_type")
      .eq("organization_id", orgId)
      .gte("created_at", sixMonthsAgo),
  ]);

  const orgRow = organizationRes.data as OrgProfileRow | null;
  const orgName = orgRow?.name ?? "Your Organization";
  const completedSteps = orgRow?.onboarding_progress?.completed_steps ?? [];

  const applications = (applicationsRes.data ?? []) as ApplicationRow[];
  const deadlines = (deadlinesRes.data ?? []) as DeadlineRow[];
  const agentDecisions = (agentDecisionsRes.data ?? []) as AgentDecisionRow[];
  const strategicRecommendations = (strategicRecommendationsRes.data ?? []) as StrategicRecommendationRow[];
  const totalOpportunities = oppCountRes.count ?? 0;
  const openOpportunities = oppOpenCountRes.count ?? 0;
  const reviewedOpportunities = Math.max(totalOpportunities - openOpportunities, 0);
  const topOpportunities = (topOpportunitiesRes.data ?? []) as TopOpportunityRow[];
  const oppSourceTypes = (oppSourceTypesRes.data ?? []) as { source_type: string | null }[];
  const automationSessionsRecent = (automationSessionsRecentRes.data ?? []) as AutomationSessionRow[];
  const automationSessionLast = automationSessionLastRes.data as AutomationSessionDetail | null;
  const alerts = (alertsRes.data ?? []) as AlertRow[];
  const boardMembers = (boardMembersRes.data ?? []) as BoardMemberRow[];
  const programs = (programsRes.data ?? []) as ProgramRow[];
  const taxDocumentCount = taxDocumentCountRes.count ?? 0;
  const foundationTotal = foundationTotalRes.count ?? 0;
  const topFoundations = (topFoundationsRes.data ?? []) as FoundationRow[];
  const intelligenceLibraryCount = intelligenceLibraryCountRes.count ?? 0;
  const intelligenceLibraryRows = (intelligenceLibraryTypesRes.data ?? []) as IntelligenceProposalRow[];
  const donorDiscoveryCount = donorDiscoveryCountRes.count ?? 0;
  const automationSessions24hCount = automationSessions24hRes.count ?? 0;
  const oppByCategory = (oppByCategoryRes.data ?? []) as { source_type: string | null }[];

  // --- second-wave lookups (depend on first wave's ids) -----------------------
  const funderIds = [...new Set(topOpportunities.map((o) => o.funder_id).filter((id): id is string => Boolean(id)))];

  const [funderNamesRes] = await Promise.all([
    funderIds.length > 0
      ? supabase.from("funders").select("id, name").in("id", funderIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const funderNameById = new Map((funderNamesRes.data ?? []).map((f) => [f.id, f.name]));

  // --- knowledge base completeness (live-computed, not the onboarding wizard) -
  const orgProfileFields: OrganizationProfileFields = {
    name: orgRow?.name ?? "",
    ein: orgRow?.ein ?? null,
    tax_status: orgRow?.tax_status ?? null,
    mission_statement: orgRow?.mission_statement ?? null,
    vision_statement: orgRow?.vision_statement ?? null,
    founding_date: orgRow?.founding_date ?? null,
    founder_name: orgRow?.founder_name ?? null,
    founder_bio: orgRow?.founder_bio ?? null,
    service_area: orgRow?.service_area ?? null,
    target_population: orgRow?.target_population ?? null,
    annual_budget: orgRow?.annual_budget ?? null,
    total_staff: orgRow?.total_staff ?? null,
    total_volunteers: orgRow?.total_volunteers ?? null,
  };
  const extendedProfile: ExtendedProfile = orgRow?.extended_profile ?? {};
  const sectionScores = computeSectionScores({
    org: orgProfileFields,
    extended: extendedProfile,
    boardMemberCount: boardMembers.length,
    boardMembersWithBio: boardMembers.filter((b) => Boolean(b.bio)).length,
    programCount: programs.length,
    programsWithDescription: programs.filter((p) => Boolean(p.description)).length,
    taxDocumentCount,
  });
  const sectionEntries = SECTION_KEYS.map((key) => ({ key, label: SECTION_LABELS[key], score: sectionScores[key] }));
  const incompleteSections = sectionEntries.filter((s) => s.score < 100);
  const kbCompleteness = Math.round(sectionEntries.reduce((sum, s) => sum + s.score, 0) / sectionEntries.length);

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
  const agentActivityScore = Math.min(agentDecisions.length * 10, 100);
  const platformHealthScore = Math.round(kbCompleteness * 0.4 + avgConfidence * 0.4 + agentActivityScore * 0.2);

  const automationSubmitted = automationSessionsRecent.filter((s) => s.status === "submitted").length;
  const automationTerminal = automationSessionsRecent.filter((s) =>
    ["submitted", "failed", "cancelled"].includes(s.status),
  ).length;
  const automationSuccessRate =
    automationTerminal > 0 ? Math.round((automationSubmitted / automationTerminal) * 100) : null;

  const overdueDeadlines = deadlines.filter((d) => new Date(d.due_date) < now);
  const dueThisWeek = deadlines.filter((d) => {
    const days = differenceInCalendarDays(new Date(d.due_date), now);
    return days >= 0 && days <= 7;
  });
  const nextFourDeadlines = deadlines.slice(0, 4);

  const funderTypeCounts = new Map<string, number>();
  let lastImportDate: string | null = null;
  for (const row of intelligenceLibraryRows) {
    const key = row.funder_type ?? "Unclassified";
    funderTypeCounts.set(key, (funderTypeCounts.get(key) ?? 0) + 1);
    if (!lastImportDate || row.created_at > lastImportDate) lastImportDate = row.created_at;
  }
  const topFunderTypes = [...funderTypeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  const sourceTypeCounts = new Map<string, number>();
  for (const row of oppSourceTypes) {
    const key = row.source_type ?? "unclassified";
    sourceTypeCounts.set(key, (sourceTypeCounts.get(key) ?? 0) + 1);
  }
  const opportunityMix = [...sourceTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([sourceType, count]) => ({ label: humanizeEnum(sourceType), count }));
  const maxMixCount = Math.max(1, ...opportunityMix.map((m) => m.count));

  // --- Change 1: Funding Activity chart (opportunities by source, last 6 months) ---
  const fundingActivityCounts: Record<FundingActivityBucket, number> = {
    federal: 0,
    foundation: 0,
    state: 0,
    corporate: 0,
    other: 0,
  };
  for (const row of oppByCategory) {
    fundingActivityCounts[fundingActivityBucket(row.source_type)]++;
  }
  const fundingActivityTotal = Object.values(fundingActivityCounts).reduce((sum, n) => sum + n, 0);
  const FUNDING_ACTIVITY_BARS: { key: FundingActivityBucket; label: string; color: string }[] = [
    { key: "federal", label: "Federal", color: ROYAL },
    { key: "foundation", label: "Foundation", color: PURPLE },
    { key: "state", label: "State", color: SKY },
    { key: "corporate", label: "Corporate", color: GREEN },
    { key: "other", label: "Other", color: AMBER },
  ];

  const topInsights = [...strategicRecommendations]
    .sort((a, b) => {
      const p = (URGENCY_PRIORITY[a.urgency] ?? 9) - (URGENCY_PRIORITY[b.urgency] ?? 9);
      return p !== 0 ? p : b.generated_at.localeCompare(a.generated_at);
    })
    .slice(0, 5);

  const MIX_COLORS = [ROYAL, SKY, CYAN, TEAL, PURPLE, AMBER, GREEN, RED];

  // --- pipeline strip -----------------------------------------------------------
  const stages = [
    { label: "Onboard", color: GREEN, value: `${completedSteps.length}/7`, href: "/onboarding" },
    { label: "Research", color: ROYAL, value: String(foundationTotal), href: "/research" },
    { label: "Opportunities", color: CYAN, value: String(totalOpportunities), href: "/opportunities", active: true },
    { label: "Narratives", color: PURPLE, value: String(draftsCount), href: "/draft-generator" },
    { label: "AutoApply", color: TEAL, value: String(automationSessionsRecent.length), href: "/autoapply" },
    { label: "Funding Secured", color: AMBER, value: String(awardedApplications.length), href: "/applications" },
  ];

  // --- flip cards -----------------------------------------------------------------
  const cards: FlipCardData[] = [
    {
      key: "knowledge-base",
      label: "KNOWLEDGE BASE",
      value: `${kbCompleteness}%`,
      sub: `${incompleteSections.length} gaps remaining`,
      frontGradient: "linear-gradient(135deg,#0B2D4A,#0D3560)",
      borderColor: "rgba(0,119,182,0.3)",
      accentGradient: "linear-gradient(90deg,#0077B6,#0EA5E9)",
      href: "/knowledge-base",
      ctaLabel: "Complete setup",
      back: (
        <div>
          {incompleteSections.length === 0 ? (
            <div style={{ fontSize: "12px", color: WHITE }}>All sections complete.</div>
          ) : (
            incompleteSections.map((section) => (
              <Link
                key={section.key}
                href="/knowledge-base"
                style={{
                  display: "block",
                  fontSize: "12px",
                  color: WHITE,
                  padding: "4px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                  textDecoration: "none",
                }}
              >
                {section.label}
              </Link>
            ))
          )}
        </div>
      ),
    },
    {
      key: "intelligence-library",
      label: "INTELLIGENCE LIBRARY",
      value: String(intelligenceLibraryCount),
      sub: "narratives indexed",
      frontGradient: "linear-gradient(135deg,#1E0A3C,#2A1050)",
      borderColor: "rgba(124,58,237,0.3)",
      accentGradient: "linear-gradient(90deg,#7C3AED,#A855F7)",
      href: "/intelligence-library",
      ctaLabel: "Open library",
      back: (
        <div style={{ fontSize: "12px", color: WHITE, display: "flex", flexDirection: "column", gap: "5px" }}>
          {topFunderTypes.length === 0 ? (
            <div>No proposals indexed yet.</div>
          ) : (
            topFunderTypes.map(([type, count]) => (
              <div key={type} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{truncate(type, 22)}</span>
                <span style={{ fontWeight: 700 }}>{count}</span>
              </div>
            ))
          )}
          {lastImportDate && <div style={{ marginTop: "4px", color: "rgba(255,255,255,0.6)" }}>Last import: {formatRelative(lastImportDate)}</div>}
        </div>
      ),
    },
    {
      key: "deadlines",
      label: "DEADLINES",
      value: String(overdueDeadlines.length),
      sub: `${dueThisWeek.length} due this week`,
      frontGradient: "linear-gradient(135deg,#2D1A00,#3A2200)",
      borderColor: "rgba(217,119,6,0.3)",
      accentGradient: "linear-gradient(90deg,#D97706,#F59E0B)",
      href: "/deadlines",
      ctaLabel: "View all deadlines",
      back: (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {nextFourDeadlines.length === 0 ? (
            <div style={{ fontSize: "12px", color: WHITE }}>No deadlines in the next 7 days.</div>
          ) : (
            nextFourDeadlines.map((d) => {
              const chip = deadlineChipLabel(d.due_date, now);
              return (
                <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "12px", color: WHITE }}>{truncate(d.title, 25)}</span>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      color: WHITE,
                      backgroundColor: chip.overdue ? "rgba(239,68,68,0.3)" : "rgba(217,119,6,0.3)",
                      borderRadius: "4px",
                      padding: "2px 6px",
                      flexShrink: 0,
                    }}
                  >
                    {chip.label}
                  </span>
                </div>
              );
            })
          )}
        </div>
      ),
    },
    {
      key: "funder-research",
      label: "FUNDER RESEARCH",
      value: String(foundationTotal),
      sub: "profiles indexed",
      frontGradient: "linear-gradient(135deg,#082838,#0A3548)",
      borderColor: "rgba(14,165,233,0.3)",
      accentGradient: "linear-gradient(90deg,#0EA5E9,#0077B6)",
      href: "/research",
      ctaLabel: "Open research",
      back: (
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          {topFoundations.length === 0 ? (
            <div style={{ fontSize: "12px", color: WHITE }}>No profiles indexed yet.</div>
          ) : (
            topFoundations.map((f) => (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: WHITE }}>
                <span>{truncate(f.name, 22)}</span>
                <span style={{ fontWeight: 700 }}>{formatCurrency(f.asset_amount)}</span>
              </div>
            ))
          )}
        </div>
      ),
    },
    {
      key: "autoapply",
      label: "AUTOAPPLY",
      value: String(automationSessionsRecent.length),
      sub: "sessions last 30 days",
      frontGradient: "linear-gradient(135deg,#082830,#0A3540)",
      borderColor: "rgba(8,145,178,0.3)",
      accentGradient: "linear-gradient(90deg,#0891B2,#06B6D4)",
      href: "/autoapply",
      ctaLabel: "View sessions",
      back: (
        <div style={{ fontSize: "12px", color: WHITE, display: "flex", flexDirection: "column", gap: "6px" }}>
          {automationSessionLast ? (
            <>
              <div>Portal: {truncate(automationSessionLast.target_url ?? "Unknown", 30)}</div>
              <div>Created: {formatRelative(automationSessionLast.created_at)}</div>
              <div>Status: {humanizeEnum(automationSessionLast.status)}</div>
            </>
          ) : (
            <div>No sessions yet.</div>
          )}
        </div>
      ),
    },
    {
      key: "platform-health",
      label: "PLATFORM HEALTH",
      value: String(platformHealthScore),
      sub: "overall readiness score",
      frontGradient: "linear-gradient(135deg,#062818,#082E1C)",
      borderColor: "rgba(16,185,129,0.3)",
      accentGradient: "linear-gradient(90deg,#10B981,#34D399)",
      href: "/knowledge-base",
      ctaLabel: "Improve score",
      back: (
        <div style={{ fontSize: "12px", color: WHITE, display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>KB score</span>
            <span style={{ fontWeight: 700 }}>{kbCompleteness}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Draft confidence</span>
            <span style={{ fontWeight: 700 }}>{avgConfidence}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Agent activity</span>
            <span style={{ fontWeight: 700 }}>{agentActivityScore}</span>
          </div>
        </div>
      ),
    },
  ];

  // --- KPI scorecard ----------------------------------------------------------------
  const kpis: Kpi[] = [
    {
      name: "Opportunities Reviewed",
      value: String(totalOpportunities),
      trend: totalOpportunities > 0 ? "UP" : "NEUTRAL",
      goal: "≥50/mo",
      goalMet: totalOpportunities >= 50,
    },
    {
      name: "Draft Confidence",
      value: `${Math.round(avgConfidence ?? 0)}/100`,
      trend: (avgConfidence ?? 0) >= 80 ? "UP" : "DOWN",
      goal: "≥80",
      goalMet: (avgConfidence ?? 0) >= 80,
    },
    {
      name: "AutoApply Sessions",
      value: String(automationSessionsRecent.length),
      trend: "NEUTRAL",
      goal: "≥5/mo",
      goalMet: automationSessionsRecent.length >= 5,
    },
    {
      name: "KB Completeness",
      value: `${kbCompleteness}%`,
      trend: "UP",
      goal: "≥90%",
      goalMet: kbCompleteness >= 90,
    },
    {
      name: "Outreach Sent",
      value: "0",
      trend: "NONE",
      goal: "≥20/mo",
      goalMet: false,
    },
    {
      name: "Win Rate",
      value: "0%",
      trend: "NONE",
      goal: "≥15%",
      goalMet: null,
    },
  ];

  // --- Change 2: AutoApply Engine trigger card -------------------------------------
  // latestSession reuses automationSessionLast (already org-scoped) rather than a
  // second, unfiltered query — an unfiltered `.single()` on automation_sessions
  // would leak another organization's most recent session.
  const autoApplySubText =
    automationSessions24hCount > 0
      ? `${automationSessions24hCount} sessions in last 24h · Last: ${(automationSessionLast?.target_url ?? "Unknown").substring(0, 30)}`
      : "No sessions in last 24h · Ready to queue";
  const autoApplyStatus: { label: string; color: string; pulse: boolean } =
    automationSessionLast?.status === "running"
      ? { label: "RUNNING", color: GREEN, pulse: true }
      : automationSessionLast?.status === "completed"
        ? { label: "LAST SESSION COMPLETE", color: GREEN, pulse: false }
        : { label: "IDLE", color: MUTED, pulse: false };

  // --- AI triggers ----------------------------------------------------------------
  const aiTriggers: AiTrigger[] = [
    {
      key: "federal-scan",
      borderColor: ROYAL,
      title: "Federal Scan",
      sub: "Pull new opportunities from grants.gov, Simpler Grants & HUD",
      yieldText: `${totalOpportunities} opportunities on file`,
      action: { kind: "post", endpoint: "/api/agents/research", body: { sources: ["grants_gov", "simpler_grants", "hud"] } },
      ctaLabel: "Run scan",
    },
    {
      key: "geo-discovery",
      borderColor: GREEN,
      title: "Geo Discovery",
      sub: "Launch a geographic donor/foundation discovery request",
      yieldText: `${donorDiscoveryCount} prospects found so far`,
      action: { kind: "link", href: "/donor-discovery/new" },
      ctaLabel: "Start discovery",
    },
    {
      key: "import-narratives",
      borderColor: PURPLE,
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
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.35; }
          100% { opacity: 1; }
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
          borderLeft: `3px solid ${CYAN}`,
          padding: "18px 22px",
          marginBottom: "18px",
        }}
      >
        <div style={{ fontSize: "15px", fontWeight: 800, color: WHITE, marginBottom: "14px" }}>Pipeline</div>
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
          <Panel title="Action Queue" accent={ROYAL}>
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

          <Panel title="Top Opportunities" accent={CYAN}>
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

          {/* Funding Activity — CSS-only bar chart, no external chart library */}
          <div
            style={{
              backgroundColor: "#0D1E35",
              borderRadius: "14px",
              border: "1px solid rgba(255,255,255,0.08)",
              marginTop: "14px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: "15px", fontWeight: 800, color: WHITE }}>Funding Activity</span>
              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
                Opportunities by source — last 6 months
              </span>
            </div>
            <div style={{ padding: "20px" }}>
              {fundingActivityTotal === 0 ? (
                <p style={{ fontSize: "13px", color: MUTED, margin: 0 }}>No opportunities in the last 6 months.</p>
              ) : (
                <>
                  {FUNDING_ACTIVITY_BARS.map((bar) => {
                    const count = fundingActivityCounts[bar.key];
                    const pct = (count / fundingActivityTotal) * 100;
                    return (
                      <div key={bar.key} style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                        <span style={{ width: "80px", flexShrink: 0, fontSize: "12px", color: WHITE }}>{bar.label}</span>
                        <div style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: "4px", overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${pct}%`,
                              height: "24px",
                              borderRadius: "4px",
                              backgroundColor: bar.color,
                              display: "flex",
                              alignItems: "center",
                              paddingLeft: "8px",
                            }}
                          />
                        </div>
                        <span style={{ width: "40px", flexShrink: 0, textAlign: "right", fontSize: "12px", fontWeight: 700, color: WHITE }}>
                          {count}
                        </span>
                      </div>
                    );
                  })}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", marginTop: "12px" }}>
                    {FUNDING_ACTIVITY_BARS.map((bar) => (
                      <div key={bar.key} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: bar.color, flexShrink: 0 }} />
                        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>{bar.label}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Center */}
        <div style={{ flex: "1" }}>
          <Panel title="AI Triggers" accent={ROYAL}>
            <AiTriggerPanel triggers={aiTriggers} />

            {/* AutoApply Engine — bespoke card (status dot + direct link), not part
                of the uniform AiTrigger shape used by the 3 cards above. */}
            <div
              style={{
                backgroundColor: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderLeft: "2px solid #0891B2",
                borderRadius: "10px",
                padding: "12px 14px",
                marginBottom: "8px",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 700, color: WHITE, marginBottom: "4px" }}>
                AutoApply Engine
              </div>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.55)", marginBottom: "6px", lineHeight: 1.4 }}>
                {autoApplySubText}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: autoApplyStatus.color,
                    flexShrink: 0,
                    ...(autoApplyStatus.pulse ? { animation: "pulse 2s infinite" } : {}),
                  }}
                />
                <span style={{ fontSize: "11px", fontWeight: 700, color: autoApplyStatus.color }}>
                  {autoApplyStatus.label}
                </span>
              </div>
              <Link
                href="/autoapply"
                style={{
                  background: "linear-gradient(135deg,#0891B2,#06B6D4)",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-block",
                  textDecoration: "none",
                }}
              >
                Open AutoApply
              </Link>
            </div>
          </Panel>
        </div>

        {/* Right */}
        <div style={{ flex: "0 0 300px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <Panel title="Alerts" accent={RED}>
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

          <Panel title="Deadlines" accent={AMBER}>
            {deadlines.length === 0 ? (
              <p style={{ fontSize: "13px", color: MUTED, margin: 0 }}>No deadlines in the next 7 days.</p>
            ) : (
              deadlines.slice(0, 5).map((d) => {
                const chip = deadlineChipLabel(d.due_date, now);
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
                        backgroundColor: chip.overdue ? "rgba(239,68,68,0.25)" : "rgba(217,119,6,0.25)",
                        color: WHITE,
                        borderRadius: "4px",
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {chip.label}
                    </span>
                  </Link>
                );
              })
            )}
          </Panel>
        </div>
      </div>

      {/* KPI Scorecard */}
      <div
        style={{
          backgroundColor: CARD_BG,
          borderRadius: "14px",
          border: "1px solid rgba(255,255,255,0.08)",
          marginTop: "14px",
          overflow: "hidden",
          borderLeft: `3px solid ${ROYAL}`,
        }}
      >
        <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "15px", fontWeight: 800, color: WHITE }}>Platform KPI Scorecard</span>
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", marginLeft: "auto" }}>Trend vs Goal</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0" }}>
          {kpis.map((kpi, i) => {
            const isRightEdge = (i + 1) % 3 === 0;
            const isBottomRow = i >= 3;
            const trendMeta = TREND_META[kpi.trend];
            const goalColor = kpi.goalMet === true ? "#34D399" : kpi.goalMet === false ? "#EF4444" : "rgba(255,255,255,0.3)";
            const goalMark = kpi.goalMet === true ? "✓" : kpi.goalMet === false ? "✗" : "—";
            return (
              <div
                key={kpi.name}
                style={{
                  padding: "16px 18px",
                  borderRight: isRightEdge ? "none" : "1px solid rgba(255,255,255,0.06)",
                  borderBottom: isBottomRow ? "none" : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.45)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: "8px",
                  }}
                >
                  {kpi.name}
                </div>
                <div style={{ fontSize: "30px", fontWeight: 900, color: WHITE, lineHeight: 1, marginBottom: "10px" }}>{kpi.value}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: "9px", fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      TREND
                    </div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: trendMeta.color }}>
                      {trendMeta.arrow} {trendMeta.label}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "9px", fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      GOAL
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                      <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>{kpi.goal}</span>
                      <span style={{ fontSize: "13px", fontWeight: 700, marginLeft: "6px", color: goalColor }}>{goalMark}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom row — 4 columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "16px", marginTop: "16px" }}>
        <Panel title="Recent Activity" accent={SKY}>
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

        <Panel title="Performance" accent={PURPLE}>
          {[
            { label: "Opportunities Reviewed", value: reviewedOpportunities, total: totalOpportunities, color: CYAN },
            { label: "Drafts Generated", value: draftsCount, total: Math.max(applications.length, 1), color: PURPLE },
            { label: "KB Completeness", value: kbCompleteness, total: 100, color: GREEN },
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

        <Panel title="Opportunity Mix" accent={TEAL}>
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

        <Panel title="Platform Health" accent={GREEN}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <PlatformHealthDonut
              outerPct={automationSuccessRate ?? 0}
              innerPct={kbCompleteness}
              outerColor={TEAL}
              innerColor={GREEN}
            />
            <div style={{ fontSize: "11px", color: WHITE, display: "flex", gap: "14px" }}>
              <span>
                <span style={{ color: TEAL, fontWeight: 700 }}>●</span> AutoApply {automationSuccessRate ?? 0}%
              </span>
              <span>
                <span style={{ color: GREEN, fontWeight: 700 }}>●</span> KB {kbCompleteness}%
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
