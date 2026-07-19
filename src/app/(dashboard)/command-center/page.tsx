import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkPermission } from "@/lib/auth/role-gate";
import { formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import { LiveClock } from "@/components/command-center/LiveClock";

// Platform Command Center (PLATFORM_VISION_ARCHITECTURE.md Pillar 16). Owner-only
// (BLUEPRINT §3.2 role hierarchy — owner is the top rank; this codebase has no
// separate super_admin role). Unlike the org-scoped /dashboard, every query below
// uses the service-role client with no organization_id filter — by design, not an
// oversight — mirroring the existing cross-tenant precedent in /admin/page.tsx and
// /api/admin/monitor.
export const dynamic = "force-dynamic";

type OrgLite = {
  id: string;
  name: string;
};

type AgentRunRow = {
  id: string;
  organization_id: string;
  agent_type: string;
  status: string;
  items_processed: number | null;
  duration_ms: number | null;
  created_at: string;
};

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

const statCardStyle = {
  backgroundColor: "#FFFFFF",
  borderRadius: "16px",
  overflow: "hidden",
  boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
};

function statTopBand(color: string) {
  return { height: "6px", backgroundColor: color };
}

const panelStyle = {
  backgroundColor: "#FFFFFF",
  borderRadius: "16px",
  overflow: "hidden",
  boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
  display: "flex",
  flexDirection: "column" as const,
  minHeight: "320px",
};

const panelHeaderStyle = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#FFFFFF",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  backgroundColor: "#1A2B3C",
  padding: "14px 20px",
  margin: 0,
};

const panelBodyStyle = {
  padding: "16px 20px",
  flex: 1,
  overflowY: "auto" as const,
};

const emptyStateStyle = {
  fontSize: "13px",
  color: "#94A3B8",
  padding: "24px 0",
  textAlign: "center" as const,
};

const thStyle = {
  padding: "10px 16px",
  textAlign: "left" as const,
  fontSize: "11px",
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  borderBottom: "1px solid #E2E8F0",
};

