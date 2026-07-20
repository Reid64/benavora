"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";

// AG-39 ROI Optimizer Agent UI (AUTONOMOUS_PLATFORM_VISION.md Phase 5,
// "ROI Optimization Engine"). Talks to /api/reports/roi, which reads
// roi_insights (written by src/lib/agents/roi-optimizer-agent.ts's monthly
// run()) plus a deterministic aggregation over submission_variables +
// outcomes. Every color on this page is an inline hex value per
// BLUEPRINT_v2.md §7.5 — no CSS variables, no Tailwind color classes.

interface RoiInsight {
  id: string;
  insight_type: string;
  insight_description: string;
  winning_pattern: string | null;
  losing_pattern: string | null;
  sample_size: number | null;
  confidence: number | null;
  recommended_action: string | null;
  generated_at: string;
}

interface DayStat {
  day: number;
  label: string;
  winRate: number | null;
  sampleSize: number;
}

interface WordCountBucket {
  label: string;
  winRate: number | null;
  sampleSize: number;
}

interface AttachmentStat {
  label: string;
  withRate: number | null;
  withSample: number;
  withoutRate: number | null;
  withoutSample: number;
}

interface RoiStats {
  applicationsTracked: number;
  decidedCount: number;
  winRate: number | null;
  bestSubmissionDay: DayStat | null;
  optimalWordCountRange: WordCountBucket | null;
  winRateByDay: DayStat[];
  wordCountDistribution: {
    winnersAvg: number | null;
    losersAvg: number | null;
    winnersSample: number;
    losersSample: number;
    buckets: WordCountBucket[];
  };
  attachmentImpact: AttachmentStat[];
}

