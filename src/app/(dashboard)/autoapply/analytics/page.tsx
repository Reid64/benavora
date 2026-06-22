"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Award, ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

// ── Color palette ──────────────────────────────────────────────────────────────
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
const TICK = { fill: C.axis, fontSize: 11 };

const FUNNEL_COLORS = ["#3b82f6", "#60a5fa", "#2dd4bf", "#34d399", "#22c55e"] as const;
const PIE_COLORS = [C.blue, C.teal, C.purple, C.amber, C.sky, C.indigo, C.green, C.red];

// ── Dynamic FunnelChart (ssr:false) ───────────────────────────────────────────
interface FunnelStage {
  name: string;
  count: number;
  color: string;
}

const DynamicFunnel = dynamic<{ stages: FunnelStage[] }>(
  async () => {
    const {
      FunnelChart: FC,
      Funnel: F,
      LabelList: LL,
      ResponsiveContainer: RC,
      Cell: CE,
    } = await import("recharts");
    function FunnelView({ stages }: { stages: FunnelStage[] }) {
      const allEmpty = stages.every((s) => s.count === 0);
      if (allEmpty) {
        return (
          <div
            className="flex items-center justify-center text-sm text-navy-500"
            style={{ height: 250 }}
          >
            Submit your first application to see conversion data.
          </div>
        );
      }
      return (
        <RC width="100%" height={250}>
          <FC>
            <F dataKey="count" data={stages}>
              {stages.map((s, i) => (
                <CE key={i} fill={s.color} />
              ))}
              <LL
                position="right"
                fill="#8a93b6"
                stroke="none"
                dataKey="name"
                style={{ fontSize: 11 }}
              />
            </F>
          </FC>
        </RC>
      );
    }
    return { default: FunnelView };
  },
  {
    ssr: false,
    loading: () => (
      <div
        className="animate-pulse rounded-lg bg-navy-50"
        style={{ height: 250 }}
      />
    ),
  },
);

// ── Types ──────────────────────────────────────────────────────────────────────
interface Sub {
  id: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
  confirmation_number: string | null;
  request_amount: number | null;
  variant_id: string | null;
  funders: { id: string; name: string; category: string } | null;
}

interface QItem {
  automation_mode: string | null;
  submission_id: string | null;
  status: string;
}

interface TrendPt {
  week: string;
  total: number;
  success: number;
}

interface ChannelPt {
  mode: string;
  total: number;
  success: number;
  rate: number;
}

interface CatPt {
  category: string;
  total: number;
  success: number;
  rate: number;
}

interface ABRow {
  variantId: string;
  category: string;
  total: number;
  success: number;
  rate: number;
}

interface WaitRow {
  funder: string;
  avgDays: number;
  count: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function weekLabel(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Computation ────────────────────────────────────────────────────────────────
function computeTrends(subs: Sub[]): TrendPt[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (11 - i) * 7);
    const wk = weekLabel(d);
    const wStart = new Date(d);
    wStart.setHours(0, 0, 0, 0);
    const wEnd = new Date(wStart);
    wEnd.setDate(wEnd.getDate() + 7);
    const rows = subs.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= wStart.getTime() && t < wEnd.getTime();
    });
    const success = rows.filter((r) => r.status === "submitted").length;
    return { week: wk, total: rows.length, success };
  });
}

