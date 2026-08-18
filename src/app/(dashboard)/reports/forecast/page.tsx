"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

// AG-26 Funding Forecast Agent UI (FEATURE_REGISTRY_v2.md row #133,
// AUTONOMOUS_PLATFORM_VISION.md Pillar 11, "Predictive Funding Forecast").
// Talks to /api/reports/forecast, which reads/writes funding_forecasts
// (src/lib/agents/funding-forecast-agent.ts's monthly/manual run()). Every
// color on this page is an inline hex value per BLUEPRINT_v2.md §7.5 — no
// CSS variables, no Tailwind color classes.

type ForecastPeriod = "90_day" | "12_month";

interface ForecastRow {
  id: string;
  org_id: string;
  forecast_date: string;
  forecast_period: ForecastPeriod;
  projected_min: number | null;
  projected_max: number | null;
  projected_most_likely: number | null;
  confidence: number | null;
  methodology: string | null;
  key_risks: string[] | null;
  key_opportunities: string[] | null;
  recommended_actions: string[] | null;
  created_at: string;
}

const PERIOD_LABEL: Record<ForecastPeriod, string> = {
  "90_day": "90-Day Forecast",
  "12_month": "12-Month Forecast",
};

const PERIOD_ORDER: ForecastPeriod[] = ["90_day", "12_month"];

const cardStyle: CSSProperties = {
  backgroundColor: "#F8F5EE",
  borderRadius: "14px",
  padding: "28px",
  boxShadow: "0 4px 20px rgba(122,89,128,0.18)",
};

const sectionLabelStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  margin: 0,
};

function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function confidenceColor(confidence: number | null): string {
  if (confidence === null) return "#64748B";
  if (confidence >= 80) return "#10B981";
  if (confidence >= 60) return "#F59E0B";
  return "#EF4444";
}

function NarrativeList({
  title,
  items,
  icon,
  color,
}: {
  title: string;
  items: string[];
  icon: ReactNode;
  color: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
        {icon}
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {title}
        </span>
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        {items.map((item, i) => (
          <li
            key={i}
            style={{
              fontSize: "13px",
              color: "#334155",
              lineHeight: 1.5,
              paddingLeft: "14px",
              position: "relative",
            }}
          >
            <span style={{ position: "absolute", left: 0, color }}>•</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ForecastCard({
  row,
  priorMostLikely,
}: {
  row: ForecastRow;
  priorMostLikely: number | null;
}) {
  const hasNarrative =
    (row.key_risks?.length ?? 0) > 0 ||
    (row.key_opportunities?.length ?? 0) > 0 ||
    (row.recommended_actions?.length ?? 0) > 0;

  const trend =
    priorMostLikely !== null && row.projected_most_likely !== null
      ? row.projected_most_likely - priorMostLikely
      : null;

  return (
    <div style={cardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "18px",
        }}
      >
        <div>
          <p style={sectionLabelStyle}>{PERIOD_LABEL[row.forecast_period]}</p>
          <p style={{ fontSize: "12px", color: "#94A3B8", margin: "4px 0 0" }}>
            Generated {formatDate(row.forecast_date)}
          </p>
        </div>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#FFFFFF",
            backgroundColor: confidenceColor(row.confidence),
            padding: "4px 12px",
            borderRadius: "999px",
          }}
        >
          {row.confidence !== null ? `${row.confidence}% confidence` : "confidence —"}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "16px",
          marginBottom: "20px",
        }}
      >
        <div>
          <p style={sectionLabelStyle}>Most Likely</p>
          <p style={{ fontSize: "28px", fontWeight: 900, color: "#0F172A", margin: "6px 0 0" }}>
            {formatCurrency(row.projected_most_likely)}
          </p>
          {trend !== null && (
            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "6px" }}>
              {trend >= 0 ? (
                <TrendingUp size={14} color="#10B981" />
              ) : (
                <TrendingDown size={14} color="#EF4444" />
              )}
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: trend >= 0 ? "#10B981" : "#EF4444",
                }}
              >
                {trend >= 0 ? "+" : ""}
                {formatCurrency(trend)} vs. prior forecast
              </span>
            </div>
          )}
        </div>
        <div>
          <p style={sectionLabelStyle}>Projected Range</p>
          <p style={{ fontSize: "16px", fontWeight: 700, color: "#334155", margin: "6px 0 0" }}>
            {formatCurrency(row.projected_min)} – {formatCurrency(row.projected_max)}
          </p>
        </div>
      </div>

      {row.methodology && (
        <p
          style={{
            fontSize: "13px",
            color: "#64748B",
            lineHeight: 1.6,
            margin: "0 0 20px",
            fontStyle: "italic",
          }}
        >
          {row.methodology}
        </p>
      )}

      {hasNarrative ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
          }}
        >
          {(row.key_risks?.length ?? 0) > 0 && (
            <NarrativeList
              title="Key Risks"
              items={row.key_risks!}
              icon={<AlertTriangle size={14} color="#EF4444" />}
              color="#B91C1C"
            />
          )}
          {(row.key_opportunities?.length ?? 0) > 0 && (
            <NarrativeList
              title="Key Opportunities"
              items={row.key_opportunities!}
              icon={<TrendingUp size={14} color="#10B981" />}
              color="#047857"
            />
          )}
          {(row.recommended_actions?.length ?? 0) > 0 && (
            <NarrativeList
              title="Recommended Actions"
              items={row.recommended_actions!}
              icon={<Sparkles size={14} color="#7A5980" />}
              color="#7A5980"
            />
          )}
        </div>
      ) : (
        <p style={{ fontSize: "13px", color: "#94A3B8", fontStyle: "italic", margin: 0 }}>
          Narrative synthesis unavailable this run.
        </p>
      )}
    </div>
  );
}

