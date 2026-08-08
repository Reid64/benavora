"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Download, FileText, Loader2, Printer, TrendingDown, TrendingUp } from "lucide-react";

import { humanizeEnum } from "@/lib/utils/formatters";

// Funding Summary Report — comprehensive pipeline/award report at
// /reports/funding-summary, backed by /api/reports/funding-summary.
// Every color on this page is an inline hex value per BLUEPRINT_v2.md §7.5 —
// no CSS variables, no Tailwind color classes. See the API route's header
// comment for why "Funding by Program" is built as "Funding by Category"
// (opportunities.category) instead — there is no program_id linking
// applications to the org's own `programs` table.

type Period = "month" | "quarter" | "year" | "all";

interface SourceBucket {
  key: string;
  label: string;
  count: number;
  amount: number;
}

interface CategoryRow {
  category: string;
  applications: number;
  awarded: number;
  successRate: number | null;
  totalAwarded: number;
}

interface TrendPoint {
  month: string;
  found: number;
  submitted: number;
  awarded: number;
}

interface TopFunder {
  funderId: string;
  funderName: string;
  timesApplied: number;
  timesAwarded: number;
  successRate: number | null;
  avgAwardAmount: number | null;
  lastAwardDate: string | null;
}

// Market Trend Intelligence MVP (FEATURE_REGISTRY_v2.md row #134) — see
// /api/intelligence/trends's header comment for the full scope note on why
// this is a volume-over-existing-data view, not the full Pillar 11 "federal
// budget + foundation trend analysis" concept.
interface TrendMonth {
  key: string;
  label: string;
  total: number;
  byCategory: Record<string, number>;
  bySourceType: Record<string, number>;
}

interface TrendsResponse {
  primary: {
    totalOpportunities: number;
    monthsWithData: number;
    hasEnoughData: boolean;
    months: TrendMonth[];
    categories: string[];
    sourceTypes: string[];
  };
  fundedProposals: {
    total: number;
    hasEnoughData: boolean;
    years: { year: number; count: number }[];
  };
}

type TrendGrouping = "sourceType" | "category";

const GROUP_PALETTE = [
  "#0077B6",
  "#6B48CC",
  "#F59E0B",
  "#00B4D8",
  "#10B981",
  "#EF4444",
  "#EC4899",
  "#4F46E5",
  "#14B8A6",
  "#84CC16",
  "#F97316",
  "#8B5CF6",
];
const UNCLASSIFIED_COLOR = "#94A3B8";

function colorForGroupKey(key: string, orderedKeys: string[]): string {
  if (key === "unclassified") return UNCLASSIFIED_COLOR;
  const idx = orderedKeys.indexOf(key);
  return GROUP_PALETTE[idx % GROUP_PALETTE.length] ?? "#64748B";
}