function computeChannels(qItems: QItem[], subs: Sub[]): ChannelPt[] {
  const modeToIds = new Map<string, Set<string>>();
  for (const q of qItems) {
    if (!q.submission_id) continue;
    const m = q.automation_mode ?? "unknown";
    if (!modeToIds.has(m)) modeToIds.set(m, new Set());
    modeToIds.get(m)!.add(q.submission_id);
  }
  return Array.from(modeToIds.entries())
    .map(([mode, ids]) => {
      const ms = subs.filter((s) => ids.has(s.id));
      const success = ms.filter((s) => s.status === "submitted").length;
      return {
        mode: fmt(mode),
        total: ms.length,
        success,
        rate: ms.length ? (success / ms.length) * 100 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
}

function computeCategories(subs: Sub[]): CatPt[] {
  const m = new Map<string, { total: number; success: number }>();
  for (const s of subs) {
    const cat = s.funders?.category ?? "unknown";
    if (!m.has(cat)) m.set(cat, { total: 0, success: 0 });
    m.get(cat)!.total++;
    if (s.status === "submitted") m.get(cat)!.success++;
  }
  return Array.from(m.entries())
    .map(([c, d]) => ({
      category: fmt(c),
      total: d.total,
      success: d.success,
      rate: d.total ? (d.success / d.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

function computeAB(subs: Sub[]): ABRow[] {
  const withV = subs.filter((s) => s.variant_id);
  const m = new Map<string, { total: number; success: number; category: string }>();
  for (const s of withV) {
    const k = `${s.variant_id!}||${s.funders?.category ?? "unknown"}`;
    if (!m.has(k))
      m.set(k, {
        total: 0,
        success: 0,
        category: fmt(s.funders?.category ?? "unknown"),
      });
    m.get(k)!.total++;
    if (s.status === "submitted") m.get(k)!.success++;
  }
  return Array.from(m.entries())
    .map(([k, d]) => ({
      variantId: k.split("||")[0] ?? "",
      category: d.category,
      total: d.total,
      success: d.success,
      rate: d.total ? (d.success / d.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
}

function computeWaiting(subs: Sub[]): WaitRow[] {
  const m = new Map<string, { name: string; days: number[] }>();
  const now = Date.now();
  for (const s of subs) {
    if (s.status !== "submitted" || !s.funders) continue;
    const ts = s.submitted_at
      ? new Date(s.submitted_at).getTime()
      : new Date(s.created_at).getTime();
    const days = (now - ts) / (1000 * 60 * 60 * 24);
    const fid = s.funders.id;
    if (!m.has(fid)) m.set(fid, { name: s.funders.name, days: [] });
    m.get(fid)!.days.push(days);
  }
  return Array.from(m.entries())
    .map(([, d]) => ({
      funder: d.name,
      avgDays: d.days.reduce((a, b) => a + b, 0) / d.days.length,
      count: d.days.length,
    }))
    .sort((a, b) => b.avgDays - a.avgDays)
    .slice(0, 10);
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-navy-100 bg-white/5 px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
        {label}
      </p>
      <div className="mt-1 flex items-end gap-2">
        <p className="text-2xl font-semibold text-navy-900">{value}</p>
        {trend === "up" && (
          <TrendingUp className="mb-0.5 h-4 w-4 text-teal-400" />
        )}
        {trend === "down" && (
          <TrendingDown className="mb-0.5 h-4 w-4 text-red-400" />
        )}
      </div>
      {sub && <p className="mt-0.5 text-xs text-navy-500">{sub}</p>}
    </div>
  );
}

function renderPieActiveShape(props: unknown) {
  const p = props as {
    cx: number;
    cy: number;
    innerRadius: number;
    outerRadius: number;
    startAngle: number;
    endAngle: number;
    fill: string;
    payload: CatPt;
    percent: number;
    value: number;
  };
  return (
    <g>
      <text
        x={p.cx}
        y={p.cy - 10}
        textAnchor="middle"
        fill="#e2e8f0"
        fontSize={12}
        fontWeight={600}
      >
        {p.payload.category}
      </text>
      <text
        x={p.cx}
        y={p.cy + 10}
        textAnchor="middle"
        fill={C.teal}
        fontSize={14}
        fontWeight={700}
      >
        {p.value.toLocaleString()}
      </text>
      <text
        x={p.cx}
        y={p.cy + 28}
        textAnchor="middle"
        fill={C.gray}
        fontSize={11}
      >
        {(p.percent * 100).toFixed(1)}%
      </text>
      <Sector
        cx={p.cx}
        cy={p.cy}
        innerRadius={p.innerRadius}
        outerRadius={p.outerRadius + 8}
        startAngle={p.startAngle}
        endAngle={p.endAngle}
        fill={p.fill}
      />
    </g>
  );
}

// Shared empty overlay rendered on top of chart structure
function ChartEmptyOverlay({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <p className="rounded-lg bg-white/80 px-4 py-2 text-sm text-navy-500 shadow-sm">
        {message}
      </p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function AutoApplyAnalyticsPage() {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [qItems, setQItems] = useState<QItem[]>([]);
  const [queuedTotal, setQueuedTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePieIdx, setActivePieIdx] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    try {
      const [subsRes, queueRes, countRes] = await Promise.all([
        supabase
          .from("autoapply_submissions")
          .select(
            "id, status, created_at, submitted_at, confirmation_number, request_amount, variant_id, funders(id, name, category)",
          )
          .order("created_at", { ascending: true }),
        supabase
          .from("submission_queue")
          .select("automation_mode, submission_id, status"),
        supabase
          .from("submission_queue")
          .select("*", { count: "exact", head: true }),
      ]);
      if (subsRes.error) throw subsRes.error;
      if (queueRes.error) throw queueRes.error;
      setSubs((subsRes.data ?? []) as unknown as Sub[]);
      setQItems((queueRes.data ?? []) as QItem[]);
      setQueuedTotal(countRes.count ?? 0);
    } catch {
      setError("Could not load analytics data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitted = useMemo(
    () => subs.filter((s) => s.status === "submitted"),
    [subs],
  );
  const confirmed = useMemo(
    () => submitted.filter((s) => s.confirmation_number),
    [submitted],
  );

  const funnelStages = useMemo<FunnelStage[]>(
    () => [
      { name: "Queued", count: queuedTotal, color: FUNNEL_COLORS[0] },
      { name: "Submitted", count: submitted.length, color: FUNNEL_COLORS[1] },
      { name: "Confirmed", count: confirmed.length, color: FUNNEL_COLORS[2] },
      { name: "Responded", count: 0, color: FUNNEL_COLORS[3] },
      { name: "Funded", count: 0, color: FUNNEL_COLORS[4] },
    ],
    [queuedTotal, submitted, confirmed],
  );

  const totalRequested = useMemo(
    () => submitted.reduce((sum, s) => sum + (s.request_amount ?? 0), 0),
    [submitted],
  );
  const estCost = useMemo(() => subs.length * 0.15, [subs]);
  const roi = useMemo(
    () => (estCost > 0 ? ((totalRequested - estCost) / estCost) * 100 : 0),
    [totalRequested, estCost],
  );
  const costPerFundedDollar = useMemo(
    () => (totalRequested > 0 ? estCost / totalRequested : 0),
    [estCost, totalRequested],
  );
  const successRate = subs.length > 0 ? (submitted.length / subs.length) * 100 : 0;

  const filteredSubs = useMemo(
    () =>
      selectedCategory
        ? subs.filter(
            (s) => s.funders && fmt(s.funders.category) === selectedCategory,
          )
        : subs,
    [subs, selectedCategory],
  );

  const trends = useMemo(() => computeTrends(filteredSubs), [filteredSubs]);
  const channels = useMemo(
    () => computeChannels(qItems, subs),
    [qItems, subs],
  );
  const categories = useMemo(() => computeCategories(subs), [subs]);
  const abRows = useMemo(() => computeAB(subs), [subs]);
  const waitingRows = useMemo(() => computeWaiting(filteredSubs), [filteredSubs]);

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-sm text-navy-400">Loading analytics…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            AutoApply Analytics
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Submission performance, conversion rates, and ROI tracking.
          </p>
        </div>
        {selectedCategory && (
          <div className="flex items-center gap-2 rounded-lg bg-blue-400/10 px-3 py-1.5 text-sm text-blue-300">
            Filtered:{" "}
            <span className="font-semibold">{selectedCategory}</span>
            <button
              type="button"
              onClick={() => setSelectedCategory(null)}
              className="ml-1 rounded px-1 text-blue-400 hover:text-white"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* 1. Conversion Funnel */}
      <Card
        title="Conversion Funnel"
        description="From queue entry to funded outcome"
      >
        <DynamicFunnel stages={funnelStages} />
        <p className="mt-3 text-xs text-navy-500">
          Responded and Funded stages populate as follow-up responses are
          recorded.
        </p>
      </Card>

      {/* 2. ROI Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Requested"
          value={
            totalRequested > 0
              ? `$${(totalRequested / 1000).toFixed(0)}K`
              : "—"
          }
          sub={`${submitted.length} submitted requests`}
          trend={totalRequested > 0 ? "up" : "neutral"}
        />
        <StatCard
          label="Est. Cost / Submission"
          value="$0.15"
          sub="Proxy + AI processing"
        />
        <StatCard
          label="Est. ROI"
          value={roi > 0 ? `${roi.toFixed(0)}%` : "—"}
          sub={`Est. total cost $${estCost.toFixed(2)}`}
          trend={roi > 100 ? "up" : roi > 0 ? "neutral" : "down"}
        />
        <StatCard
          label="Cost per $1 Requested"
          value={
            costPerFundedDollar > 0
              ? `$${costPerFundedDollar.toFixed(4)}`
              : "—"
          }
          sub={`${successRate.toFixed(1)}% conversion rate`}
        />
      </div>
      {subs.length === 0 && (
        <p className="text-center text-sm text-navy-400">
          Record awarded outcomes to calculate ROI.
        </p>
      )}

      {/* 3. Submission Volume */}
      <Card
        title="Submission Volume"
        description="Weekly submission totals over the last 12 weeks"
      >
        <div className="relative" style={{ height: 250 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={trends}
              margin={{ top: 10, right: 30, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
              <XAxis dataKey="week" tick={TICK} />
              <YAxis tick={TICK} allowDecimals={false} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                itemStyle={{ color: "#e2e8f0" }}
                formatter={(v, name) => [
                  String(Number(v)),
                  name === "total" ? "Total" : "Successful",
                ]}
              />
              {subs.length > 0 && (
                <>
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke={C.blue}
                    strokeWidth={2}
                    dot={{ r: 3, fill: C.blue }}
                    activeDot={{ r: 5 }}
                    name="total"
                  />
                  <Line
                    type="monotone"
                    dataKey="success"
                    stroke={C.green}
                    strokeWidth={2}
                    dot={{ r: 3, fill: C.green }}
                    activeDot={{ r: 5 }}
                    name="success"
                  />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
          {subs.length === 0 && (
            <ChartEmptyOverlay message="No submission history." />
          )}
        </div>
      </Card>

      {/* 4 + 5. Channel Comparison & Category Pie */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 4. Channel Comparison — PieChart */}
        <Card
          title="Channel Comparison"
          description="Submissions by automation channel"
        >
          <div className="relative" style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={channels}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={85}
                  dataKey="total"
                  nameKey="mode"
                >
                  {channels.map((_c, i) => (
                    <Cell
                      key={i}
                      fill={PIE_COLORS[i % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={{ color: "#e2e8f0" }}
                  formatter={(v, name) => [String(Number(v)), String(name)]}
                />
                {channels.length > 0 && (
                  <Legend wrapperStyle={{ fontSize: 12, color: C.axis }} />
                )}
              </PieChart>
            </ResponsiveContainer>
            {channels.length === 0 && (
              <ChartEmptyOverlay message="No submissions yet." />
            )}
          </div>
        </Card>

        {/* 5. Category Performance Pie */}
        <Card
          title="Category Performance"
          description="Click a slice to filter charts by category"
        >
          <div className="relative" style={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  activeIndex={activePieIdx}
                  activeShape={renderPieActiveShape}
                  data={categories}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  dataKey="total"
                  onMouseEnter={(_d, idx) => setActivePieIdx(idx)}
                  onClick={(d: unknown) => {
                    const cat = (d as CatPt).category;
                    setSelectedCategory((prev) => (prev === cat ? null : cat));
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {categories.map((_c, i) => (
                    <Cell
                      key={i}
                      fill={PIE_COLORS[i % PIE_COLORS.length]}
                      opacity={
                        selectedCategory &&
                        categories[i]?.category !== selectedCategory
                          ? 0.35
                          : 1
                      }
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={{ color: "#e2e8f0" }}
                  formatter={(v, name) => [String(Number(v)), String(name)]}
                />
              </PieChart>
            </ResponsiveContainer>
            {categories.length === 0 && (
              <ChartEmptyOverlay message="No category data yet." />
            )}
          </div>
        </Card>
      </div>

      {/* 6. Funder Response Time */}
      <Card
        title="Funder Response Time"
        description="Average days since submission per funder — longest waits first"
      >
        <div
          className="relative"
          style={{ height: Math.max(250, waitingRows.length * 34 + 20) }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={waitingRows}
              layout="vertical"
              margin={{ top: 0, right: 60, bottom: 0, left: 120 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={C.grid}
                horizontal={false}
              />
              <XAxis type="number" tick={TICK} unit=" d" />
              <YAxis
                type="category"
                dataKey="funder"
                width={116}
                tick={{ fill: C.axis, fontSize: 10 }}
              />
              {waitingRows.length > 0 && (
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  itemStyle={{ color: "#e2e8f0" }}
                  formatter={(v) => [
                    `${Number(v).toFixed(1)} days`,
                    "Avg Wait",
                  ]}
                />
              )}
              <Bar dataKey="avgDays" radius={[0, 3, 3, 0]} name="Avg Days">
                {waitingRows.map((row, i) => (
                  <Cell
                    key={i}
                    fill={
                      row.avgDays < 14
                        ? C.green
                        : row.avgDays < 30
                          ? C.amber
                          : C.red
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {waitingRows.length === 0 && (
            <ChartEmptyOverlay message="Track responses to see timing data." />
          )}
        </div>
        {waitingRows.length > 0 && (
          <div className="mt-3 flex items-center gap-5 text-xs text-navy-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              &lt;14 days (fast)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              14–30 days (medium)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
              &gt;30 days (slow)
            </span>
          </div>
        )}
      </Card>

      {/* 7. A/B Test Results */}
      <Card
        title="A/B Test Results"
        description="Submission variant performance by funder category"
        actions={
          <Link
            href="/autoapply/settings"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-navy-400 transition hover:bg-navy-100 hover:text-navy-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Configure Tests
          </Link>
        }
      >
        {abRows.length === 0 ? (
          <p className="text-sm text-navy-500">
            No A/B variants yet. Assign a{" "}
            <code className="rounded bg-navy-100 px-1 text-xs">
              variant_id
            </code>{" "}
            to submissions to track test performance.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-navy-100 text-sm">
              <thead>
                <tr className="bg-navy-50">
                  {[
                    "Category",
                    "Variant",
                    "Submissions",
                    "Conversions",
                    "Rate",
                    "",
                  ].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 bg-white">
                {abRows.map((row, i) => {
                  const catRows = abRows.filter(
                    (r) => r.category === row.category,
                  );
                  const bestRate = Math.max(...catRows.map((r) => r.rate));
                  const isWinner =
                    row.rate === bestRate &&
                    catRows.length > 1 &&
                    row.total >= 5;
                  return (
                    <tr key={i} className="hover:bg-navy-50">
                      <td className="px-4 py-2.5 font-medium text-navy-900">
                        {row.category}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-navy-600">
                        {row.variantId.slice(0, 8)}
                      </td>
                      <td className="px-4 py-2.5 text-navy-600">
                        {row.total}
                      </td>
                      <td className="px-4 py-2.5 text-navy-600">
                        {row.success}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={
                            row.rate >= 70
                              ? "font-semibold text-teal-400"
                              : row.rate >= 40
                                ? "font-semibold text-amber-400"
                                : "text-red-400"
                          }
                        >
                          {row.rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {isWinner && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-400/15 px-2 py-0.5 text-xs font-medium text-yellow-300 ring-1 ring-yellow-400/25">
                            <Award className="h-3 w-3" />
                            Winner
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
