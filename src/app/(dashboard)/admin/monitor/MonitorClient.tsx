"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, RotateCw, ShieldAlert, XCircle } from "lucide-react";

import { useProfile } from "@/lib/hooks/useProfile";

const REFRESH_INTERVAL_MS = 30_000;

const FRAME_NAVY = "#101B2D";
const ACCENT_GOLD = "#B88A2E";
const CARD_BG = "#F8F5EE";
const BORDER = "rgba(16,27,45,0.15)";
const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";
const ACCENT = ACCENT_GOLD;
const ERROR_BG = "#FEE2E2";
const ERROR_BORDER = "#FECACA";
const ERROR_TEXT = "#B91C1C";

// Per CURRENT TASK spec: completed=#10B981, failed=#DC2626, running=#F59E0B.
// automation_queue has no literal "running" status (queued/processing/paused
// collapse to it here — see /api/admin/monitor's displayStatus()).
type RunStatus = "completed" | "failed" | "running";
const STATUS_COLORS: Record<RunStatus, string> = {
  completed: "#10B981",
  failed: "#DC2626",
  running: "#F59E0B",
};
const STATUS_LABELS: Record<RunStatus, string> = {
  completed: "Completed",
  failed: "Failed",
  running: "Running",
};

interface RecentFailure {
  id: string;
  funder_name: string;
  error_message: string;
  created_at: string;
}

interface RecentActivityRow {
  id: string;
  funder_name: string;
  status: RunStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface MonitorData {
  active_count: number;
  completed_today: number;
  failed_today: number;
  recent_failures: RecentFailure[];
  recent_activity: RecentActivityRow[];
}

function successRate(completed: number, failed: number): number | null {
  const total = completed + failed;
  if (total === 0) return null;
  return (completed / total) * 100;
}

function StatCard({
  icon: Icon,
  label,
  description,
  value,
  color,
}: {
  icon: typeof Activity;
  label: string;
  description: string;
  value: string | number;
  color: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ backgroundColor: FRAME_NAVY, boxShadow: "0 4px 20px rgba(16,27,45,0.22)", padding: "3px" }}
    >
      <div className="overflow-hidden rounded-[10px]" style={{ backgroundColor: CARD_BG }}>
        <div className="h-1.5 w-full" style={{ backgroundColor: color }} aria-hidden />
        <div className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
            {label}
          </p>
          <p className="mt-0.5 text-xs" style={{ color: TEXT_SECONDARY }}>
            {description}
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
    </div>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: `${color}1A`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

export default function MonitorClient() {
  const { profile, loading: profileLoading } = useProfile();
  const canView = profile?.role === "owner" || profile?.role === "admin";

  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/monitor");
      const json = (await res.json().catch(() => null)) as
        | (MonitorData & { error?: string })
        | null;
      if (!res.ok || !json) {
        setLoadError(json?.error ?? "Could not load monitor data.");
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

  async function handleRetry(id: string) {
    setRetryingId(id);
    setRetryError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${id}/retry`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setRetryError(json?.error ?? "Could not retry this job.");
        return;
      }
      await load();
    } catch {
      setRetryError("Could not reach the server. Please try again.");
    } finally {
      setRetryingId(null);
    }
  }

  if (profileLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
          Loading Monitor...
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
            Only owners and admins can view the automation Monitor dashboard.
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
            Could not load monitor data
          </h3>
          <p className="mt-1 max-w-sm text-sm" style={{ color: TEXT_SECONDARY }}>
            {loadError ?? "Unknown error."}
          </p>
        </div>
      </div>
    );
  }

  const rate = successRate(data.completed_today, data.failed_today);
  const rateColor =
    rate === null || rate >= 70 ? STATUS_COLORS.completed : rate >= 40 ? STATUS_COLORS.running : STATUS_COLORS.failed;

  return (
    <div className="min-h-screen space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div style={{ borderLeft: `4px solid ${ACCENT}`, paddingLeft: "1rem" }}>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: FRAME_NAVY }}>
            Monitor
          </h1>
          <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
            Live automation queue health across all tenants. Refreshes every 30 seconds.
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
          icon={Activity}
          label="Active"
          description="Queued, processing, or paused"
          value={data.active_count}
          color={STATUS_COLORS.running}
        />
        <StatCard
          icon={CheckCircle2}
          label="Completed Today"
          description="Submitted successfully today"
          value={data.completed_today}
          color={STATUS_COLORS.completed}
        />
        <StatCard
          icon={XCircle}
          label="Failed Today"
          description="Failed submissions today"
          value={data.failed_today}
          color={STATUS_COLORS.failed}
        />
        <StatCard
          icon={AlertTriangle}
          label="Success Rate"
          description="Completed vs. failed today"
          value={rate === null ? "—" : `${rate.toFixed(0)}%`}
          color={rateColor}
        />
      </div>

      <div
        className="overflow-hidden rounded-xl"
        style={{ backgroundColor: FRAME_NAVY, boxShadow: "0 4px 20px rgba(16,27,45,0.22)", padding: "3px" }}
      >
      <div className="overflow-hidden rounded-[10px]" style={{ backgroundColor: CARD_BG }}>
        <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <h3 className="text-base font-semibold" style={{ color: TEXT_PRIMARY }}>
            Recent Activity
          </h3>
          <p className="mt-0.5 text-sm" style={{ color: TEXT_SECONDARY }}>
            Last 15 automation jobs across all tenants, most recent first.
          </p>
        </div>
        {retryError && (
          <div className="px-5 py-3 text-sm" style={{ borderBottom: `1px solid ${ERROR_BORDER}`, backgroundColor: ERROR_BG, color: ERROR_TEXT }}>
            {retryError}
          </div>
        )}
        <div className="overflow-x-auto">
          {data.recent_activity.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <CheckCircle2 className="h-10 w-10" style={{ color: TEXT_MUTED }} aria-hidden />
              <h3 className="mt-4 text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
                No recent activity
              </h3>
              <p className="mt-1 max-w-sm text-sm" style={{ color: TEXT_SECONDARY }}>
                Automation jobs will appear here as they run.
              </p>
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: FRAME_NAVY }}>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>Funder</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>Detail</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>
                    Updated
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide" style={{ color: "#FFFFFF" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_activity.map((row, i) => (
                  <tr key={row.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${BORDER}` }}>
                    <td className="px-5 py-3 font-medium" style={{ color: TEXT_PRIMARY }}>
                      {row.funder_name}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="max-w-md truncate px-4 py-3" style={{ color: TEXT_SECONDARY }}>
                      {row.error_message ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3" style={{ color: TEXT_MUTED }}>
                      {new Date(row.updated_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status === "failed" ? (
                        <button
                          onClick={() => void handleRetry(row.id)}
                          disabled={retryingId === row.id}
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
                          style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, color: TEXT_PRIMARY }}
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                          {retryingId === row.id ? "Retrying…" : "Retry"}
                        </button>
                      ) : (
                        <span className="text-xs" style={{ color: TEXT_MUTED }}>
                          —
                        </span>
                      )}
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
