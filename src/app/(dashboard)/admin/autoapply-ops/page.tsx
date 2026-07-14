"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  Server,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge, Button, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import { useProfile } from "@/lib/hooks/useProfile";

const C = {
  teal: "#2dd4bf",
  blue: "#3b82f6",
  green: "#34d399",
  amber: "#fbbf24",
  red: "#f87171",
  purple: "#a855f7",
  sky: "#38bdf8",
  indigo: "#6366f1",
  orange: "#fb923c",
  gray: "#8a93b6",
  grid: "rgba(255,255,255,0.08)",
  axis: "#8a93b6",
} as const;

const ERROR_COLORS: Record<string, string> = {
  failed: C.red,
  captcha_blocked: C.amber,
  account_required: C.indigo,
  site_error: C.red,
  timeout: C.purple,
  form_changed: C.sky,
  already_submitted: C.teal,
  portal_dead: C.orange,
};

const ERROR_LABELS: Record<string, string> = {
  failed: "Failed",
  captcha_blocked: "CAPTCHA Blocked",
  account_required: "Account Required",
  site_error: "Site Error",
  timeout: "Timeout",
  form_changed: "Form Changed",
  already_submitted: "Already Submitted",
  portal_dead: "Portal Dead",
};

const TOOLTIP_STYLE = {
  backgroundColor: "#14143a",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  fontSize: 12,
};

const AXIS_TICK = { fill: C.axis, fontSize: 11 };

interface OpsData {
  workerStatus: {
    status: string;
    lastHeartbeat: string;
    itemsProcessedToday: number;
    startedAt: string;
  } | null;
  queueDepth: number;
  platformPaused: boolean;
  submissionMetrics: {
    successRate24h: number;
    successRate7d: number;
    successRate30d: number;
    perHour: { hour: string; count: number }[];
    failureBreakdown: { errorClass: string; count: number }[];
  };
  costs: {
    totalToday: number;
    costPerSubmission: number;
    breakdown: { category: string; amount: number }[];
  };
  portalHealth: {
    blockRates: {
      domain: string;
      submissions: number;
      blocks: number;
      blockRate: number;
    }[];
    antiAutomation: { name: string; url: string; notes: string | null }[];
  };
  tenantActivity: {
    topTenants: { orgName: string; count: number; orgId: string }[];
    flaggedTenants: {
      orgId: string;
      orgName: string;
      todayCount: number;
      avgCount: number;
      ratio: number;
    }[];
  };
}

function rateColor(rate: number): string {
  if (rate >= 70) return C.green;
  if (rate >= 40) return C.amber;
  return C.red;
}

function _rateTextClass(rate: number): string {
  if (rate >= 70) return "text-teal-400";
  if (rate >= 40) return "text-amber-400";
  return "text-red-400";
}

function blockRateClass(blockRate: number): string {
  if (blockRate <= 10) return "text-teal-400";
  if (blockRate <= 30) return "text-amber-400";
  return "text-red-400";
}

function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function workerIsOnline(ws: OpsData["workerStatus"]): boolean {
  if (!ws) return false;
  return Date.now() - new Date(ws.lastHeartbeat).getTime() < 2 * 60 * 1000;
}

function timeSince(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

function GaugeChart({ rate, label }: { rate: number; label: string }) {
  const color = rateColor(rate);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: 140, height: 80 }}>
        <PieChart width={140} height={80}>
          <Pie
            data={[{ v: rate }, { v: 100 - rate }]}
            cx={70}
            cy={74}
            startAngle={180}
            endAngle={0}
            innerRadius={44}
            outerRadius={62}
            dataKey="v"
            stroke="none"
          >
            <Cell fill={color} />
            <Cell fill="rgba(255,255,255,0.06)" />
          </Pie>
        </PieChart>
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-center">
          <span className="text-xl font-bold" style={{ color }}>
            {rate.toFixed(0)}%
          </span>
        </div>
      </div>
      <span className="text-xs text-navy-400">{label}</span>
    </div>
  );
}

