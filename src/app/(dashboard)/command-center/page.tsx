import Link from "next/link";
import { redirect } from "next/navigation";
import { addDays, differenceInCalendarDays, format } from "date-fns";

import { createClient } from "@/lib/supabase/server";
import { hasRequiredRole, PIPELINE_STAGES } from "@/lib/utils/constants";
import type { UserRole } from "@/lib/utils/constants";
import { STAGE_LABEL } from "@/components/applications/pipeline";
import type { PipelineStage } from "@/components/applications/pipeline";
import { formatCurrency, formatDate, humanizeEnum } from "@/lib/utils/formatters";
import { LiveClock } from "@/components/command-center/LiveClock";

// Full-screen live operations view — never cache (same rationale as /dashboard).
export const dynamic = "force-dynamic";

type ApplicationRow = {
  id: string;
  stage: PipelineStage;
  requested_amount: number | null;
};

type ProbabilityRow = {
  opportunity_id: string;
  overall_score: number | null;
  confidence: string | null;
  recommendation: string | null;
  opportunities: {
    name: string;
    amount_available: number | null;
    deadline: string | null;
  } | null;
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
  status: string;
  items_processed: number | null;
  created_at: string;
};

type ForecastRow = {
  id: string;
  forecast_period: string | null;
  projected_min: number | null;
  projected_max: number | null;
  projected_most_likely: number | null;
  confidence: number | null;
  forecast_date: string | null;
};

function scoreColor(score: number): string {
  if (score >= 70) return "#10B981";
  if (score >= 40) return "#F59E0B";
  return "#EF4444";
}

function agentStatusColor(status: string): string {
  switch (status) {
    case "completed":
      return "#10B981";
    case "failed":
      return "#EF4444";
    case "running":
      return "#F59E0B";
    default:
      return "#64748B";
  }
}

function deadlineColor(days: number): string {
  if (days < 0) return "#EF4444";
  if (days <= 7) return "#F59E0B";
  return "#38BDF8";
}

const panelStyle = {
  backgroundColor: "#1E293B",
  borderRadius: "12px",
  padding: "20px",
  border: "1px solid rgba(255,255,255,0.08)",
  display: "flex",
  flexDirection: "column" as const,
  minHeight: "280px",
};

const panelHeaderStyle = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#FFFFFF",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  marginBottom: "16px",
};

const emptyStateStyle = {
  fontSize: "13px",
  color: "rgba(255,255,255,0.4)",
  padding: "24px 0",
  textAlign: "center" as const,
};

/**
 * Executive Command Center (PLATFORM_VISION_ARCHITECTURE.md Pillar 16).
 * Full-screen live operations view for owner/admin. All data is read
 * server-side, organization_id derived from the authenticated user's
 * profile (never a request param), with RLS as the second barrier.
 */
