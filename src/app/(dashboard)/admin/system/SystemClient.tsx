"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Database,
  RotateCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { useProfile } from "@/lib/hooks/useProfile";
import { formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";

const REFRESH_INTERVAL_MS = 10_000;

const FRAME_NAVY = "#2C4E3B";
const ACCENT_GOLD = "#C49A4F";
const CARD_BG = "#F8F5EE";
const BORDER = "rgba(44,78,59,0.15)";
const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";
const ACCENT = ACCENT_GOLD;

type WorkerRow = {
  id: string;
  worker_id: string;
  status: string;
  last_heartbeat_at: string;
  started_at: string;
  items_processed: number;
  items_failed: number;
  version: string | null;
  isStale: boolean;
};

type RunningAgentRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  agent_type: string;
  started_at: string | null;
  created_at: string;
};

type SystemData = {
  supabase_healthy: boolean;
  workers: WorkerRow[];
  running_agents: RunningAgentRow[];
  queue_depths: {
    submission_queue: number;
    agent_queue: number;
    donor_discovery_requests: number;
  };
  error_count_24h: number;
  avg_agent_run_duration_ms_24h: number | null;
};

function StatCard({
  label,
  value,
  valueColor = ACCENT_GOLD,
}: {
  label: string;
  value: string | number;
  /** Defaults to gold - the one shared accent purpose for this page's stat values.
      Pass a real status color (green/red) only for a genuine semantic exception,
      e.g. Healthy/Unreachable, zero/nonzero errors - never for arbitrary variety. */
  valueColor?: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-[14px]"
      style={{ backgroundColor: FRAME_NAVY, boxShadow: "0 4px 20px rgba(44,78,59,0.22)", padding: "3px" }}
    >
      <div className="rounded-[11px] p-5" style={{ backgroundColor: CARD_BG }}>
        <p className="text-3xl font-extrabold" style={{ color: valueColor }}>
          {value}
        </p>
        <p className="mt-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
          {label}
        </p>
      </div>
    </div>
  );
}