function StackedTrendChart({
  months,
  groupKeys,
  grouping,
}: {
  months: TrendMonth[];
  groupKeys: string[];
  grouping: TrendGrouping;
}) {
  const width = 900;
  const height = 220;
  const padding = 32;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const barGap = 6;
  const barWidth = months.length > 0 ? innerWidth / months.length - barGap : 0;
  const maxTotal = Math.max(1, ...months.map((m) => m.total));

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={padding}
            x2={width - padding}
            y1={padding + innerHeight * f}
            y2={padding + innerHeight * f}
            stroke="#E2E8F0"
            strokeWidth={1}
          />
        ))}
        {months.map((m, i) => {
          const x = padding + i * (barWidth + barGap);
          const byGroup = grouping === "sourceType" ? m.bySourceType : m.byCategory;
          let stackedY = padding + innerHeight;
          return (
            <g key={m.key}>
              {groupKeys.map((key) => {
                const count = byGroup[key] ?? 0;
                if (count === 0) return null;
                const segHeight = (count / maxTotal) * innerHeight;
                stackedY -= segHeight;
                return (
                  <rect
                    key={key}
                    x={x}
                    y={stackedY}
                    width={Math.max(2, barWidth)}
                    height={segHeight}
                    fill={colorForGroupKey(key, groupKeys)}
                    rx={2}
                  />
                );
              })}
              <text
                x={x + barWidth / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize="10"
                fill="#64748B"
              >
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: "14px", marginTop: "8px", flexWrap: "wrap" }}>
        {groupKeys.map((key) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "3px",
                backgroundColor: colorForGroupKey(key, groupKeys),
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: "12px", color: "#64748B" }}>{humanizeEnum(key)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FundedProposalsMiniChart({
  years,
}: {
  years: { year: number; count: number }[];
}) {
  const maxCount = Math.max(1, ...years.map((y) => y.count));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", height: "80px" }}>
      {years.map((y) => (
        <div key={y.year} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#0F172A" }}>{y.count}</span>
          <div
            style={{
              width: "28px",
              height: `${Math.max(4, (y.count / maxCount) * 48)}px`,
              backgroundColor: "#6B48CC",
              borderRadius: "4px 4px 0 0",
            }}
          />
          <span style={{ fontSize: "11px", color: "#64748B" }}>{y.year}</span>
        </div>
      ))}
    </div>
  );
}

interface FundingSummaryResponse {
  period: Period;
  dateRange: { from: string | null; to: string };
  summary: {
    totalOpportunitiesTracked: number;
    totalApplied: number;
    totalRequested: number;
    totalAwardedCount: number;
    totalAwardedAmount: number;
    successRate: number | null;
    successRateTrend: "up" | "down" | "flat" | null;
    pipelineValue: number;
  };
  fundingBySource: SourceBucket[];
  fundingByCategory: CategoryRow[];
  trend: TrendPoint[];
  topFunders: TopFunder[];
}

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: "month", label: "This Month" },
  { key: "quarter", label: "This Quarter" },
  { key: "year", label: "This Year" },
  { key: "all", label: "All Time" },
];

const SOURCE_COLORS: Record<string, string> = {
  federal: "#0077B6",
  foundation: "#6B48CC",
  corporate: "#F59E0B",
  state_local: "#00B4D8",
  land_bank: "#10B981",
};

const cardStyle: CSSProperties = {
  backgroundColor: "#FFFFFF",
  borderRadius: "14px",
  padding: "24px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
};

const sectionLabelStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  margin: 0,
};

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatPercent(n: number | null): string {
  if (n === null) return "—";
  return `${Math.round(n * 100)}%`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function MetricCard({
  label,
  value,
  sub,
  accent,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  trend?: "up" | "down" | "flat" | null;
}) {
  return (
    <div style={{ ...cardStyle, padding: "20px 22px", borderTop: `4px solid ${accent}`, borderRadius: "12px" }}>
      <p style={sectionLabelStyle}>{label}</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "8px" }}>
        <p style={{ fontSize: "26px", fontWeight: 900, color: "#0F172A", margin: 0 }}>{value}</p>
        {trend === "up" && <TrendingUp size={16} color="#10B981" />}
        {trend === "down" && <TrendingDown size={16} color="#EF4444" />}
      </div>
      {sub && <p style={{ fontSize: "12px", color: "#64748B", margin: "4px 0 0" }}>{sub}</p>}
    </div>
  );
}

