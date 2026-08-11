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
//
// Configurable Panel Layout (FEATURE_REGISTRY_v2.md #154, Phase 3): the 5
// sections below (stat row, the 3 named panels, and the Recent Agent Runs
// table) are the real, pre-existing sections this page already renders -
// reordering doesn't invent new panels, it makes native HTML5 drag-and-drop
// reorder the same 5 real blocks and persists the order to
// profiles.command_center_layout (migration 131) via
// /api/command-center/layout. All 5 live in one CSS grid; the 3 named
// panels default to a single grid column each (so they sit side-by-side in
// their default order, matching the original 3-up row), while the stat row
// and the table span the full grid width - dragging a panel into a
// different position re-flows the grid around it, it doesn't fake a
// disconnected "saved" state that silently fails to persist.
//
// TV/Projector Mode (FEATURE_REGISTRY_v2.md #155, Phase 3): a real
// `element.requestFullscreen()` call on the panel-content wrapper below (not
// a CSS-only "looks fullscreen" class) with a `fullscreenchange` listener to
// stay in sync if the viewer exits via Escape/browser chrome instead of the
// in-page toggle. The wrapper deliberately does NOT include the page header
// (title/clock) or the "Admin Quick Actions" grid, both of which live in the
// parent server component (page.tsx) - the Fullscreen API only renders the
// target element's subtree, so those two purely-operational/admin sections
// are excluded from TV mode for free, without needing a second "hide admin
// chrome" prop threaded down from the page.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type { CommandCenterSnapshot } from "@/lib/command-center/snapshot";
import {
  DEFAULT_COMMAND_CENTER_LAYOUT,
  type CommandCenterPanelId,
} from "@/lib/command-center/panels";

type ConnectionState = "connecting" | "live" | "offline";
type SaveState = "idle" | "saving" | "saved" | "error";

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

function statCardStyle(tv: boolean) {
  return {
    backgroundColor: "#FFFFFF",
    borderRadius: tv ? "20px" : "16px",
    overflow: "hidden",
    boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
  };
}

function statTopBand(color: string, tv: boolean) {
  return { height: tv ? "9px" : "6px", backgroundColor: color };
}

function panelStyle(tv: boolean) {
  return {
    backgroundColor: "#FFFFFF",
    borderRadius: tv ? "20px" : "16px",
    overflow: "hidden",
    boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
    display: "flex",
    flexDirection: "column" as const,
    minHeight: tv ? "420px" : "320px",
  };
}

function panelHeaderStyle(tv: boolean) {
  return {
    fontSize: tv ? "20px" : "13px",
    fontWeight: 700,
    color: "#FFFFFF",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    backgroundColor: "#1A2B3C",
    padding: tv ? "22px 28px" : "14px 20px",
    margin: 0,
  };
}

function panelBodyStyle(tv: boolean) {
  return {
    padding: tv ? "24px 28px" : "16px 20px",
    flex: 1,
    overflowY: "auto" as const,
  };
}

function emptyStateStyle(tv: boolean) {
  return {
    fontSize: tv ? "18px" : "13px",
    color: "#94A3B8",
    padding: tv ? "36px 0" : "24px 0",
    textAlign: "center" as const,
  };
}

function thStyle(tv: boolean) {
  return {
    padding: tv ? "16px 22px" : "10px 16px",
    textAlign: "left" as const,
    fontSize: tv ? "15px" : "11px",
    fontWeight: 700,
    color: "#64748B",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    borderBottom: "1px solid #E2E8F0",
  };
}

function tdStyle(tv: boolean) {
  return {
    padding: tv ? "18px 22px" : "12px 16px",
    fontSize: tv ? "18px" : "13px",
    color: "#334155",
    borderBottom: "1px solid #F1F5F9",
  };
}