export default function FundingForecastPage() {
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/forecast", { cache: "no-store" });
      const data = (await res.json()) as { forecasts?: ForecastRow[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to load funding forecasts.");
        return;
      }
      setForecasts(data.forecasts ?? []);
    } catch {
      setError("Network error loading funding forecasts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runForecast() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/forecast", { method: "POST" });
      const data = (await res.json()) as { forecasts?: ForecastRow[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Forecast generation failed.");
        return;
      }
      setForecasts(data.forecasts ?? []);
    } catch {
      setError("Network error running the forecast.");
    } finally {
      setRunning(false);
    }
  }

  const byPeriod = new Map<ForecastPeriod, ForecastRow[]>();
  for (const row of forecasts) {
    const list = byPeriod.get(row.forecast_period) ?? [];
    list.push(row);
    byPeriod.set(row.forecast_period, list);
  }
  // Sort each period's rows newest-first so the trend comparison below is
  // always latest-vs-prior, regardless of the API route's own ordering.
  for (const list of byPeriod.values()) {
    list.sort((a, b) => (a.forecast_date < b.forecast_date ? 1 : -1));
  }

  const hasAny = forecasts.length > 0;

  return (
    <div style={{ backgroundColor: "#D8D3C8", minHeight: "100%", padding: "32px" }}>
      <div
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
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "#101B2D",
              letterSpacing: "-0.02em",
              margin: 0,
              borderLeft: "4px solid #7A5980",
              paddingLeft: "16px",
            }}
          >
            Funding Forecast
          </h1>
          <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
            Probability-weighted 90-day and 12-month projections from your open pipeline.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runForecast()}
          disabled={running}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "#7A5980",
            color: "#FFFFFF",
            fontSize: "14px",
            fontWeight: 700,
            padding: "12px 20px",
            borderRadius: "10px",
            border: "none",
            cursor: running ? "default" : "pointer",
            opacity: running ? 0.7 : 1,
          }}
        >
          {running ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          {running ? "Running Forecast..." : hasAny ? "Run New Forecast" : "Run Forecast"}
        </button>
      </div>

      {loading && (
        <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: "10px" }}>
          <Loader2 size={16} className="animate-spin" color="#7A5980" />
          <span style={{ fontSize: "14px", color: "#64748B" }}>
            Loading funding forecasts...
          </span>
        </div>
      )}

      {!loading && error && (
        <div style={{ ...cardStyle, borderLeft: "4px solid #EF4444", marginBottom: "20px" }}>
          <p style={{ fontSize: "14px", color: "#B91C1C", margin: 0 }}>{error}</p>
        </div>
      )}

      {!loading && !hasAny && !error && (
        <div style={cardStyle}>
          <p style={{ fontSize: "14px", color: "#64748B", margin: 0 }}>
            No forecast has been generated yet for this organization. AG-26 also runs
            automatically for every org on the 1st of every month — or run one now above.
          </p>
        </div>
      )}

      {!loading && hasAny && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {PERIOD_ORDER.map((period) => {
            const rows = byPeriod.get(period);
            if (!rows || rows.length === 0) return null;
            const [latest, prior] = rows;
            return (
              <ForecastCard
                key={period}
                row={latest!}
                priorMostLikely={prior ? prior.projected_most_likely : null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
