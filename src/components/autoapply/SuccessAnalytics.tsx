"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

const C = {
  teal: "#2dd4bf",
  blue: "#3b82f6",
  green: "#34d399",
  amber: "#fbbf24",
  red: "#f87171",
  purple: "#a855f7",
  sky: "#38bdf8",
  indigo: "#6366f1",
  gray: "#8a93b6",
  grid: "rgba(255,255,255,0.08)",
  axis: "#8a93b6",
} as const;

const TOOLTIP_STYLE = {
  backgroundColor: "#14143a",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  fontSize: 12,
};

const AXIS_TICK = { fill: C.axis, fontSize: 11 };

const STATUS_COLORS: Record<string, string> = {
  submitted: C.green,
  in_progress: C.blue,
  failed: C.red,
  captcha_blocked: C.amber,
  account_required: C.indigo,
  site_error: C.red,
  timeout: C.purple,
  form_changed: C.sky,
  already_submitted: C.teal,
  queued: C.gray,
};

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  in_progress: "In Progress",
  failed: "Failed",
  captcha_blocked: "CAPTCHA Blocked",
  account_required: "Account Required",
  site_error: "Site Error",
  timeout: "Timeout",
  form_changed: "Form Changed",
  already_submitted: "Already Submitted",
  queued: "Queued",
};

function fmtCategory(cat: string): string {
  return cat
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

interface AnalyticsRow {
  status: string;
  created_at: string;
  funders: { category: string; geographic_focus: string | null } | null;
}

interface StatusPoint {
  label: string;
  count: number;
  color: string;
}

interface CategoryPoint {
  category: string;
  successRate: number;
  total: number;
}

interface GeoRow {
  region: string;
  total: number;
  success: number;
  rate: number;
}

interface WeekPoint {
  week: string;
  total: number;
  rate: number;
}

interface ComputedStats {
  total: number;
  successRate: number;
  avgPerDay: number;
  statusBreakdown: StatusPoint[];
  categoryBreakdown: CategoryPoint[];
  geoBreakdown: GeoRow[];
  weekTrend: WeekPoint[];
}

function computeStats(rows: AnalyticsRow[]): ComputedStats {
  const total = rows.length;
  const successCount = rows.filter((r) => r.status === "submitted").length;
  const successRate = total > 0 ? (successCount / total) * 100 : 0;

  let avgPerDay = 0;
  if (total > 0) {
    const timestamps = rows.map((r) => new Date(r.created_at).getTime());
    const minTs = timestamps.reduce((a, b) => Math.min(a, b), timestamps[0] ?? 0);
    const maxTs = timestamps.reduce((a, b) => Math.max(a, b), timestamps[0] ?? 0);
    const daySpan = Math.max(1, (maxTs - minTs) / (1000 * 60 * 60 * 24));
    avgPerDay = total / daySpan;
  }

  // Status breakdown
  const statusMap = new Map<string, number>();
  for (const row of rows) {
    statusMap.set(row.status, (statusMap.get(row.status) ?? 0) + 1);
  }
  const statusBreakdown: StatusPoint[] = Array.from(statusMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({
      label: STATUS_LABELS[status] ?? status.replace(/_/g, " "),
      count,
      color: STATUS_COLORS[status] ?? C.gray,
    }));

  // Success rate by funder category
  const catTotalMap = new Map<string, number>();
  const catSuccessMap = new Map<string, number>();
  for (const row of rows) {
    const cat = row.funders?.category ?? "";
    if (!cat) continue;
    catTotalMap.set(cat, (catTotalMap.get(cat) ?? 0) + 1);
    if (row.status === "submitted") {
      catSuccessMap.set(cat, (catSuccessMap.get(cat) ?? 0) + 1);
    }
  }
  const categoryBreakdown: CategoryPoint[] = Array.from(catTotalMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cat, t]) => ({
      category: fmtCategory(cat),
      successRate: t > 0 ? ((catSuccessMap.get(cat) ?? 0) / t) * 100 : 0,
      total: t,
    }));

  // Geographic breakdown
  const geoTotalMap = new Map<string, number>();
  const geoSuccessMap = new Map<string, number>();
  for (const row of rows) {
    const region = row.funders?.geographic_focus?.trim() || "Unknown";
    geoTotalMap.set(region, (geoTotalMap.get(region) ?? 0) + 1);
    if (row.status === "submitted") {
      geoSuccessMap.set(region, (geoSuccessMap.get(region) ?? 0) + 1);
    }
  }
  const geoBreakdown: GeoRow[] = Array.from(geoTotalMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([region, t]) => ({
      region,
      total: t,
      success: geoSuccessMap.get(region) ?? 0,
      rate: t > 0 ? ((geoSuccessMap.get(region) ?? 0) / t) * 100 : 0,
    }));

  // Weekly trend: last 8 weeks ending at current week
  const now = new Date();
  const weekTrend: WeekPoint[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const weekStart = getWeekStart(d);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekRows = rows.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= weekStart.getTime() && t < weekEnd.getTime();
    });
    const weekSuccess = weekRows.filter((r) => r.status === "submitted").length;
    weekTrend.push({
      week: weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      total: weekRows.length,
      rate: weekRows.length > 0 ? (weekSuccess / weekRows.length) * 100 : 0,
    });
  }

  return {
    total,
    successRate,
    avgPerDay,
    statusBreakdown,
    categoryBreakdown,
    geoBreakdown,
    weekTrend,
  };
}