const cardStyle: CSSProperties = {
  backgroundColor: "#FFFFFF",
  borderRadius: "14px",
  padding: "28px",
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

function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n * 100)}%`;
}

function formatInsightType(insightType: string): string {
  return insightType
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

function confidenceColor(confidence: number | null): string {
  if (confidence === null) return "#64748B";
  if (confidence >= 0.8) return "#10B981";
  if (confidence >= 0.6) return "#F59E0B";
  return "#EF4444";
}

function MetricCard({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string;
  accent: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        ...cardStyle,
        padding: "22px 24px",
        borderTop: `4px solid ${accent}`,
        borderRadius: "12px",
      }}
    >
      <p style={sectionLabelStyle}>{label}</p>
      <p style={{ fontSize: "28px", fontWeight: 900, color: "#0F172A", margin: "8px 0 0" }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: "12px", color: "#64748B", margin: "4px 0 0" }}>{sub}</p>}
    </div>
  );
}

function InsightCard({ insight }: { insight: RoiInsight }) {
  return (
    <div style={{ ...cardStyle, padding: "24px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "12px",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#FFFFFF",
            backgroundColor: "#6B48CC",
            padding: "4px 12px",
            borderRadius: "999px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {formatInsightType(insight.insight_type)}
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#334155",
              backgroundColor: "#F1F5F9",
              padding: "4px 10px",
              borderRadius: "999px",
            }}
          >
            Sample: {insight.sample_size ?? "—"}
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#FFFFFF",
              backgroundColor: confidenceColor(insight.confidence),
              padding: "4px 10px",
              borderRadius: "999px",
            }}
          >
            {insight.confidence !== null
              ? `${Math.round(insight.confidence * 100)}% confidence`
              : "confidence —"}
          </span>
        </div>
      </div>

      <p style={{ fontSize: "14px", color: "#0F172A", lineHeight: 1.6, margin: "0 0 16px" }}>
        {insight.insight_description}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "12px",
          marginBottom: insight.recommended_action ? "16px" : 0,
        }}
      >
        {insight.winning_pattern && (
          <div
            style={{
              backgroundColor: "#ECFDF5",
              border: "1px solid #A7F3D0",
              borderRadius: "10px",
              padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <TrendingUp size={14} color="#10B981" />
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#047857" }}>
                WINNING PATTERN
              </span>
            </div>
            <p style={{ fontSize: "13px", color: "#065F46", margin: 0, lineHeight: 1.5 }}>
              {insight.winning_pattern}
            </p>
          </div>
        )}
        {insight.losing_pattern && (
          <div
            style={{
              backgroundColor: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: "10px",
              padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <TrendingDown size={14} color="#EF4444" />
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#B91C1C" }}>
                LOSING PATTERN
              </span>
            </div>
            <p style={{ fontSize: "13px", color: "#991B1B", margin: 0, lineHeight: 1.5 }}>
              {insight.losing_pattern}
            </p>
          </div>
        )}
      </div>

      {insight.recommended_action && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "#0077B6",
            color: "#FFFFFF",
            fontSize: "13px",
            fontWeight: 700,
            padding: "10px 18px",
            borderRadius: "10px",
          }}
        >
          Recommended: {insight.recommended_action}
        </div>
      )}
    </div>
  );
}

function DayOfWeekChart({ data }: { data: DayStat[] }) {
  const barWidth = 48;
  const gap = 20;
  const chartHeight = 140;
  const width = data.length * (barWidth + gap);
  const maxRate = Math.max(
    0,
    ...data.filter((d) => d.sampleSize > 0 && d.winRate !== null).map((d) => d.winRate as number),
  );

  return (
    <svg width={width} height={chartHeight + 40} role="img" aria-label="Win rate by day of week">
      {data.map((d, i) => {
        const rate = d.winRate ?? 0;
        const barHeight = d.sampleSize > 0 ? Math.max(4, rate * chartHeight) : 2;
        const x = i * (barWidth + gap) + gap / 2;
        const y = chartHeight - barHeight;
        const isHighest = d.sampleSize > 0 && d.winRate !== null && maxRate > 0 && d.winRate === maxRate;
        const color = isHighest ? "#10B981" : "#94A3B8";
        return (
          <g key={d.day}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx={6} fill={color} />
            <text x={x + barWidth / 2} y={y - 8} textAnchor="middle" fontSize="11" fontWeight={700} fill="#0F172A">
              {d.sampleSize > 0 ? formatPercent(d.winRate) : "—"}
            </text>
            <text
              x={x + barWidth / 2}
              y={chartHeight + 20}
              textAnchor="middle"
              fontSize="12"
              fontWeight={600}
              fill="#64748B"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function WordCountChart({
  winnersAvg,
  losersAvg,
  winnersSample,
  losersSample,
}: {
  winnersAvg: number | null;
  losersAvg: number | null;
  winnersSample: number;
  losersSample: number;
}) {
  const barWidth = 90;
  const gap = 60;
  const chartHeight = 140;
  const maxVal = Math.max(winnersAvg ?? 0, losersAvg ?? 0, 1);
  const bars = [
    { label: "Winners", sub: `n=${winnersSample}`, value: winnersAvg ?? 0, color: "#10B981" },
    { label: "Losers", sub: `n=${losersSample}`, value: losersAvg ?? 0, color: "#EF4444" },
  ];

  return (
    <svg
      width={bars.length * (barWidth + gap)}
      height={chartHeight + 48}
      role="img"
      aria-label="Average word count, winners vs losers"
    >
      {bars.map((bar, i) => {
        const barHeight = bar.value > 0 ? Math.max(4, (bar.value / maxVal) * chartHeight) : 2;
        const x = i * (barWidth + gap) + gap / 2;
        const y = chartHeight - barHeight;
        return (
          <g key={bar.label}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx={6} fill={bar.color} />
            <text x={x + barWidth / 2} y={y - 8} textAnchor="middle" fontSize="12" fontWeight={700} fill="#0F172A">
              {bar.value > 0 ? Math.round(bar.value).toLocaleString() : "—"}
            </text>
            <text
              x={x + barWidth / 2}
              y={chartHeight + 20}
              textAnchor="middle"
              fontSize="12"
              fontWeight={700}
              fill="#0F172A"
            >
              {bar.label}
            </text>
            <text
              x={x + barWidth / 2}
              y={chartHeight + 36}
              textAnchor="middle"
              fontSize="11"
              fontWeight={600}
              fill="#64748B"
            >
              {bar.sub}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function AttachmentChart({ data }: { data: AttachmentStat[] }) {
  const barWidth = 40;
  const barGap = 10;
  const groupGap = 50;
  const chartHeight = 140;
  const groupWidth = barWidth * 2 + barGap;

  return (
    <svg
      width={data.length * (groupWidth + groupGap)}
      height={chartHeight + 56}
      role="img"
      aria-label="Win rate with vs without budget or logic model"
    >
      {data.map((group, gi) => {
        const groupX = gi * (groupWidth + groupGap);
        const withHeight = group.withSample > 0 ? Math.max(4, (group.withRate ?? 0) * chartHeight) : 2;
        const withoutHeight =
          group.withoutSample > 0 ? Math.max(4, (group.withoutRate ?? 0) * chartHeight) : 2;
        return (
          <g key={group.label}>
            <rect
              x={groupX}
              y={chartHeight - withHeight}
              width={barWidth}
              height={withHeight}
              rx={6}
              fill="#0096C7"
            />
            <text
              x={groupX + barWidth / 2}
              y={chartHeight - withHeight - 8}
              textAnchor="middle"
              fontSize="11"
              fontWeight={700}
              fill="#0F172A"
            >
              {group.withSample > 0 ? formatPercent(group.withRate) : "—"}
            </text>
            <rect
              x={groupX + barWidth + barGap}
              y={chartHeight - withoutHeight}
              width={barWidth}
              height={withoutHeight}
              rx={6}
              fill="#B8C9D9"
            />
            <text
              x={groupX + barWidth + barGap + barWidth / 2}
              y={chartHeight - withoutHeight - 8}
              textAnchor="middle"
              fontSize="11"
              fontWeight={700}
              fill="#0F172A"
            >
              {group.withoutSample > 0 ? formatPercent(group.withoutRate) : "—"}
            </text>
            <text
              x={groupX + groupWidth / 2}
              y={chartHeight + 24}
              textAnchor="middle"
              fontSize="12"
              fontWeight={700}
              fill="#0F172A"
            >
              {group.label}
            </text>
          </g>
        );
      })}
      <g>
        <rect x={0} y={chartHeight + 36} width={12} height={12} rx={3} fill="#0096C7" />
        <text x={18} y={chartHeight + 46} fontSize="11" fill="#64748B">
          With
        </text>
        <rect x={70} y={chartHeight + 36} width={12} height={12} rx={3} fill="#B8C9D9" />
        <text x={88} y={chartHeight + 46} fontSize="11" fill="#64748B">
          Without
        </text>
      </g>
    </svg>
  );
}

export default function RoiInsightsPage() {
  const [insights, setInsights] = useState<RoiInsight[]>([]);
  const [stats, setStats] = useState<RoiStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/reports/roi", { cache: "no-store" });
        const data = (await res.json()) as {
          insights?: RoiInsight[];
          stats?: RoiStats;
          error?: string;
        };
        if (!res.ok || !data.stats) {
          setError(data.error ?? "Failed to load ROI insights.");
          return;
        }
        setInsights(data.insights ?? []);
        setStats(data.stats);
      } catch {
        setError("Network error loading ROI insights.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100%", padding: "32px" }}>
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: 800,
            color: "#0F172A",
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          ROI Optimization Insights
        </h1>
        <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
          Data-driven patterns from your submission history.
        </p>
      </div>

      {loading && (
        <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: "10px" }}>
          <Loader2 size={16} className="animate-spin" color="#0077B6" />
          <span style={{ fontSize: "14px", color: "#64748B" }}>Loading ROI insights...</span>
        </div>
      )}

      {!loading && error && (
        <div style={{ ...cardStyle, borderLeft: "4px solid #EF4444" }}>
          <p style={{ fontSize: "14px", color: "#B91C1C", margin: 0 }}>{error}</p>
        </div>
      )}

      {!loading && !error && stats && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px",
              marginBottom: "28px",
            }}
          >
            <MetricCard
              label="Applications Tracked"
              value={stats.applicationsTracked.toLocaleString()}
              accent="#0077B6"
              sub={`${stats.decidedCount.toLocaleString()} with a recorded outcome`}
            />
            <MetricCard
              label="Win Rate"
              value={formatPercent(stats.winRate)}
              accent="#10B981"
              sub={stats.decidedCount > 0 ? `${stats.decidedCount} decided applications` : "No decided applications yet"}
            />
            <MetricCard
              label="Best Submission Day"
              value={stats.bestSubmissionDay ? stats.bestSubmissionDay.label : "—"}
              accent="#6B48CC"
              sub={
                stats.bestSubmissionDay
                  ? `${formatPercent(stats.bestSubmissionDay.winRate)} win rate (n=${stats.bestSubmissionDay.sampleSize})`
                  : "Not enough data yet"
              }
            />
            <MetricCard
              label="Optimal Word Count Range"
              value={stats.optimalWordCountRange ? `${stats.optimalWordCountRange.label} words` : "—"}
              accent="#F59E0B"
              sub={
                stats.optimalWordCountRange
                  ? `${formatPercent(stats.optimalWordCountRange.winRate)} win rate (n=${stats.optimalWordCountRange.sampleSize})`
                  : "Not enough data yet"
              }
            />
          </div>

          <div style={{ marginBottom: "28px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginBottom: "16px" }}>
              Insights
            </h2>
            {insights.length === 0 ? (
              <div style={cardStyle}>
                <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>
                  No ROI insights yet. AG-39 needs at least 10 tracked submissions with recorded
                  outcomes before it can detect a significant pattern.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {insights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", marginBottom: "16px" }}>
              Submission Patterns
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: "16px",
              }}
            >
              <div style={cardStyle}>
                <p style={{ ...sectionLabelStyle, marginBottom: "16px" }}>
                  Win Rate by Day of Week
                </p>
                <div style={{ overflowX: "auto" }}>
                  <DayOfWeekChart data={stats.winRateByDay} />
                </div>
              </div>

              <div style={cardStyle}>
                <p style={{ ...sectionLabelStyle, marginBottom: "16px" }}>
                  Word Count: Winners vs Losers
                </p>
                <div style={{ overflowX: "auto" }}>
                  <WordCountChart
                    winnersAvg={stats.wordCountDistribution.winnersAvg}
                    losersAvg={stats.wordCountDistribution.losersAvg}
                    winnersSample={stats.wordCountDistribution.winnersSample}
                    losersSample={stats.wordCountDistribution.losersSample}
                  />
                </div>
              </div>

              <div style={cardStyle}>
                <p style={{ ...sectionLabelStyle, marginBottom: "16px" }}>
                  Attachment Impact
                </p>
                <div style={{ overflowX: "auto" }}>
                  <AttachmentChart data={stats.attachmentImpact} />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