export default async function CommandCenterPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();

  if (!profile?.organization_id) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        We couldn&rsquo;t resolve your organization. Please sign in again.
      </div>
    );
  }

  if (!hasRequiredRole(profile.role as UserRole, "admin")) {
    redirect("/dashboard?notice=admin_required");
  }

  const orgId = profile.organization_id;
  const now = new Date();
  const horizon30 = format(addDays(now, 30), "yyyy-MM-dd");

  const [
    oppCountRes,
    probabilityRes,
    applicationsRes,
    discoveryMatchesRes,
    reputationAlertsRes,
    relationshipRecsRes,
    deadlinesRes,
    forecastRes,
    agentRunsRes,
  ] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId),
    supabase
      .from("opportunity_probability_scores")
      .select(
        "opportunity_id, overall_score, confidence, recommendation, opportunities(name, amount_available, deadline)",
      )
      .eq("organization_id", orgId)
      .order("overall_score", { ascending: false })
      .limit(5),
    supabase
      .from("applications")
      .select("id, stage, requested_amount")
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
      .from("relationship_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "pending"),
    supabase
      .from("deadlines")
      .select("id, title, deadline_type, due_date, application_id, opportunity_id")
      .eq("organization_id", orgId)
      .or("is_completed.is.null,is_completed.eq.false")
      .lte("due_date", horizon30)
      .order("due_date", { ascending: true })
      .limit(8),
    supabase
      .from("funding_forecasts")
      .select(
        "id, forecast_period, projected_min, projected_max, projected_most_likely, confidence, forecast_date",
      )
      .eq("org_id", orgId)
      .order("forecast_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("agent_runs")
      .select("id, agent_type, status, items_processed, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const totalOpportunities = oppCountRes.count ?? 0;
  const leaderboard = (probabilityRes.data ?? []) as unknown as ProbabilityRow[];
  const applications = (applicationsRes.data ?? []) as ApplicationRow[];
  const discoveryMatchesCount = discoveryMatchesRes.count ?? 0;
  const reputationAlertsCount = reputationAlertsRes.count ?? 0;
  const relationshipRecsCount = relationshipRecsRes.count ?? 0;
  const deadlines = (deadlinesRes.data ?? []) as DeadlineRow[];
  const forecast = (forecastRes.data ?? null) as ForecastRow | null;
  const agentRuns = (agentRunsRes.data ?? []) as AgentRunRow[];

  // --- pipeline: counts + dollar totals per stage ---------------------------
  const pipelineByStage = PIPELINE_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = { count: 0, amount: 0 };
      return acc;
    },
    {} as Record<PipelineStage, { count: number; amount: number }>,
  );
  let totalPipelineValue = 0;
  for (const app of applications) {
    if (app.stage in pipelineByStage) {
      pipelineByStage[app.stage].count += 1;
      pipelineByStage[app.stage].amount += app.requested_amount ?? 0;
      totalPipelineValue += app.requested_amount ?? 0;
    }
  }

  const priorityItems = [
    {
      label: "New Opportunities Discovered",
      count: discoveryMatchesCount,
      color: "#F59E0B",
      href: "/opportunities",
    },
    {
      label: "Reputation Alerts (Unread)",
      count: reputationAlertsCount,
      color: "#EF4444",
      href: "/intelligence/reputation",
    },
    {
      label: "Relationship Recommendations",
      count: relationshipRecsCount,
      color: "#6B48CC",
      href: "/intelligence/recommendations",
    },
  ];

  return (
    <div style={{ backgroundColor: "#0F172A", minHeight: "100vh", padding: "32px" }}>
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "24px",
        }}
      >
        <h1
          style={{
            fontSize: "22px",
            fontWeight: 800,
            color: "#FFFFFF",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Executive Command Center
        </h1>
        <LiveClock />
      </div>

      {/* 6-panel grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "20px",
        }}
      >
        {/* Panel 1: Live Pipeline */}
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>Live Pipeline</div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "12px",
              paddingBottom: "12px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>
              {applications.length} application{applications.length === 1 ? "" : "s"}
            </span>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "#38BDF8" }}>
              {formatCurrency(totalPipelineValue)}
            </span>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {PIPELINE_STAGES.map((stage) => {
              const row = pipelineByStage[stage];
              if (row.count === 0) return null;
              return (
                <div
                  key={stage}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.85)" }}>
                    {STAGE_LABEL[stage]}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "#FFFFFF",
                        backgroundColor: "rgba(255,255,255,0.12)",
                        borderRadius: "999px",
                        padding: "2px 8px",
                      }}
                    >
                      {row.count}
                    </span>
                    <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", minWidth: "70px", textAlign: "right" }}>
                      {formatCurrency(row.amount)}
                    </span>
                  </span>
                </div>
              );
            })}
            {applications.length === 0 && <div style={emptyStateStyle}>No applications in the pipeline yet.</div>}
          </div>
        </div>

        {/* Panel 2: Today's Priorities */}
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>Today&rsquo;s Priorities</div>
          <div style={{ flex: 1 }}>
            {priorityItems.map((item) => (
              <Link key={item.label} href={item.href} style={{ textDecoration: "none", display: "block" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "12px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, backgroundColor: item.color }} />
                  <div style={{ flex: 1, fontSize: "13px", color: "rgba(255,255,255,0.85)" }}>{item.label}</div>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#FFFFFF",
                      backgroundColor: item.color,
                      borderRadius: "999px",
                      padding: "3px 10px",
                      minWidth: "24px",
                      textAlign: "center",
                    }}
                  >
                    {item.count}
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div style={{ marginTop: "8px", fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
            {totalOpportunities} total opportunit{totalOpportunities === 1 ? "y" : "ies"} tracked
          </div>
        </div>

        {/* Panel 3: Grant Probability Leaderboard */}
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>Grant Probability Leaderboard</div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {leaderboard.length === 0 && (
              <div style={emptyStateStyle}>No scored opportunities yet.</div>
            )}
            {leaderboard.map((row, index) => {
              const score = row.overall_score ?? 0;
              return (
                <Link
                  key={row.opportunity_id}
                  href={`/opportunities/${row.opportunity_id}`}
                  style={{ textDecoration: "none", display: "block" }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "rgba(255,255,255,0.4)", width: "16px" }}>
                      {index + 1}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "13px",
                          color: "rgba(255,255,255,0.9)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {row.opportunities?.name ?? "Untitled opportunity"}
                      </div>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>
                        {formatCurrency(row.opportunities?.amount_available ?? null)}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#0F172A",
                        backgroundColor: scoreColor(score),
                        borderRadius: "999px",
                        padding: "3px 10px",
                      }}
                    >
                      {score}%
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Panel 4: Upcoming Deadlines */}
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>Upcoming Deadlines (30 Days)</div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {deadlines.length === 0 && (
              <div style={emptyStateStyle}>Nothing due in the next 30 days.</div>
            )}
            {deadlines.map((d) => {
              const days = differenceInCalendarDays(new Date(d.due_date), now);
              const href = d.application_id
                ? `/applications/${d.application_id}`
                : d.opportunity_id
                  ? `/opportunities/${d.opportunity_id}`
                  : "/deadlines";
              return (
                <Link key={d.id} href={href} style={{ textDecoration: "none", display: "block" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "13px",
                          color: "rgba(255,255,255,0.9)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {d.title}
                      </div>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>
                        {humanizeEnum(d.deadline_type)} &middot; {formatDate(d.due_date)}
                      </div>
                    </div>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: deadlineColor(days), flexShrink: 0 }}>
                      {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Panel 5: AI Agent Status */}
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>AI Agent Status</div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {agentRuns.length === 0 && (
              <div style={emptyStateStyle}>No agent runs recorded yet.</div>
            )}
            {agentRuns.map((run) => (
              <div
                key={run.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.9)" }}>
                    {humanizeEnum(run.agent_type)}
                  </div>
                  <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)" }}>
                    {formatDate(run.created_at)}
                    {run.items_processed != null ? ` · ${run.items_processed} processed` : ""}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color: agentStatusColor(run.status),
                    border: `1px solid ${agentStatusColor(run.status)}`,
                    borderRadius: "999px",
                    padding: "2px 8px",
                    flexShrink: 0,
                    textTransform: "capitalize",
                  }}
                >
                  {run.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Panel 6: Funding Forecast */}
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>Funding Forecast (90 Days)</div>
          {forecast ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Most Likely
              </div>
              <div style={{ fontSize: "32px", fontWeight: 800, color: "#10B981", marginBottom: "12px" }}>
                {formatCurrency(forecast.projected_most_likely)}
              </div>
              <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", marginBottom: "4px" }}>
                Range: {formatCurrency(forecast.projected_min)} &ndash; {formatCurrency(forecast.projected_max)}
              </div>
              {forecast.confidence != null && (
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", marginBottom: "4px" }}>
                  Confidence: {forecast.confidence}%
                </div>
              )}
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "8px" }}>
                As of {formatDate(forecast.forecast_date)}
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={emptyStateStyle}>No forecast data available yet.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