const tdStyle = {
  padding: "12px 16px",
  fontSize: "13px",
  color: "#334155",
  borderBottom: "1px solid #F1F5F9",
};

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div style={statCardStyle}>
      <div style={statTopBand(color)} />
      <div style={{ padding: "20px" }}>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: "28px", fontWeight: 900, color: "#0F172A", marginTop: "4px" }}>
          {value.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({
  label,
  numerator,
  denominator,
  color,
}: {
  label: string;
  numerator: number;
  denominator: number;
  color: string;
}) {
  const pct = denominator > 0 ? Math.min(100, Math.round((numerator / denominator) * 100)) : 0;
  return (
    <div style={{ marginBottom: "18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>{label}</span>
        <span style={{ fontSize: "12px", fontWeight: 700, color: "#0F172A" }}>
          {numerator.toLocaleString()} / {denominator.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div style={{ height: "8px", borderRadius: "999px", backgroundColor: "#E2E8F0", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: "999px" }} />
      </div>
    </div>
  );
}

const quickActions = [
  { label: "Platform Admin", href: "/admin" },
  { label: "System Monitor", href: "/admin/monitor" },
  { label: "Audit Log", href: "/admin/audit-log" },
  { label: "Sales Outreach", href: "/admin/sales-outreach" },
  { label: "AutoApply Ops", href: "/admin/autoapply-ops" },
  { label: "Agent Improvements", href: "/admin/improvements" },
];

export default async function CommandCenterPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { allowed } = await checkPermission(user.id, "owner", supabase);
  if (!allowed) {
    redirect("/dashboard?notice=owner_required");
  }

  const admin = createAdminClient();

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    orgsOnboardedRes,
    activeSubsRes,
    totalOppsRes,
    totalAppsRes,
    pendingDraftsRes,
    agentRuns24hRes,
    agentDecisions24hRes,
    agentDecisions7dRes,
    recentAgentRunsRes,
    foundationTotalRes,
    foundation990Res,
    foundationWebRes,
    orgsRes,
  ] = await Promise.all([
    admin
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("onboarding_completed", true),
    admin
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    admin.from("opportunities").select("id", { count: "exact", head: true }),
    admin.from("applications").select("id", { count: "exact", head: true }),
    admin
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("auto_generated", true)
      .eq("pending_review", true),
    admin.from("agent_runs").select("items_processed").gte("created_at", since24h),
    admin
      .from("agent_decisions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since24h),
    admin.from("agent_decisions").select("org_id").gte("created_at", since7d),
    admin
      .from("agent_runs")
      .select("id, organization_id, agent_type, status, items_processed, duration_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    admin.from("foundation_directory").select("id", { count: "exact", head: true }),
    admin
      .from("foundation_directory")
      .select("id", { count: "exact", head: true })
      .not("enriched_990_at", "is", null),
    admin
      .from("foundation_directory")
      .select("id", { count: "exact", head: true })
      .not("enriched_web_at", "is", null),
    admin.from("organizations").select("id, name"),
  ]);

  const totalOrgsOnboarded = orgsOnboardedRes.count ?? 0;
  const activeSubscriptions = activeSubsRes.count ?? 0;
  const totalOpportunities = totalOppsRes.count ?? 0;
  const totalApplications = totalAppsRes.count ?? 0;
  const pendingDrafts = pendingDraftsRes.count ?? 0;

  const agentRuns24hRows = (agentRuns24hRes.data ?? []) as { items_processed: number | null }[];
  const agentRunsLast24h = agentRuns24hRows.length;
  const itemsProcessedLast24h = agentRuns24hRows.reduce(
    (sum, r) => sum + (r.items_processed ?? 0),
    0,
  );

  const agentDecisionsLast24h = agentDecisions24hRes.count ?? 0;

  const decisions7d = (agentDecisions7dRes.data ?? []) as { org_id: string }[];
  const recentAgentRuns = (recentAgentRunsRes.data ?? []) as AgentRunRow[];
  const orgs = (orgsRes.data ?? []) as OrgLite[];
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

  const foundationTotal = foundationTotalRes.count ?? 0;
  const foundation990Count = foundation990Res.count ?? 0;
  const foundationWebCount = foundationWebRes.count ?? 0;

  const decisionCountByOrg = new Map<string, number>();
  for (const d of decisions7d) {
    decisionCountByOrg.set(d.org_id, (decisionCountByOrg.get(d.org_id) ?? 0) + 1);
  }
  const topOrgs = Array.from(decisionCountByOrg.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([orgId, count]) => ({
      orgId,
      name: orgNameById.get(orgId) ?? "Unknown org",
      count,
    }));

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh", padding: "32px" }}>
      {/* Header */}
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
            fontSize: "28px",
            fontWeight: 800,
            color: "#1A2B3C",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          Platform Command Center
        </h1>
        <LiveClock />
      </div>

      {/* Row 1: stat cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "16px",
          marginBottom: "20px",
        }}
      >
        <StatCard label="Total Orgs" value={totalOrgsOnboarded} color="#1A2B3C" />
        <StatCard label="Active Subscriptions" value={activeSubscriptions} color="#10B981" />
        <StatCard label="Total Opportunities" value={totalOpportunities} color="#0EA5E9" />
        <StatCard label="Total Applications" value={totalApplications} color="#8B5CF6" />
        <StatCard label="AI Drafts Pending" value={pendingDrafts} color="#F59E0B" />
      </div>

      {/* Row 2: 3-column panels */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "20px",
          marginBottom: "20px",
        }}
      >
        {/* AI Pipeline Status */}
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>AI Pipeline Status</div>
          <div style={panelBodyStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "14px",
                paddingBottom: "12px",
                borderBottom: "1px solid #E2E8F0",
              }}
            >
              <div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#0F172A" }}>
                  {agentRunsLast24h.toLocaleString()}
                </div>
                <div style={{ fontSize: "11px", color: "#64748B" }}>runs (24h)</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#0F172A" }}>
                  {itemsProcessedLast24h.toLocaleString()}
                </div>
                <div style={{ fontSize: "11px", color: "#64748B" }}>items processed (24h)</div>
              </div>
            </div>
            <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "10px" }}>
              {agentDecisionsLast24h.toLocaleString()} agent decisions logged (24h)
            </div>
            {recentAgentRuns.length === 0 ? (
              <div style={emptyStateStyle}>No agent runs recorded yet.</div>
            ) : (
              recentAgentRuns.slice(0, 5).map((run) => (
                <div
                  key={run.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "10px",
                    padding: "8px 0",
                    borderBottom: "1px solid #F1F5F9",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#334155",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {humanizeEnum(run.agent_type)}
                    </div>
                    <div style={{ fontSize: "11px", color: "#94A3B8" }}>
                      {orgNameById.get(run.organization_id) ?? "Unknown org"}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: "10px",
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
              ))
            )}
          </div>
        </div>

        {/* Data Intelligence Status */}
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>Data Intelligence Status</div>
          <div style={panelBodyStyle}>
            <div style={{ fontSize: "11px", color: "#64748B", marginBottom: "16px" }}>
              {foundationTotal.toLocaleString()} foundation directory records
            </div>
            <ProgressBar
              label="IRS 990 Enriched"
              numerator={foundation990Count}
              denominator={foundationTotal}
              color="#0077B6"
            />
            <ProgressBar
              label="Website Enriched"
              numerator={foundationWebCount}
              denominator={foundationTotal}
              color="#00B4D8"
            />
          </div>
        </div>

        {/* Most Active Orgs */}
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>Most Active Orgs (7d)</div>
          <div style={panelBodyStyle}>
            {topOrgs.length === 0 ? (
              <div style={emptyStateStyle}>No agent activity in the last 7 days.</div>
            ) : (
              topOrgs.map((org, index) => (
                <div
                  key={org.orgId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px 0",
                    borderBottom: "1px solid #F1F5F9",
                  }}
                >
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#94A3B8", width: "16px" }}>
                    {index + 1}
                  </span>
                  <Link
                    href={`/admin/orgs/${org.orgId}`}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: "13px",
                      color: "#0077B6",
                      fontWeight: 600,
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {org.name}
                  </Link>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#FFFFFF",
                      backgroundColor: "#6B48CC",
                      borderRadius: "999px",
                      padding: "3px 10px",
                    }}
                  >
                    {org.count}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Admin Quick Actions */}
      <div
        style={{
          backgroundColor: "#0077B6",
          borderRadius: "16px",
          padding: "24px",
          marginBottom: "20px",
          boxShadow: "0 4px 16px rgba(0,119,182,0.3)",
        }}
      >
        <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#FFFFFF", marginBottom: "16px" }}>
          Admin Quick Actions
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              style={{
                display: "block",
                padding: "12px 16px",
                backgroundColor: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "8px",
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: 600,
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Row 4: Recent Agent Runs table */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "16px",
          overflow: "hidden",
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        }}
      >
        <div style={panelHeaderStyle}>Recent Agent Runs — All Orgs</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Organization</th>
                <th style={thStyle}>Agent</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Items Processed</th>
                <th style={thStyle}>Duration</th>
                <th style={thStyle}>Started</th>
              </tr>
            </thead>
            <tbody>
              {recentAgentRuns.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={6}>
                    No agent runs recorded yet.
                  </td>
                </tr>
              ) : (
                recentAgentRuns.map((run) => (
                  <tr key={run.id}>
                    <td style={tdStyle}>{orgNameById.get(run.organization_id) ?? "Unknown org"}</td>
                    <td style={tdStyle}>{humanizeEnum(run.agent_type)}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: agentStatusColor(run.status),
                          border: `1px solid ${agentStatusColor(run.status)}`,
                          borderRadius: "999px",
                          padding: "2px 8px",
                          textTransform: "capitalize",
                        }}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td style={tdStyle}>{run.items_processed ?? "-"}</td>
                    <td style={tdStyle}>
                      {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : "-"}
                    </td>
                    <td style={tdStyle}>
                      {formatDate(run.created_at)} · {formatRelative(run.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
