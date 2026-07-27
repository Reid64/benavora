"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  ListChecks,
  RotateCw,
  ShieldAlert,
  Timer,
  XCircle,
} from "lucide-react";

import { useProfile } from "@/lib/hooks/useProfile";
import { formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";

const REFRESH_INTERVAL_MS = 10_000;

const CANVAS = "#D6E4F0";
const CARD_BG = "#FFFFFF";
const BORDER = "#C3D3E2";
const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";
const ACCENT = "#0077B6";

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
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: "0 4px 20px rgba(15,23,42,0.08)" }}
    >
      <div className="h-1.5 w-full" style={{ backgroundColor: color }} aria-hidden />
      <div className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
          {label}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${color}1A` }}
          >
            <Icon className="h-5 w-5" style={{ color }} aria-hidden />
          </div>
          <p className="text-3xl font-bold" style={{ color: TEXT_PRIMARY }}>
            {value}
          </p>
        </div>
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
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: CANVAS }}>
        <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
          Loading System Health...
        </p>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
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
      <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
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
    <div className="min-h-screen space-y-6 p-6" style={{ backgroundColor: CANVAS }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div style={{ borderLeft: `4px solid ${ACCENT}`, paddingLeft: "1rem" }}>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT_PRIMARY }}>
            System Health
          </h1>
          <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
            Platform-wide infrastructure status. Refreshes every 10 seconds.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition"
          style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}`, color: TEXT_PRIMARY }}
        >
          <RotateCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={data.supabase_healthy ? CheckCircle2 : XCircle}
          label="Supabase Connection"
          value={data.supabase_healthy ? "Healthy" : "Unreachable"}
          color={data.supabase_healthy ? "#10B981" : "#DC2626"}
        />
        <StatCard
          icon={Activity}
          label="Active Agent Runs"
          value={data.running_agents.length}
          color="#F59E0B"
        />
        <StatCard
          icon={AlertCircle}
          label="Errors (24h)"
          value={data.error_count_24h}
          color={data.error_count_24h > 0 ? "#DC2626" : "#10B981"}
        />
        <StatCard
          icon={Timer}
          label="Avg Agent Run Duration (24h)"
          value={
            data.avg_agent_run_duration_ms_24h == null
              ? "—"
              : `${(data.avg_agent_run_duration_ms_24h / 1000).toFixed(1)}s`
          }
          color={ACCENT}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatCard
          icon={ListChecks}
          label="Submission Queue Depth"
          value={data.queue_depths.submission_queue}
          color="#023E8A"
        />
        <StatCard
          icon={ListChecks}
          label="Agent Queue Depth"
          value={data.queue_depths.agent_queue}
          color="#6B48CC"
        />
        <StatCard
          icon={ListChecks}
          label="Donor Discovery Requests Pending"
          value={data.queue_depths.donor_discovery_requests}
          color="#4C3D8F"
        />
      </div>

      {/* Worker heartbeats */}
      <div
        className="overflow-hidden rounded-xl"
        style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: "0 4px 20px rgba(15,23,42,0.08)" }}
      >
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
                <tr style={{ backgroundColor: "#1A2B3C" }}>
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

      {/* Active agent runs */}
      <div
        className="overflow-hidden rounded-xl"
        style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: "0 4px 20px rgba(15,23,42,0.08)" }}
      >
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
                <tr style={{ backgroundColor: "#1A2B3C" }}>
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
  );
}