const ALERT_RULES = [
  {
    condition: "Success rate < 50% for 1 hour",
    action: "Alert admin via webhook",
    severity: "critical",
  },
  {
    condition: "Daily cost > $50",
    action: "Alert admin via webhook",
    severity: "critical",
  },
  {
    condition: "Worker offline > 5 minutes",
    action: "Alert admin via webhook",
    severity: "critical",
  },
  {
    condition: "Tenant exceeds 3× daily average submissions",
    action: "Alert admin via webhook",
    severity: "warning",
  },
] as const;

export default function AutoApplyOpsPage() {
  const { profile, loading: profileLoading } = useProfile();
  const canView = profile?.role === "owner" || profile?.role === "admin";

  const [data, setData] = useState<OpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/autoapply-ops");
      const json = (await res.json().catch(() => null)) as
        | (OpsData & { error?: string })
        | null;
      if (!res.ok || !json) {
        setLoadError(json?.error ?? "Could not load ops data.");
        return;
      }
      setData(json);
    } catch {
      setLoadError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profileLoading && canView) void load();
    else if (!profileLoading) setLoading(false);
  }, [profileLoading, canView, load]);

  if (profileLoading || loading) {
    return <LoadingSpinner center label="Loading AutoApply Ops..." />;
  }

  if (!canView) {
    return (
      <Card>
        <EmptyState
          icon={ShieldAlert}
          title="Admins only"
          description="Only owners and admins can view the AutoApply Ops dashboard."
        />
      </Card>
    );
  }

  if (loadError || !data) {
    return (
      <Card>
        <EmptyState
          icon={ShieldAlert}
          title="Could not load ops data"
          description={loadError ?? "Unknown error."}
        />
      </Card>
    );
  }

  const isOnline = workerIsOnline(data.workerStatus);
  const { submissionMetrics: metrics, costs, portalHealth, tenantActivity } = data;
  const topCount = tenantActivity.topTenants[0]?.count ?? 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            AutoApply Ops
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Platform-wide operational health, submission metrics, and cost tracking.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {/* Section 1: System Health */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Worker — the one long-running "job" this dashboard tracks live, so it
            gets the running/failed job-status treatment: a pulsing indicator
            while online, a failed-red card once the heartbeat goes stale. */}
        <Card title="Worker" description="Railway AutoApply worker">
          <div
            className={
              isOnline
                ? "bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl p-4 flex items-center gap-3"
                : "bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 flex items-center gap-3"
            }
          >
            {isOnline && (
              <span className="w-2 h-2 rounded-full bg-[#0077B6] animate-pulse shrink-0" aria-hidden />
            )}
            <Server
              className={`h-8 w-8 ${isOnline ? "text-teal-400" : "text-red-400"}`}
              aria-hidden
            />
            <div>
              <p
                className={`text-lg font-semibold ${isOnline ? "text-teal-400" : "text-red-400"}`}
              >
                {isOnline ? "Online" : "Offline"}
              </p>
              {data.workerStatus ? (
                <>
                  <p className="text-xs text-navy-400">
                    Heartbeat {timeSince(data.workerStatus.lastHeartbeat)}
                  </p>
                  <p className="text-xs text-navy-400">
                    {data.workerStatus.itemsProcessedToday.toLocaleString()} processed
                  </p>
                </>
              ) : (
                <p className="text-xs text-navy-400">No worker registered</p>
              )}
            </div>
          </div>
        </Card>

        {/* Queue depth */}
        <Card title="Queue Depth" description="Pending items across all tenants">
          <div className="flex items-center gap-3">
            <CircleDot className="h-8 w-8 text-blue-400" aria-hidden />
            <div>
              <p className="text-3xl font-bold text-navy-900">
                {data.queueDepth.toLocaleString()}
              </p>
              <p className="text-xs text-navy-400">pending submissions</p>
            </div>
          </div>
        </Card>

        {/* Platform state — running reads as a completed-style green card,
            paused reads as the same failed-style red card as the Worker. */}
        <Card title="Platform" description="Global queue control state">
          <div
            className={
              data.platformPaused
                ? "bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 flex items-center justify-between"
                : "bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl p-4 flex items-center justify-between"
            }
          >
            <div className="flex items-center gap-3">
              {data.platformPaused ? (
                <XCircle className="h-8 w-8 text-red-400" aria-hidden />
              ) : (
                <CheckCircle2 className="h-8 w-8 text-teal-400" aria-hidden />
              )}
              <div>
                <p
                  className={`text-lg font-semibold ${data.platformPaused ? "text-red-400" : "text-teal-400"}`}
                >
                  {data.platformPaused ? "Paused" : "Running"}
                </p>
                <p className="text-xs text-navy-400">All tenants</p>
              </div>
            </div>
            {data.platformPaused && (
              <Button
                variant="secondary"
                onClick={() => {
                  window.location.href = "/autoapply/controls";
                }}
              >
                Manage
              </Button>
            )}
          </div>
        </Card>
      </div>

      {/* Section 2: Submission Metrics */}
      <Card
        title="Submission Metrics"
        description="Success rates, hourly volume, and failure breakdown"
      >
        <div className="space-y-8">
          {/* Gauge charts */}
          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-navy-400">
              Success Rate
            </p>
            <div className="flex flex-wrap justify-around gap-6">
              <GaugeChart rate={metrics.successRate24h} label="Last 24 hours" />
              <GaugeChart rate={metrics.successRate7d} label="Last 7 days" />
              <GaugeChart rate={metrics.successRate30d} label="Last 30 days" />
            </div>
          </div>

          {/* Submissions per hour */}
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-400">
              Submissions per Hour — Last 24 Hours (UTC)
            </p>
            {metrics.perHour.every((p) => p.count === 0) ? (
              <p className="text-sm text-navy-500">No submissions in the last 24 hours.</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart
                  data={metrics.perHour}
                  margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                  <XAxis dataKey="hour" tick={AXIS_TICK} interval={3} />
                  <YAxis tick={AXIS_TICK} allowDecimals={false} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    itemStyle={{ color: "#e2e8f0" }}
                    formatter={(v) => [String(Number(v)), "Submissions"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke={C.blue}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    name="Submissions"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Failure breakdown */}
          {metrics.failureBreakdown.length > 0 && (
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-400">
                Failure Breakdown — Last 24 Hours
              </p>
              <div className="flex flex-wrap items-center gap-8">
                <div className="shrink-0">
                  <PieChart width={180} height={180}>
                    <Pie
                      data={metrics.failureBreakdown}
                      dataKey="count"
                      nameKey="errorClass"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      stroke="none"
                    >
                      {metrics.failureBreakdown.map((entry) => (
                        <Cell
                          key={entry.errorClass}
                          fill={ERROR_COLORS[entry.errorClass] ?? C.gray}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      itemStyle={{ color: "#e2e8f0" }}
                      formatter={(value, name) => [
                        String(Number(value)),
                        ERROR_LABELS[String(name)] ?? String(name),
                      ]}
                    />
                  </PieChart>
                </div>
                <ul className="space-y-1.5">
                  {metrics.failureBreakdown.map((entry) => (
                    <li key={entry.errorClass} className="flex items-center gap-2 text-sm">
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-full"
                        style={{
                          backgroundColor: ERROR_COLORS[entry.errorClass] ?? C.gray,
                        }}
                        aria-hidden
                      />
                      <span className="text-navy-600">
                        {ERROR_LABELS[entry.errorClass] ?? entry.errorClass}
                      </span>
                      <span className="font-semibold text-navy-900">{entry.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Section 3: Cost Tracking */}
      <Card title="Cost Tracking" description="Today's spend across all tenants">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface-raised px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
              Total Today
            </p>
            <p className="mt-1 text-2xl font-semibold text-navy-900">
              {fmtCost(costs.totalToday)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface-raised px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
              Cost per Submission
            </p>
            <p className="mt-1 text-2xl font-semibold text-navy-900">
              {fmtCost(costs.costPerSubmission)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface-raised px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
              Breakdown by Category
            </p>
            <ul className="mt-2 space-y-1">
              {costs.breakdown
                .filter((b) => b.amount > 0)
                .map((b) => (
                  <li
                    key={b.category}
                    className="flex items-center justify-between text-xs text-navy-600"
                  >
                    <span>{b.category}</span>
                    <span className="font-medium text-navy-900">{fmtCost(b.amount)}</span>
                  </li>
                ))}
              {costs.breakdown.every((b) => b.amount === 0) && (
                <li className="text-xs text-navy-400">No costs recorded today</li>
              )}
            </ul>
          </div>
        </div>
      </Card>

      {/* Section 4: Portal Health */}
      <Card title="Portal Health" description="Block rates and anti-automation portals detected">
        <div className="space-y-6">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-400">
              Highest Block Rates — Last 7 Days
            </p>
            {portalHealth.blockRates.length === 0 ? (
              <p className="text-sm text-navy-500">
                No portal data available. Rates appear here after 2+ submissions to the same
                portal.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-navy-100">
                <table className="min-w-full divide-y divide-navy-100 text-sm">
                  <thead>
                    <tr className="bg-sidebar">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                        Portal Domain
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-white">
                        Submissions
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-white">
                        Blocks
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-white">
                        Block Rate
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100 bg-surface">
                    {portalHealth.blockRates.map((r) => (
                      <tr key={r.domain} className="hover:bg-navy-50">
                        <td className="max-w-xs truncate px-4 py-2.5 font-medium text-navy-900">
                          {r.domain}
                        </td>
                        <td className="px-4 py-2.5 text-right text-navy-600">
                          {r.submissions}
                        </td>
                        <td className="px-4 py-2.5 text-right text-navy-600">{r.blocks}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={blockRateClass(r.blockRate)}>
                            {r.blockRate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {portalHealth.antiAutomation.length > 0 && (
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-400">
                Anti-Automation Portals Detected
              </p>
              <div className="space-y-2">
                {portalHealth.antiAutomation.map((p) => (
                  <div
                    key={p.url}
                    className="flex items-start justify-between rounded-lg border border-amber-100 bg-amber-50/40 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-navy-900">{p.name}</p>
                      {p.notes && (
                        <p className="mt-0.5 text-xs text-navy-500">{p.notes}</p>
                      )}
                    </div>
                    {p.url && (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-4 shrink-0 text-navy-400 hover:text-navy-700"
                        aria-label={`Open ${p.name} portal`}
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Section 5: Tenant Activity */}
      <Card
        title="Tenant Activity"
        description="Submission volume across organizations today"
      >
        <div className="space-y-6">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-400">
              Top 5 Tenants by Volume Today
            </p>
            {tenantActivity.topTenants.length === 0 ? (
              <p className="text-sm text-navy-500">No activity recorded today.</p>
            ) : (
              <div className="space-y-3">
                {tenantActivity.topTenants.map((t, i) => (
                  <div key={t.orgId} className="flex items-center gap-3">
                    <span className="w-5 shrink-0 text-center text-xs font-bold text-navy-400">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate text-sm font-medium text-navy-900">
                          {t.orgName}
                        </span>
                        <span className="ml-4 shrink-0 text-sm font-semibold text-navy-700">
                          {t.count}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-navy-100">
                        <div
                          className="h-full rounded-full bg-blue-400"
                          style={{ width: `${(t.count / topCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {tenantActivity.flaggedTenants.length > 0 && (
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-400">
                Flagged — Volume Anomaly (3× Daily Average)
              </p>
              <div className="space-y-2">
                {tenantActivity.flaggedTenants.map((t) => (
                  <div
                    key={t.orgId}
                    className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50/40 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-navy-900">{t.orgName}</p>
                      <p className="text-xs text-navy-500">
                        Today: {t.todayCount} · 30d avg: {t.avgCount.toFixed(1)}/day
                      </p>
                    </div>
                    <Badge color="red">{t.ratio.toFixed(1)}× avg</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Section 6: Alert Rules */}
      <Card
        title="Alert Rules"
        description="Active monitoring thresholds — configured in alerting.ts"
      >
        <div className="space-y-2">
          {ALERT_RULES.map((rule) => (
            <div
              key={rule.condition}
              className="flex items-center gap-3 rounded-lg border border-navy-100 px-4 py-3"
            >
              {rule.severity === "critical" ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" aria-hidden />
              ) : (
                <Activity className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-navy-900">{rule.condition}</p>
                <p className="text-xs text-navy-400">Action: {rule.action}</p>
              </div>
              <Badge color={rule.severity === "critical" ? "red" : "yellow"}>
                {rule.severity}
              </Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
