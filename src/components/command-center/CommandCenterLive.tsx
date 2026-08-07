"use client";

// Live-refreshing body of the Platform Command Center
// (src/app/(dashboard)/command-center/page.tsx). Renders the stat cards, the
// 3-panel row, and the Recent Agent Runs table, seeded with the server's
// initial cross-org snapshot and kept fresh via Supabase Realtime.
//
// RLS-vs-Realtime scope caveat (read before changing the subscription list):
// Supabase Realtime enforces the same RLS policies as a normal REST read.
// agent_runs ("agent_runs_org_isolation"), agent_decisions ("decisions_org"),
// and applications ("applications_org_isolation") are all scoped to
// `organization_id = current_org_id()` / the caller's own profile row - see
// supabase/migrations/001_initial_schema.sql and
// src/supabase/migrations/080_autonomous_agent_infrastructure.sql. This page
// is gated on profiles.role = "owner" (checkPermission in page.tsx), which is
// a per-org rank, not a distinct cross-org platform-admin flag (there is no
// such flag in this schema - see project memory on platform_admins being
// unwired). So the browser-client postgres_changes subscription below only
// ever receives events for the viewing owner's OWN organization's rows, even
// though the snapshot it refreshes (via the server-side, service-role-backed
// GET /api/admin/command-center route) spans every org.
//
// Net effect: this wiring gives real, working Realtime - not a fake "Live"
// badge and not setInterval polling dressed up as realtime - but it is only a
// trigger for "my own org just did something, re-pull the full cross-org
// snapshot," not a true "any org, anywhere, just did something" signal.
// Activity in other orgs will not push a live refresh here; it only shows up
// on the next full page load or the safety-net interval below. A genuinely
// cross-org-live version would need a service-role-authenticated broadcast
// (e.g. a Postgres trigger -> Supabase Broadcast from an Edge Function)
// rather than a client-authenticated postgres_changes subscription, which
// would require shipping the service role to the browser - explicitly not
// done here. Documented rather than silently overclaimed.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type { CommandCenterSnapshot } from "@/lib/command-center/snapshot";

type ConnectionState = "connecting" | "live" | "offline";

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

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
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

function LiveIndicator({ state, lastUpdated }: { state: ConnectionState; lastUpdated: string }) {
  const color = state === "live" ? "#10B981" : state === "connecting" ? "#F59E0B" : "#94A3B8";
  const label = state === "live" ? "Live" : state === "connecting" ? "Connecting…" : "Offline";
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: "8px" }}
      title="Realtime subscription covers only your own organization's agent_runs/agent_decisions/applications rows (RLS-enforced). Other orgs' activity refreshes on the next reload."
    >
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "999px",
          backgroundColor: color,
          boxShadow: state === "live" ? `0 0 0 3px ${color}33` : "none",
        }}
      />
      <span style={{ fontSize: "12px", fontWeight: 700, color }}>{label}</span>
      <span style={{ fontSize: "11px", color: "#94A3B8" }}>· updated {formatRelative(lastUpdated)}</span>
    </div>
  );
}

export function CommandCenterLive({ initialSnapshot }: { initialSnapshot: CommandCenterSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const res = await fetch("/api/admin/command-center", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as CommandCenterSnapshot;
        setSnapshot(data);
      }
    } catch {
      // Transient fetch failure - the next realtime event or safety-net tick retries.
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("command-center-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_runs" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_decisions" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "applications" },
        () => void refresh(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnectionState("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnectionState("offline");
        }
      });

    // Safety net: catch cross-org activity Realtime can't (RLS scopes the
    // subscription above to this owner's own org only - see header comment)
    // and any missed events, same fallback-interval precedent as
    // src/components/autoapply/QueueMetrics.tsx.
    const interval = setInterval(() => void refresh(), 60_000);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [refresh]);

  const {
    totalOrgsOnboarded,
    activeSubscriptions,
    totalOpportunities,
    totalApplications,
    pendingDrafts,
    agentRunsLast24h,
    itemsProcessedLast24h,
    agentDecisionsLast24h,
    foundationTotal,
    foundation990Count,
    foundationWebCount,
    topOrgs,
    recentAgentRuns,
    orgNameById,
    generatedAt,
  } = snapshot;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
        <LiveIndicator state={connectionState} lastUpdated={generatedAt} />
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
                      {orgNameById[run.organization_id] ?? "Unknown org"}
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

      {/* Recent Agent Runs table */}
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
                    <td style={tdStyle}>{orgNameById[run.organization_id] ?? "Unknown org"}</td>
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
    </>
  );
}