export function SuccessAnalytics() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    try {
      const { data, error: err } = await supabase
        .from("autoapply_submissions")
        .select("status, created_at, funders(category, geographic_focus)")
        .order("created_at", { ascending: true });
      if (err) throw err;
      setRows((data ?? []) as unknown as AnalyticsRow[]);
      setLoaded(true);
    } catch {
      setError("Could not load analytics data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !loaded && !loading) {
      void load();
    }
  }, [open, loaded, loading, load]);

  const stats = useMemo(
    () => (rows.length > 0 ? computeStats(rows) : null),
    [rows],
  );

  return (
    <Card
      title="Analytics"
      description={
        !open ? "Submission performance, success rates, and trends" : undefined
      }
      actions={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Collapse analytics" : "Expand analytics"}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-navy-400 transition hover:bg-navy-100 hover:text-navy-700"
        >
          {open ? (
            <ChevronUp className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden />
          )}
          {open ? "Collapse" : "Expand"}
        </button>
      }
    >
      {open && (
        <div className="space-y-8">
          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
          {loading && (
            <p className="text-sm text-navy-400">Loading analytics…</p>
          )}
          {!loading && !error && loaded && !stats && (
            <p className="text-sm text-navy-500">
              No submission data available yet. Analytics will populate once
              AutoApply begins processing submissions.
            </p>
          )}
          {!loading && !error && stats && (
            <>
              {/* Overall stats */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCell
                  label="Total Submissions"
                  value={String(stats.total)}
                />
                <StatCell
                  label="Success Rate"
                  value={`${stats.successRate.toFixed(1)}%`}
                  valueClass={
                    stats.successRate >= 70
                      ? "text-teal-400"
                      : stats.successRate >= 40
                        ? "text-amber-400"
                        : "text-red-400"
                  }
                />
                <StatCell
                  label="Avg / Day"
                  value={
                    stats.avgPerDay < 1
                      ? stats.avgPerDay.toFixed(2)
                      : stats.avgPerDay.toFixed(1)
                  }
                />
              </div>

              {/* Status breakdown + Category success rate */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-400">
                    Submissions by Status
                  </p>
                  {stats.statusBreakdown.length === 0 ? (
                    <p className="text-sm text-navy-500">No data</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart
                        data={stats.statusBreakdown}
                        layout="vertical"
                        margin={{ top: 0, right: 16, bottom: 0, left: 110 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={C.grid}
                          horizontal={false}
                        />
                        <XAxis type="number" tick={AXIS_TICK} />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={106}
                          tick={AXIS_TICK}
                        />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          itemStyle={{ color: "#e2e8f0" }}
                          cursor={{ fill: "rgba(255,255,255,0.04)" }}
                          formatter={(value, name) => [String(Number(value)), String(name)]}
                        />
                        <Bar dataKey="count" radius={[0, 3, 3, 0]} name="Count">
                          {stats.statusBreakdown.map((entry) => (
                            <Cell key={entry.label} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-400">
                    Success Rate by Funder Category
                  </p>
                  {stats.categoryBreakdown.length === 0 ? (
                    <p className="text-sm text-navy-500">
                      No category data available. Submissions must be linked to
                      funders with categories assigned.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart
                        data={stats.categoryBreakdown}
                        layout="vertical"
                        margin={{ top: 0, right: 30, bottom: 0, left: 130 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={C.grid}
                          horizontal={false}
                        />
                        <XAxis
                          type="number"
                          domain={[0, 100]}
                          tickFormatter={(v) => `${Number(v)}%`}
                          tick={AXIS_TICK}
                        />
                        <YAxis
                          type="category"
                          dataKey="category"
                          width={126}
                          tick={{ fill: C.axis, fontSize: 10 }}
                        />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          itemStyle={{ color: "#e2e8f0" }}
                          cursor={{ fill: "rgba(255,255,255,0.04)" }}
                          formatter={(value, _name) => [
                            `${Number(value).toFixed(1)}%`,
                            "Success Rate",
                          ]}
                        />
                        <Bar
                          dataKey="successRate"
                          fill={C.teal}
                          radius={[0, 3, 3, 0]}
                          name="Success Rate"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Geographic success table */}
              {stats.geoBreakdown.length > 0 && (
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-400">
                    Success Rate by Geographic Region
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-navy-100">
                    <table className="min-w-full divide-y divide-navy-100 text-sm">
                      <thead style={{ backgroundColor: "#2563EB" }}>
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                            Region
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-white">
                            Submissions
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-white">
                            Successful
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-white">
                            Success Rate
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-navy-100 bg-white">
                        {stats.geoBreakdown.map((row) => (
                          <tr key={row.region} className="hover:bg-navy-50">
                            <td className="px-4 py-2.5 font-medium text-navy-900">
                              {row.region}
                            </td>
                            <td className="px-4 py-2.5 text-right text-navy-600">
                              {row.total}
                            </td>
                            <td className="px-4 py-2.5 text-right text-navy-600">
                              {row.success}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span
                                className={
                                  row.rate >= 70
                                    ? "font-semibold text-teal-400"
                                    : row.rate >= 40
                                      ? "font-semibold text-amber-400"
                                      : "font-semibold text-red-400"
                                }
                              >
                                {row.rate.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Weekly trend */}
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-400">
                  Submissions per Week — Last 8 Weeks
                </p>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart
                    data={stats.weekTrend}
                    margin={{ top: 10, right: 50, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
                    <XAxis dataKey="week" tick={AXIS_TICK} />
                    <YAxis
                      yAxisId="count"
                      tick={AXIS_TICK}
                      allowDecimals={false}
                    />
                    <YAxis
                      yAxisId="rate"
                      orientation="right"
                      domain={[0, 100]}
                      tickFormatter={(v) => `${Number(v)}%`}
                      tick={AXIS_TICK}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      itemStyle={{ color: "#e2e8f0" }}
                      formatter={(value, name) =>
                        name === "rate"
                          ? [`${Number(value).toFixed(1)}%`, "Success Rate"]
                          : [String(Number(value)), "Submissions"]
                      }
                    />
                    <Legend
                      formatter={(value) =>
                        value === "total" ? "Submissions" : "Success Rate"
                      }
                      wrapperStyle={{ fontSize: 12, color: C.axis }}
                    />
                    <Bar
                      yAxisId="count"
                      dataKey="total"
                      fill={C.blue}
                      opacity={0.7}
                      radius={[2, 2, 0, 0]}
                      name="total"
                    />
                    <Line
                      yAxisId="rate"
                      type="monotone"
                      dataKey="rate"
                      stroke={C.teal}
                      strokeWidth={2}
                      dot={{ r: 3, fill: C.teal }}
                      activeDot={{ r: 5 }}
                      name="rate"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function StatCell({
  label,
  value,
  valueClass = "text-navy-900",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-white-raised px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}