export default function SystemClient() {
  const { profile, loading: profileLoading } = useProfile();
  const canView = profile?.role === "owner" || profile?.role === "admin";
  const canClear = profile?.role === "owner";

  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/system");
      const json = (await res.json().catch(() => null)) as (SystemData & { error?: string }) | null;
      if (!res.ok || !json) {
        setLoadError(json?.error ?? "Could not load system health data.");
        return;
      }
      setData(json);
    } catch {
      setLoadError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (profileLoading) return;
    if (!canView) {
      setLoading(false);
      return;
    }
    void loadRef.current();
    const interval = setInterval(() => void loadRef.current(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [profileLoading, canView]);

  async function handleClearStuckJobs() {
    if (!window.confirm("Mark any agent run stuck in 'running' for over 2 hours as failed?")) {
      return;
    }
    setClearing(true);
    setClearMessage(null);
    try {
      const res = await fetch("/api/admin/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_stuck_jobs" }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; clearedCount?: number };
      if (!res.ok) {
        throw new Error(json.error ?? "Could not clear stuck jobs.");
      }
      setClearMessage(`Cleared ${json.clearedCount ?? 0} stuck job(s).`);
      await load();
    } catch (err) {
      setClearMessage(err instanceof Error ? err.message : "Could not clear stuck jobs.");
    } finally {
      setClearing(false);
    }
  }

  if (profileLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
          Loading System Health...
        </p>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="min-h-screen p-6">
        <div
          className="flex flex-col items-center justify-center rounded-xl px-6 py-16 text-center"
          style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}` }}
        >
          <ShieldAlert className="h-10 w-10" style={{ color: TEXT_MUTED }} aria-hidden />
          <h3 className="mt-4 text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
            Admins only
          </h3>
          <p className="mt-1 max-w-sm text-sm" style={{ color: TEXT_SECONDARY }}>
            Only owners and admins can view the System Health dashboard.
          </p>
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="min-h-screen p-6">
        <div
          className="flex flex-col items-center justify-center rounded-xl px-6 py-16 text-center"
          style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}` }}
        >
          <ShieldAlert className="h-10 w-10" style={{ color: TEXT_MUTED }} aria-hidden />
          <h3 className="mt-4 text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
            Could not load system health
          </h3>
          <p className="mt-1 max-w-sm text-sm" style={{ color: TEXT_SECONDARY }}>
            {loadError ?? "Unknown error."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div style={{ borderLeft: `4px solid ${ACCENT}`, paddingLeft: "1rem" }}>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: FRAME_NAVY }}>
            System Health
          </h1>
          <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
            Platform-wide infrastructure status. Refreshes every 10 seconds.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition"
          style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, color: TEXT_PRIMARY }}
        >
          <RotateCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Supabase Connection"
          value={data.supabase_healthy ? "Healthy" : "Unreachable"}
          valueColor={data.supabase_healthy ? "#10B981" : "#DC2626"}
        />
        <StatCard label="Active Agent Runs" value={data.running_agents.length} />
        <StatCard
          label="Errors (24h)"
          value={data.error_count_24h}
          valueColor={data.error_count_24h > 0 ? "#DC2626" : "#10B981"}
        />
        <StatCard
          label="Avg Agent Run Duration (24h)"
          value={
            data.avg_agent_run_duration_ms_24h == null
              ? "—"
              : `${(data.avg_agent_run_duration_ms_24h / 1000).toFixed(1)}s`
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatCard label="Submission Queue Depth" value={data.queue_depths.submission_queue} />
        <StatCard label="Agent Queue Depth" value={data.queue_depths.agent_queue} />
        <StatCard
          label="Donor Discovery Requests Pending"
          value={data.queue_depths.donor_discovery_requests}
        />
      </div>

      {/* Worker heartbeats */}
      <div
        className="overflow-hidden rounded-xl"
        style={{ backgroundColor: FRAME_NAVY, boxShadow: "0 4px 20px rgba(44,78,59,0.22)", padding: "3px" }}
      >
      <div className="overflow-hidden rounded-[10px]" style={{ backgroundColor: CARD_BG }}>
        <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <h3 className="text-base font-semibold" style={{ color: TEXT_PRIMARY }}>
            Railway Worker Status
          </h3>
          <p className="mt-0.5 text-sm" style={{ color: TEXT_SECONDARY }}>
            Last heartbeat per worker. Stale = no heartbeat in over 5 minutes.
          </p>
        </div>
        <div className="overflow-x-auto">
          {data.workers.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <Database className="h-10 w-10" style={{ color: TEXT_MUTED }} aria-hidden />
              <h3 className="mt-4 text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
                No worker heartbeats recorded
              </h3>
              <p className="mt-1 max-w-sm text-sm" style={{ color: TEXT_SECONDARY }}>
                worker_status will populate once the Railway worker reports in.
              </p>
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: FRAME_NAVY }}>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>Worker</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>Processed</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>Failed</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>
                    Last Heartbeat
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.workers.map((w, i) => (
                  <tr key={w.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${BORDER}` }}>
                    <td className="px-5 py-3 font-medium" style={{ color: TEXT_PRIMARY }}>
                      {w.worker_id} {w.version ? <span style={{ color: TEXT_MUTED }}>v{w.version}</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={{
                          backgroundColor: w.isStale ? "#FEE2E2" : "#DCFCE7",
                          color: w.isStale ? "#B91C1C" : "#166534",
                        }}
                      >
                        {w.isStale ? "Stale" : humanizeEnum(w.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: TEXT_SECONDARY }}>
                      {w.items_processed}
                    </td>
                    <td className="px-4 py-3" style={{ color: TEXT_SECONDARY }}>
                      {w.items_failed}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3" style={{ color: TEXT_MUTED }}>
                      {formatRelative(w.last_heartbeat_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      </div>

      {/* Active agent runs */}
      <div
        className="overflow-hidden rounded-xl"
        style={{ backgroundColor: FRAME_NAVY, boxShadow: "0 4px 20px rgba(44,78,59,0.22)", padding: "3px" }}
      >
      <div className="overflow-hidden rounded-[10px]" style={{ backgroundColor: CARD_BG }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <h3 className="text-base font-semibold" style={{ color: TEXT_PRIMARY }}>
              Active Agent Runs — All Orgs
            </h3>
            <p className="mt-0.5 text-sm" style={{ color: TEXT_SECONDARY }}>
              Runs currently in status = running, across every tenant.
            </p>
          </div>
          {canClear && (
            <div className="flex items-center gap-3">
              {clearMessage && (
                <span className="text-xs font-medium" style={{ color: TEXT_SECONDARY }}>
                  {clearMessage}
                </span>
              )}
              <button
                onClick={() => void handleClearStuckJobs()}
                disabled={clearing}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
                style={{ backgroundColor: "#DC2626", color: "#FFFFFF" }}
              >
                <XCircle className="h-4 w-4" />
                {clearing ? "Clearing..." : "Clear Stuck Jobs"}
              </button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          {data.running_agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <CheckCircle2 className="h-10 w-10" style={{ color: TEXT_MUTED }} aria-hidden />
              <h3 className="mt-4 text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
                No active agent runs
              </h3>
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: FRAME_NAVY }}>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>Organization</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>Agent</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>
                    Started
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.running_agents.map((run, i) => (
                  <tr key={run.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${BORDER}` }}>
                    <td className="px-5 py-3 font-medium" style={{ color: TEXT_PRIMARY }}>
                      {run.organization_name}
                    </td>
                    <td className="px-4 py-3" style={{ color: TEXT_SECONDARY }}>
                      {humanizeEnum(run.agent_type)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3" style={{ color: TEXT_MUTED }}>
                      {formatDate(run.started_at ?? run.created_at)} ·{" "}
                      {formatRelative(run.started_at ?? run.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