function StatCard({
  label,
  value,
  color,
  tv,
}: {
  label: string;
  value: number;
  color: string;
  tv: boolean;
}) {
  return (
    <div style={statCardStyle(tv)}>
      <div style={statTopBand(color, tv)} />
      <div style={{ padding: tv ? "28px" : "20px" }}>
        <div
          style={{
            fontSize: tv ? "15px" : "11px",
            fontWeight: 700,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: tv ? "48px" : "28px",
            fontWeight: 900,
            color: "#0F172A",
            marginTop: "4px",
          }}
        >
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
  tv,
}: {
  label: string;
  numerator: number;
  denominator: number;
  color: string;
  tv: boolean;
}) {
  const pct = denominator > 0 ? Math.min(100, Math.round((numerator / denominator) * 100)) : 0;
  return (
    <div style={{ marginBottom: tv ? "28px" : "18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontSize: tv ? "18px" : "12px", fontWeight: 600, color: "#334155" }}>
          {label}
        </span>
        <span style={{ fontSize: tv ? "18px" : "12px", fontWeight: 700, color: "#0F172A" }}>
          {numerator.toLocaleString()} / {denominator.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div
        style={{
          height: tv ? "14px" : "8px",
          borderRadius: "999px",
          backgroundColor: "#E2E8F0",
          overflow: "hidden",
        }}
      >
        <div
          style={{ width: `${pct}%`, height: "100%", backgroundColor: color, borderRadius: "999px" }}
        />
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

function ToolbarButton({
  label,
  onClick,
  active,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: "12px",
        fontWeight: 700,
        color: active ? "#FFFFFF" : "#0077B6",
        backgroundColor: active ? "#0077B6" : "#FFFFFF",
        border: "1px solid #0077B6",
        borderRadius: "8px",
        padding: "8px 14px",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

export function CommandCenterLive({ initialSnapshot }: { initialSnapshot: CommandCenterSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const refreshing = useRef(false);

  // ---- Configurable Panel Layout state ----
  const [order, setOrder] = useState<CommandCenterPanelId[]>(DEFAULT_COMMAND_CENTER_LAYOUT);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const dragPanelId = useRef<CommandCenterPanelId | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/command-center/layout", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { order?: CommandCenterPanelId[] | null } | null) => {
        if (!cancelled && data?.order) setOrder(data.order);
      })
      .catch(() => {
        // No saved layout yet, or a transient fetch failure — the default
        // order (declared above) is already a real, valid layout, not a
        // placeholder, so there's nothing to recover from here.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistOrder = useCallback(async (next: CommandCenterPanelId[]) => {
    setSaveState("saving");
    try {
      const res = await fetch("/api/command-center/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: next }),
      });
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }, []);

  const handleDrop = useCallback(
    (targetId: CommandCenterPanelId) => {
      const sourceId = dragPanelId.current;
      dragPanelId.current = null;
      if (!sourceId || sourceId === targetId) return;

      setOrder((current) => {
        const next = [...current];
        const fromIndex = next.indexOf(sourceId);
        const toIndex = next.indexOf(targetId);
        if (fromIndex === -1 || toIndex === -1) return current;
        next.splice(fromIndex, 1);
        next.splice(toIndex, 0, sourceId);
        void persistOrder(next);
        return next;
      });
    },
    [persistOrder],
  );

  const resetLayout = useCallback(() => {
    setOrder(DEFAULT_COMMAND_CENTER_LAYOUT);
    void persistOrder(DEFAULT_COMMAND_CENTER_LAYOUT);
  }, [persistOrder]);

  // ---- TV/Projector Mode state ----
  const fullscreenTargetRef = useRef<HTMLDivElement>(null);
  const [isTvMode, setIsTvMode] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsTvMode(document.fullscreenElement === fullscreenTargetRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleTvMode = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void fullscreenTargetRef.current?.requestFullscreen();
    }
  }, []);

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

  const tv = isTvMode;

  // Each of the 5 real sections, keyed by the same ids persisted to
  // profiles.command_center_layout. gridColumn "1 / -1" spans the full grid
  // width (matching the original stat row / table); the 3 named panels
  // default to a single column so their default order still renders as a
  // side-by-side row, exactly like the pre-reorder layout.
  const panelContent = useMemo<Record<CommandCenterPanelId, { node: ReactNode; span: string }>>(
    () => ({
      stats: {
        span: "1 / -1",
        node: (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: tv ? "repeat(3, 1fr)" : "repeat(5, 1fr)",
              gap: tv ? "24px" : "16px",
            }}
          >
            <StatCard label="Total Orgs" value={totalOrgsOnboarded} color="#1A2B3C" tv={tv} />
            <StatCard
              label="Active Subscriptions"
              value={activeSubscriptions}
              color="#10B981"
              tv={tv}
            />
            <StatCard
              label="Total Opportunities"
              value={totalOpportunities}
              color="#0EA5E9"
              tv={tv}
            />
            {!tv && (
              <>
                <StatCard
                  label="Total Applications"
                  value={totalApplications}
                  color="#8B5CF6"
                  tv={tv}
                />
                <StatCard label="AI Drafts Pending" value={pendingDrafts} color="#F59E0B" tv={tv} />
              </>
            )}
          </div>
        ),
      },
      "ai-pipeline": {
        span: "auto",
        node: (
          <div style={panelStyle(tv)}>
            <div style={panelHeaderStyle(tv)}>AI Pipeline Status</div>
            <div style={panelBodyStyle(tv)}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: tv ? "20px" : "14px",
                  paddingBottom: tv ? "18px" : "12px",
                  borderBottom: "1px solid #E2E8F0",
                }}
              >
                <div>
                  <div style={{ fontSize: tv ? "34px" : "20px", fontWeight: 800, color: "#0F172A" }}>
                    {agentRunsLast24h.toLocaleString()}
                  </div>
                  <div style={{ fontSize: tv ? "14px" : "11px", color: "#64748B" }}>runs (24h)</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: tv ? "34px" : "20px", fontWeight: 800, color: "#0F172A" }}>
                    {itemsProcessedLast24h.toLocaleString()}
                  </div>
                  <div style={{ fontSize: tv ? "14px" : "11px", color: "#64748B" }}>
                    items processed (24h)
                  </div>
                </div>
              </div>
              <div style={{ fontSize: tv ? "15px" : "11px", color: "#64748B", marginBottom: "10px" }}>
                {agentDecisionsLast24h.toLocaleString()} agent decisions logged (24h)
              </div>
              {recentAgentRuns.length === 0 ? (
                <div style={emptyStateStyle(tv)}>No agent runs recorded yet.</div>
              ) : (
                recentAgentRuns.slice(0, tv ? 4 : 5).map((run) => (
                  <div
                    key={run.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "10px",
                      padding: tv ? "14px 0" : "8px 0",
                      borderBottom: "1px solid #F1F5F9",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: tv ? "16px" : "12px",
                          color: "#334155",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {humanizeEnum(run.agent_type)}
                      </div>
                      {!tv && (
                        <div style={{ fontSize: "11px", color: "#94A3B8" }}>
                          {orgNameById[run.organization_id] ?? "Unknown org"}
                        </div>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: tv ? "13px" : "10px",
                        fontWeight: 700,
                        color: agentStatusColor(run.status),
                        border: `1px solid ${agentStatusColor(run.status)}`,
                        borderRadius: "999px",
                        padding: tv ? "4px 12px" : "2px 8px",
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
        ),
      },
      "data-intelligence": {
        span: "auto",
        node: (
          <div style={panelStyle(tv)}>
            <div style={panelHeaderStyle(tv)}>Data Intelligence Status</div>
            <div style={panelBodyStyle(tv)}>
              <div style={{ fontSize: tv ? "15px" : "11px", color: "#64748B", marginBottom: tv ? "24px" : "16px" }}>
                {foundationTotal.toLocaleString()} foundation directory records
              </div>
              <ProgressBar
                label="IRS 990 Enriched"
                numerator={foundation990Count}
                denominator={foundationTotal}
                color="#0077B6"
                tv={tv}
              />
              <ProgressBar
                label="Website Enriched"
                numerator={foundationWebCount}
                denominator={foundationTotal}
                color="#00B4D8"
                tv={tv}
              />
            </div>
          </div>
        ),
      },
      "top-orgs": {
        span: "auto",
        node: (
          <div style={panelStyle(tv)}>
            <div style={panelHeaderStyle(tv)}>Most Active Orgs (7d)</div>
            <div style={panelBodyStyle(tv)}>
              {topOrgs.length === 0 ? (
                <div style={emptyStateStyle(tv)}>No agent activity in the last 7 days.</div>
              ) : (
                topOrgs.map((org, index) => (
                  <div
                    key={org.orgId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: tv ? "16px 0" : "10px 0",
                      borderBottom: "1px solid #F1F5F9",
                    }}
                  >
                    <span
                      style={{
                        fontSize: tv ? "16px" : "12px",
                        fontWeight: 700,
                        color: "#94A3B8",
                        width: tv ? "22px" : "16px",
                      }}
                    >
                      {index + 1}
                    </span>
                    {tv ? (
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: "20px",
                          color: "#0F172A",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {org.name}
                      </span>
                    ) : (
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
                    )}
                    <span
                      style={{
                        fontSize: tv ? "16px" : "11px",
                        fontWeight: 700,
                        color: "#FFFFFF",
                        backgroundColor: "#6B48CC",
                        borderRadius: "999px",
                        padding: tv ? "6px 16px" : "3px 10px",
                      }}
                    >
                      {org.count}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        ),
      },
      "recent-runs": {
        span: "1 / -1",
        node: (
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: tv ? "20px" : "16px",
              overflow: "hidden",
              boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
            }}
          >
            <div style={panelHeaderStyle(tv)}>Recent Agent Runs — All Orgs</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle(tv)}>Organization</th>
                    <th style={thStyle(tv)}>Agent</th>
                    <th style={thStyle(tv)}>Status</th>
                    <th style={thStyle(tv)}>Items Processed</th>
                    {!tv && <th style={thStyle(tv)}>Duration</th>}
                    <th style={thStyle(tv)}>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAgentRuns.length === 0 ? (
                    <tr>
                      <td style={tdStyle(tv)} colSpan={6}>
                        No agent runs recorded yet.
                      </td>
                    </tr>
                  ) : (
                    recentAgentRuns.slice(0, tv ? 6 : undefined).map((run) => (
                      <tr key={run.id}>
                        <td style={tdStyle(tv)}>{orgNameById[run.organization_id] ?? "Unknown org"}</td>
                        <td style={tdStyle(tv)}>{humanizeEnum(run.agent_type)}</td>
                        <td style={tdStyle(tv)}>
                          <span
                            style={{
                              fontSize: tv ? "14px" : "11px",
                              fontWeight: 700,
                              color: agentStatusColor(run.status),
                              border: `1px solid ${agentStatusColor(run.status)}`,
                              borderRadius: "999px",
                              padding: tv ? "4px 12px" : "2px 8px",
                              textTransform: "capitalize",
                            }}
                          >
                            {run.status}
                          </span>
                        </td>
                        <td style={tdStyle(tv)}>{run.items_processed ?? "-"}</td>
                        {!tv && (
                          <td style={tdStyle(tv)}>
                            {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : "-"}
                          </td>
                        )}
                        <td style={tdStyle(tv)}>
                          {formatDate(run.created_at)} · {formatRelative(run.created_at)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ),
      },
    }),
    [
      tv,
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
    ],
  );

  const panelLabels: Record<CommandCenterPanelId, string> = {
    stats: "Stat Row",
    "ai-pipeline": "AI Pipeline Status",
    "data-intelligence": "Data Intelligence Status",
    "top-orgs": "Most Active Orgs",
    "recent-runs": "Recent Agent Runs",
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <LiveIndicator state={connectionState} lastUpdated={generatedAt} />
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {saveState === "saving" && (
            <span style={{ fontSize: "11px", color: "#94A3B8" }}>Saving layout…</span>
          )}
          {saveState === "saved" && (
            <span style={{ fontSize: "11px", color: "#10B981", fontWeight: 700 }}>
              Layout saved
            </span>
          )}
          {saveState === "error" && (
            <span style={{ fontSize: "11px", color: "#EF4444", fontWeight: 700 }}>
              Layout save failed
            </span>
          )}
          <ToolbarButton label="Reset Layout" onClick={resetLayout} />
          <ToolbarButton
            label={isTvMode ? "Exit TV Mode" : "TV Mode"}
            onClick={toggleTvMode}
            active={isTvMode}
          />
        </div>
      </div>

      <div
        ref={fullscreenTargetRef}
        style={{
          backgroundColor: tv ? "#E4E9F0" : "transparent",
          padding: tv ? "36px" : 0,
        }}
      >
        {!tv && (
          <div style={{ fontSize: "11px", color: "#94A3B8", marginBottom: "10px" }}>
            Drag a panel by its header to reorder — order is saved per owner.
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: tv ? "24px" : "20px",
          }}
        >
          {order.map((id) => {
            const { node, span } = panelContent[id];
            return (
              <div
                key={id}
                draggable={!tv}
                onDragStart={(e) => {
                  dragPanelId.current = id;
                  // Firefox requires a setData call in dragstart or the drag
                  // never actually starts; the value itself isn't read back
                  // (handleDrop uses the dragPanelId ref instead), only the
                  // side effect of calling setData matters here.
                  e.dataTransfer.setData("text/plain", id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (!tv) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(id);
                }}
                style={{
                  gridColumn: span,
                  cursor: tv ? "default" : "grab",
                  outline: !tv ? "2px dashed transparent" : "none",
                }}
                onDragEnter={(e) => {
                  if (!tv) e.currentTarget.style.outline = "2px dashed #0077B6";
                }}
                onDragLeave={(e) => {
                  if (!tv) e.currentTarget.style.outline = "2px dashed transparent";
                }}
                title={!tv ? `Drag to reorder: ${panelLabels[id]}` : undefined}
              >
                {node}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