function SourceBarChart({ buckets }: { buckets: SourceBucket[] }) {
  const chartHeight = 180;
  const barWidth = 64;
  const barGap = 28;
  const maxAmount = Math.max(1, ...buckets.map((b) => b.amount));
  const chartWidth = buckets.length * (barWidth + barGap);

  return (
    <svg width="100%" height={chartHeight + 56} viewBox={`0 0 ${chartWidth} ${chartHeight + 56}`} role="img">
      {buckets.map((bucket, i) => {
        const x = i * (barWidth + barGap);
        const height = bucket.amount > 0 ? Math.max(6, (bucket.amount / maxAmount) * chartHeight) : 2;
        const color = SOURCE_COLORS[bucket.key] ?? "#64748B";
        return (
          <g key={bucket.key}>
            <rect x={x} y={chartHeight - height} width={barWidth} height={height} rx={8} fill={color} />
            <text x={x + barWidth / 2} y={chartHeight - height - 10} textAnchor="middle" fontSize="12" fontWeight={800} fill="#0F172A">
              {bucket.amount > 0 ? formatCurrency(bucket.amount) : "$0"}
            </text>
            <text x={x + barWidth / 2} y={chartHeight + 20} textAnchor="middle" fontSize="12" fontWeight={700} fill="#0F172A">
              {bucket.label}
            </text>
            <text x={x + barWidth / 2} y={chartHeight + 38} textAnchor="middle" fontSize="11" fill="#64748B">
              {bucket.count} award{bucket.count === 1 ? "" : "s"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function TrendLineChart({ trend }: { trend: TrendPoint[] }) {
  const width = 900;
  const height = 220;
  const padding = 32;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const maxValue = Math.max(1, ...trend.flatMap((t) => [t.found, t.submitted, t.awarded]));
  const stepX = trend.length > 1 ? innerWidth / (trend.length - 1) : 0;

  function pointsFor(key: "found" | "submitted" | "awarded"): string {
    return trend
      .map((t, i) => {
        const x = padding + i * stepX;
        const y = padding + innerHeight - (t[key] / maxValue) * innerHeight;
        return `${x},${y}`;
      })
      .join(" ");
  }

  const series: { key: "found" | "submitted" | "awarded"; label: string; color: string }[] = [
    { key: "found", label: "Opportunities Found", color: "#0077B6" },
    { key: "submitted", label: "Applications Submitted", color: "#6B48CC" },
    { key: "awarded", label: "Awards", color: "#10B981" },
  ];

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={padding}
            x2={width - padding}
            y1={padding + innerHeight * f}
            y2={padding + innerHeight * f}
            stroke="#E2E8F0"
            strokeWidth={1}
          />
        ))}
        {series.map((s) => (
          <polyline key={s.key} points={pointsFor(s.key)} fill="none" stroke={s.color} strokeWidth={2.5} />
        ))}
        {series.map((s) =>
          trend.map((t, i) => {
            const x = padding + i * stepX;
            const y = padding + innerHeight - (t[s.key] / maxValue) * innerHeight;
            return <circle key={`${s.key}-${i}`} cx={x} cy={y} r={3} fill={s.color} />;
          }),
        )}
        {trend.map((t, i) => {
          if (i % 2 !== 0 && trend.length > 8) return null;
          const x = padding + i * stepX;
          return (
            <text key={t.month + i} x={x} y={height - 6} textAnchor="middle" fontSize="11" fill="#64748B">
              {t.month}
            </text>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: "20px", marginTop: "8px", flexWrap: "wrap" }}>
        {series.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "3px", backgroundColor: s.color, display: "inline-block" }} />
            <span style={{ fontSize: "12px", color: "#64748B" }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function toCsv(data: FundingSummaryResponse): string {
  const lines: string[] = [];
  lines.push("Funding Summary Report");
  lines.push(`Period,${data.period}`);
  lines.push("");
  lines.push("Metric,Value");
  lines.push(`Total Opportunities Tracked,${data.summary.totalOpportunitiesTracked}`);
  lines.push(`Total Applied,${data.summary.totalApplied}`);
  lines.push(`Total Requested,${data.summary.totalRequested}`);
  lines.push(`Total Awarded Count,${data.summary.totalAwardedCount}`);
  lines.push(`Total Awarded Amount,${data.summary.totalAwardedAmount}`);
  lines.push(`Success Rate,${data.summary.successRate ?? ""}`);
  lines.push(`Pipeline Value,${data.summary.pipelineValue}`);
  lines.push("");
  lines.push("Funding by Source");
  lines.push("Source,Count,Amount");
  for (const b of data.fundingBySource) lines.push(`${b.label},${b.count},${b.amount}`);
  lines.push("");
  lines.push("Funding by Category");
  lines.push("Category,Applications,Awarded,Success Rate,Total Awarded");
  for (const c of data.fundingByCategory) {
    lines.push(
      `${humanizeEnum(c.category)},${c.applications},${c.awarded},${c.successRate ?? ""},${c.totalAwarded}`,
    );
  }
  lines.push("");
  lines.push("Top Funders");
  lines.push("Funder,Times Applied,Times Awarded,Success Rate,Avg Award,Last Award Date");
  for (const f of data.topFunders) {
    lines.push(
      `"${f.funderName.replace(/"/g, '""')}",${f.timesApplied},${f.timesAwarded},${f.successRate ?? ""},${f.avgAwardAmount ?? ""},${f.lastAwardDate ?? ""}`,
    );
  }
  return lines.join("\n");
}

export default function FundingSummaryReportPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<FundingSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [trendGrouping, setTrendGrouping] = useState<TrendGrouping>("sourceType");

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/funding-summary?period=${p}`, { cache: "no-store" });
      const body = (await res.json()) as FundingSummaryResponse & { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Failed to load funding summary.");
        return;
      }
      setData(body);
    } catch {
      setError("Network error loading funding summary.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  useEffect(() => {
    let active = true;
    (async () => {
      setTrendsLoading(true);
      setTrendsError(null);
      try {
        const res = await fetch("/api/intelligence/trends", { cache: "no-store" });
        const body = (await res.json()) as TrendsResponse & { error?: string };
        if (!active) return;
        if (!res.ok) {
          setTrendsError((body as { error?: string }).error ?? "Failed to load trend data.");
          return;
        }
        setTrends(body);
      } catch {
        if (active) setTrendsError("Network error loading trend data.");
      } finally {
        if (active) setTrendsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const csvHref = useMemo(() => {
    if (!data) return null;
    const csv = toCsv(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    return URL.createObjectURL(blob);
  }, [data]);

  function handleExportCsv() {
    if (!csvHref) return;
    const a = document.createElement("a");
    a.href = csvHref;
    a.download = `funding-summary-${period}-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleExportPdf() {
    window.print();
  }

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100%", padding: "32px" }}>
      <div
        className="print:hidden"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
          marginBottom: "28px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#0F172A", letterSpacing: "-0.02em", margin: 0 }}>
            Funding Summary Report
          </h1>
          <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
            Pipeline metrics, funding source breakdown, and program performance.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", backgroundColor: "#FFFFFF", borderRadius: "10px", padding: "4px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setPeriod(opt.key)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                  backgroundColor: period === opt.key ? "#0077B6" : "transparent",
                  color: period === opt.key ? "#FFFFFF" : "#64748B",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleExportPdf}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "10px 16px",
              borderRadius: "8px",
              border: "1px solid #B8C9D9",
              backgroundColor: "#FFFFFF",
              color: "#0F172A",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            <Printer size={14} />
            Export PDF
          </button>
          <button
            onClick={handleExportCsv}
            disabled={!data}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "10px 16px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: "#0077B6",
              color: "#FFFFFF",
              fontSize: "13px",
              fontWeight: 700,
              cursor: data ? "pointer" : "not-allowed",
              opacity: data ? 1 : 0.5,
            }}
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: "10px" }}>
          <Loader2 size={16} className="animate-spin" color="#0077B6" />
          <span style={{ fontSize: "14px", color: "#64748B" }}>Loading funding summary...</span>
        </div>
      )}

      {!loading && error && (
        <div style={{ ...cardStyle, borderLeft: "4px solid #EF4444" }}>
          <p style={{ fontSize: "14px", color: "#B91C1C", margin: 0 }}>{error}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Summary metrics */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px",
              marginBottom: "28px",
            }}
          >
            <MetricCard
              label="Total Opportunities Tracked"
              value={data.summary.totalOpportunitiesTracked.toLocaleString()}
              accent="#0077B6"
            />
            <MetricCard
              label="Total Applied"
              value={data.summary.totalApplied.toLocaleString()}
              sub={formatCurrency(data.summary.totalRequested) + " requested"}
              accent="#6B48CC"
            />
            <MetricCard
              label="Total Awarded"
              value={data.summary.totalAwardedCount.toLocaleString()}
              sub={formatCurrency(data.summary.totalAwardedAmount)}
              accent="#10B981"
            />
            <MetricCard
              label="Success Rate"
              value={formatPercent(data.summary.successRate)}
              sub="awarded / decided"
              accent="#F59E0B"
              trend={data.summary.successRateTrend}
            />
            <MetricCard
              label="Pipeline Value"
              value={formatCurrency(data.summary.pipelineValue)}
              sub="active applications"
              accent="#00B4D8"
            />
          </div>

          {/* Funding by source */}
          <div style={{ ...cardStyle, marginBottom: "28px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginBottom: "16px" }}>
              Funding by Source
            </h2>
            <SourceBarChart buckets={data.fundingBySource} />
          </div>

          {/* Funding by category */}
          <div style={{ ...cardStyle, marginBottom: "28px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginBottom: "4px" }}>
              Funding by Category
            </h2>
            <p style={{ fontSize: "12px", color: "#64748B", marginBottom: "16px" }}>
              Which funding categories have attracted the most award dollars.
            </p>
            {data.fundingByCategory.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>
                No applications recorded yet in this period.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #E2E8F0", textAlign: "left" }}>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600 }}>Category</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Applications</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Awarded</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Success Rate</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Total Awarded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.fundingByCategory.map((row) => (
                    <tr key={row.category} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "10px 4px", color: "#0F172A", fontWeight: 600 }}>
                        {humanizeEnum(row.category)}
                      </td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#0F172A" }}>{row.applications}</td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#0F172A" }}>{row.awarded}</td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#0F172A" }}>
                        {formatPercent(row.successRate)}
                      </td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#10B981", fontWeight: 700 }}>
                        {formatCurrency(row.totalAwarded)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Monthly pipeline trend */}
          <div style={{ ...cardStyle, marginBottom: "28px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginBottom: "16px" }}>
              Monthly Pipeline Trend
            </h2>
            <TrendLineChart trend={data.trend} />
          </div>

          {/* Market Trend Intelligence MVP (row #134) — opportunity discovery
              volume trend, split by source type or category. */}
          <div style={{ ...cardStyle, marginBottom: "28px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "12px",
                marginBottom: "16px",
              }}
            >
              <div>
                <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", margin: 0 }}>
                  Opportunity Volume Trend
                </h2>
                <p style={{ fontSize: "12px", color: "#64748B", marginTop: "4px" }}>
                  New opportunities discovered per month, last 12 months.
                </p>
              </div>
              {trends?.primary.hasEnoughData && (
                <div
                  style={{
                    display: "flex",
                    backgroundColor: "#F1F5F9",
                    borderRadius: "10px",
                    padding: "4px",
                  }}
                >
                  {(["sourceType", "category"] as TrendGrouping[]).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setTrendGrouping(g)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: "8px",
                        border: "none",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                        backgroundColor: trendGrouping === g ? "#0077B6" : "transparent",
                        color: trendGrouping === g ? "#FFFFFF" : "#64748B",
                      }}
                    >
                      {g === "sourceType" ? "By Source Type" : "By Category"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {trendsLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "20px 0" }}>
                <Loader2 size={16} className="animate-spin" color="#0077B6" />
                <span style={{ fontSize: "13px", color: "#64748B" }}>Loading opportunity trend...</span>
              </div>
            )}

            {!trendsLoading && trendsError && (
              <p style={{ fontSize: "13px", color: "#B91C1C", margin: 0 }}>{trendsError}</p>
            )}

            {!trendsLoading && !trendsError && trends && !trends.primary.hasEnoughData && (
              <p style={{ fontSize: "13px", color: "#64748B", margin: 0, fontStyle: "italic" }}>
                Not enough data yet to show a meaningful trend
                {trends.primary.totalOpportunities > 0
                  ? ` — only ${trends.primary.totalOpportunities} opportunit${trends.primary.totalOpportunities === 1 ? "y" : "ies"} on file across ${trends.primary.monthsWithData} month${trends.primary.monthsWithData === 1 ? "" : "s"} so far.`
                  : " — no opportunities discovered yet."}
              </p>
            )}

            {!trendsLoading && !trendsError && trends && trends.primary.hasEnoughData && (
              <StackedTrendChart
                months={trends.primary.months}
                groupKeys={trendGrouping === "sourceType" ? trends.primary.sourceTypes : trends.primary.categories}
                grouping={trendGrouping}
              />
            )}

            {/* Secondary, clearly-separate panel: intelligence_funded_proposals
                (a different, platform-wide table populated by the NIH/NSF/
                Federal Register/SAMHSA ingestion scripts — not merged with the
                opportunities series above). */}
            {!trendsLoading && !trendsError && trends && (
              <div style={{ marginTop: "20px", paddingTop: "20px", borderTop: "1px solid #E2E8F0" }}>
                <p style={sectionLabelStyle}>Funded Proposal Library — By Award Year</p>
                {trends.fundedProposals.hasEnoughData ? (
                  <div style={{ marginTop: "10px" }}>
                    <FundedProposalsMiniChart years={trends.fundedProposals.years} />
                  </div>
                ) : (
                  <p style={{ fontSize: "12px", color: "#94A3B8", fontStyle: "italic", margin: "8px 0 0" }}>
                    Not enough data yet
                    {trends.fundedProposals.total > 0
                      ? ` — ${trends.fundedProposals.total} proposal${trends.fundedProposals.total === 1 ? "" : "s"} on file, spanning too few award years for a trend.`
                      : " — the funded proposal library is empty."}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Top funders */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
              <FileText size={16} color="#0077B6" />
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", margin: 0 }}>Top Funders</h2>
            </div>
            {data.topFunders.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>
                No awarded applications yet — top funders will appear once you record an outcome.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #E2E8F0", textAlign: "left" }}>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600 }}>Funder</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Times Applied</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Times Awarded</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Success Rate</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Avg Award</th>
                    <th style={{ padding: "8px 4px", color: "#64748B", fontWeight: 600, textAlign: "right" }}>Last Award</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topFunders.map((f) => (
                    <tr key={f.funderId} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "10px 4px", color: "#0F172A", fontWeight: 600 }}>{f.funderName}</td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#0F172A" }}>{f.timesApplied}</td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#0F172A" }}>{f.timesAwarded}</td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#0F172A" }}>
                        {formatPercent(f.successRate)}
                      </td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#0F172A" }}>
                        {f.avgAwardAmount !== null ? formatCurrency(f.avgAwardAmount) : "—"}
                      </td>
                      <td style={{ padding: "10px 4px", textAlign: "right", color: "#64748B" }}>
                        {formatDate(f.lastAwardDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
