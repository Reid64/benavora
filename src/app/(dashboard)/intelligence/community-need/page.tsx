"use client";

// AG-35 Community Need Predictor UI (AUTONOMOUS_PLATFORM_VISION.md Phase 3,
// "Community Need Prediction"; src/lib/agents/community-need-predictor-agent.ts).
// Talks to /api/intelligence/community-need, which wraps
// CommunityNeedPredictorAgent — census/housing/employment/eviction/disaster/
// school-enrollment signal research for the org's service area, grounded in
// live web search. Every color on this page is an inline hex value per
// BLUEPRINT_v2.md §7.5 — no CSS variables, no Tailwind color classes.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";

type SignalSource =
  | "census"
  | "housing_prices"
  | "employment"
  | "eviction_data"
  | "weather"
  | "disaster"
  | "school_enrollment"
  | "migration"
  | "economic";

type TrendDirection = "increasing" | "decreasing" | "stable" | "spike";
type Severity = "critical" | "high" | "medium" | "low";

interface CommunityNeedSignal {
  id: string;
  org_id: string;
  signal_source: SignalSource;
  signal_category: string;
  signal_description: string;
  geographic_area: string | null;
  trend_direction: TrendDirection | null;
  severity: Severity | null;
  predicted_demand_increase: number | null;
  recommended_program_expansion: string | null;
  data_date: string | null;
  created_at: string;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#DC2626",
  high: "#F59E0B",
  medium: "#0EA5E9",
  low: "#6B7280",
};

const SOURCE_LABELS: Record<SignalSource, string> = {
  census: "Census",
  housing_prices: "Housing Prices",
  employment: "Employment",
  eviction_data: "Eviction Data",
  weather: "Weather",
  disaster: "Disaster",
  school_enrollment: "School Enrollment",
  migration: "Migration",
  economic: "Economic",
};

function severityColor(severity: Severity | null): string {
  return severity ? SEVERITY_COLOR[severity] : "#6B7280";
}

// Row #226 Community Resource Graph MVP — real matches from
// /api/intelligence/community-resources (src/lib/intelligence/resource-matcher.ts),
// ranking this org's own funders/open opportunities/active programs against
// one real community_need_signals row (AG-35's real output). Not a graph
// visualization — see resource-matcher.ts's header for why.
type ResourceType = "funder" | "opportunity" | "program";

interface ResourceMatch {
  type: ResourceType;
  id: string;
  name: string;
  score: number;
  matchReasons: string[];
  meta: Record<string, unknown>;
}

const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  funder: "Funder",
  opportunity: "Open Opportunity",
  program: "Your Program",
};

const RESOURCE_TYPE_COLOR: Record<ResourceType, string> = {
  funder: "#B85C3C",
  opportunity: "#4F6D8F",
  program: "#16A34A",
};

const RESOURCE_TYPE_HREF: Record<ResourceType, (id: string) => string> = {
  funder: (id) => `/funders/${id}`,
  opportunity: (id) => `/opportunities/${id}`,
  program: () => `/knowledge-base/edit`,
};

function ResourcesPanel({ signalId }: { signalId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [matches, setMatches] = useState<ResourceMatch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && matches === null && !loading) {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/intelligence/community-resources?signalId=${encodeURIComponent(signalId)}`,
          { cache: "no-store" },
        );
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError((payload as { error?: string }).error ?? "Could not load potential resources.");
          return;
        }
        setMatches((payload as { matches?: ResourceMatch[] }).matches ?? []);
      } catch {
        setError("Could not reach the resource matching service.");
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div style={{ marginTop: "16px" }}>
      <button
        type="button"
        onClick={() => void handleToggle()}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          background: "none",
          border: "1px solid #E2E8F0",
          borderRadius: "8px",
          padding: "8px 14px",
          fontSize: "12px",
          fontWeight: 700,
          color: "#2C4E3B",
          cursor: "pointer",
        }}
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        Potential Resources
      </button>

      {expanded && (
        <div
          style={{
            marginTop: "12px",
            backgroundColor: "#F8FAFC",
            border: "1px solid #E2E8F0",
            borderRadius: "10px",
            padding: "16px",
          }}
        >
          {loading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "13px",
                color: "#64748B",
              }}
            >
              <Loader2 size={14} className="animate-spin" />
              Matching against your funders, opportunities, and programs...
            </div>
          ) : error ? (
            <p style={{ fontSize: "13px", color: "#B91C1C", margin: 0 }}>{error}</p>
          ) : matches && matches.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {matches.map((match) => (
                <a
                  key={`${match.type}-${match.id}`}
                  href={RESOURCE_TYPE_HREF[match.type](match.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    backgroundColor: "#FFFFFF",
                    border: "1px solid #E2E8F0",
                    borderRadius: "8px",
                    padding: "10px 14px",
                    textDecoration: "none",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          color: "#FFFFFF",
                          backgroundColor: RESOURCE_TYPE_COLOR[match.type],
                          borderRadius: "999px",
                          padding: "2px 9px",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          flexShrink: 0,
                        }}
                      >
                        {RESOURCE_TYPE_LABEL[match.type]}
                      </span>
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 700,
                          color: "#2C4E3B",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {match.name}
                      </span>
                    </div>
                    <p style={{ fontSize: "12px", color: "#64748B", margin: 0 }}>
                      {match.matchReasons.join(" · ")}
                    </p>
                  </div>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 800,
                      color: "#7A5980",
                      flexShrink: 0,
                    }}
                  >
                    {Math.round(match.score * 100)}% match
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>
              No existing funders, opportunities, or programs in your data currently match this
              need.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "Date unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { dateStyle: "medium" });
}

function TrendBadge({ trend }: { trend: TrendDirection | null }) {
  if (!trend) return null;

  const config: Record<TrendDirection, { label: string; color: string; icon: ReactNode }> = {
    increasing: {
      label: "Increasing",
      color: "#DC2626",
      icon: <TrendingUp size={13} />,
    },
    decreasing: {
      label: "Decreasing",
      color: "#10B981",
      icon: <TrendingDown size={13} />,
    },
    stable: {
      label: "Stable",
      color: "#6B7280",
      icon: <Minus size={13} />,
    },
    spike: {
      label: "Spike",
      color: "#DC2626",
      icon: <Zap size={13} />,
    },
  };

  const { label, color, icon } = config[trend];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontSize: "12px",
        fontWeight: 700,
        color,
      }}
    >
      {icon}
      {label}
    </span>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        backgroundColor: "#F8F5EE",
        borderRadius: "14px",
        padding: "20px 24px",
        boxShadow: "0 4px 20px rgba(122,89,128,0.18)",
        flex: "1 1 200px",
      }}
    >
      <p
        style={{
          fontSize: "11px",
          fontWeight: 700,
          color: "#64748B",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          margin: "0 0 8px",
        }}
      >
        {label}
      </p>
      <p style={{ fontSize: "28px", fontWeight: 900, color, margin: 0 }}>{value}</p>
    </div>
  );
}

export default function CommunityNeedPage() {
  const [signals, setSignals] = useState<CommunityNeedSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runNotice, setRunNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/intelligence/community-need", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((payload as { error?: string }).error ?? "Could not load community need signals.");
        return;
      }
      setSignals((payload as { signals?: CommunityNeedSignal[] }).signals ?? []);
    } catch {
      setError("Could not reach the community need service.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await load();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [load]);

  async function handleRunAnalysis() {
    setRunning(true);
    setRunNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/intelligence/community-need", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((payload as { error?: string }).error ?? "Community need analysis failed.");
        return;
      }
      const data = payload as {
        signals?: CommunityNeedSignal[];
        itemsProcessed?: number;
        errors?: string[];
      };
      setSignals(data.signals ?? []);
      if (data.errors && data.errors.length > 0) {
        setRunNotice(data.errors[0] ?? "Community need analysis reported an issue.");
      } else {
        setRunNotice(
          data.itemsProcessed && data.itemsProcessed > 0
            ? `Detected ${data.itemsProcessed} community need signal${data.itemsProcessed !== 1 ? "s" : ""}.`
            : "No new signals found — no real evidence was located for your service area this run.",
        );
      }
    } catch {
      setError("Could not reach the community need service.");
    } finally {
      setRunning(false);
    }
  }

  const criticalCount = signals.filter((s) => s.severity === "critical").length;
  const highCount = signals.filter((s) => s.severity === "high").length;
  const withDemand = signals.filter((s) => typeof s.predicted_demand_increase === "number");
  const avgDemandIncrease =
    withDemand.length > 0
      ? Math.round(
          withDemand.reduce((sum, s) => sum + (s.predicted_demand_increase ?? 0), 0) /
            withDemand.length,
        )
      : null;

  const showEmpty = !loading && signals.length === 0;

  return (
    <div style={{ backgroundColor: "#F0EBE0", minHeight: "100vh", padding: "32px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "28px",
        }}
      >
        <div style={{ borderLeft: "4px solid #7A5980", paddingLeft: "16px" }}>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "#2C4E3B",
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Community Need Intelligence
          </h1>
          <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
            Predict service demand before it peaks.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleRunAnalysis()}
          disabled={running}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "#7A5980",
            color: "#FFFFFF",
            fontSize: "14px",
            fontWeight: 700,
            padding: "12px 24px",
            borderRadius: "10px",
            border: "none",
            cursor: running ? "default" : "pointer",
            opacity: running ? 0.7 : 1,
            boxShadow: "0 4px 16px rgba(122,89,128,0.25)",
          }}
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {running ? "Running Analysis..." : "Run Analysis"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "20px",
            fontSize: "13px",
            color: "#B91C1C",
          }}
        >
          {error}
        </div>
      )}

      {runNotice && !error && (
        <div
          style={{
            backgroundColor: "#F0FDFA",
            border: "1px solid #99F6E4",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "20px",
            fontSize: "13px",
            color: "#0F766E",
          }}
        >
          {runNotice}
        </div>
      )}

      {/* Stats row */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "28px",
        }}
      >
        <StatTile label="Total Signals" value={String(signals.length)} color="#2C4E3B" />
        <StatTile label="Critical" value={String(criticalCount)} color="#DC2626" />
        <StatTile label="High" value={String(highCount)} color="#F59E0B" />
        <StatTile
          label="Avg Predicted Demand Increase"
          value={avgDemandIncrease !== null ? `${avgDemandIncrease}%` : "—"}
          color="#4F6D8F"
        />
      </div>

      {loading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            padding: "64px 0",
            color: "#64748B",
            fontSize: "14px",
          }}
        >
          <Loader2 size={18} className="animate-spin" />
          Loading community need signals...
        </div>
      ) : showEmpty ? (
        <div
          style={{
            backgroundColor: "#F8F5EE",
            borderRadius: "14px",
            padding: "56px 24px",
            textAlign: "center",
            boxShadow: "0 4px 20px rgba(122,89,128,0.18)",
          }}
        >
          <AlertTriangle size={32} color="#94A3B8" style={{ margin: "0 auto 12px" }} />
          <p style={{ fontSize: "14px", fontWeight: 700, color: "#2C4E3B", margin: 0 }}>
            No signals yet.
          </p>
          <p style={{ fontSize: "13px", color: "#64748B", marginTop: "8px" }}>
            Run Analysis to detect community need trends in your service area.
          </p>
        </div>
      ) : (
        <div>
          {signals.map((signal) => (
            <SignalCard key={signal.id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
}

function SignalCard({ signal }: { signal: CommunityNeedSignal }) {
  const accentColor = severityColor(signal.severity);
  const demandIncrease = signal.predicted_demand_increase;

  return (
    <div
      style={{
        display: "flex",
        backgroundColor: "#F8F5EE",
        borderRadius: "12px",
        overflow: "hidden",
        marginBottom: "16px",
        boxShadow: "0 4px 20px rgba(122,89,128,0.18)",
      }}
    >
      <div style={{ width: "6px", flexShrink: 0, backgroundColor: accentColor }} aria-hidden />
      <div style={{ flex: 1, padding: "20px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            marginBottom: "10px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#FFFFFF",
              backgroundColor: "#2C4E3B",
              borderRadius: "999px",
              padding: "3px 12px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {SOURCE_LABELS[signal.signal_source]}
          </span>
          {signal.geographic_area && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#7A5980",
                backgroundColor: "#F5F3FF",
                borderRadius: "999px",
                padding: "3px 12px",
              }}
            >
              {signal.geographic_area}
            </span>
          )}
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: accentColor,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {signal.severity ?? "unrated"}
          </span>
          <TrendBadge trend={signal.trend_direction} />
        </div>

        <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#2C4E3B", margin: "0 0 8px" }}>
          {signal.signal_category}
        </h3>

        <p style={{ fontSize: "14px", color: "#374151", lineHeight: 1.6, margin: "0 0 12px" }}>
          {signal.signal_description}
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
            marginBottom: demandIncrease !== null ? "16px" : "0",
          }}
        >
          {demandIncrease !== null && (
            <div>
              <p
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#64748B",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  margin: "0 0 4px",
                }}
              >
                Predicted Demand Increase
              </p>
              <p style={{ fontSize: "32px", fontWeight: 900, color: "#DC2626", margin: 0 }}>
                {demandIncrease}%
              </p>
            </div>
          )}
          <p style={{ fontSize: "12px", color: "#94A3B8", margin: 0 }}>
            {signal.data_date ? `Source data as of ${formatDate(signal.data_date)}` : `Recorded ${formatDate(signal.created_at)}`}
          </p>
        </div>

        {signal.recommended_program_expansion && (
          <div
            style={{
              backgroundColor: "#F5F3FF",
              border: "1px solid #DDD3E5",
              borderRadius: "10px",
              padding: "14px 16px",
            }}
          >
            <p
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#7A5980",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                margin: "0 0 6px",
              }}
            >
              Recommended Program Expansion
            </p>
            <p style={{ fontSize: "13px", color: "#4A3752", margin: "0 0 12px", lineHeight: 1.5 }}>
              {signal.recommended_program_expansion}
            </p>
            <a
              href="/opportunities"
              style={{
                display: "inline-flex",
                alignItems: "center",
                backgroundColor: "#7A5980",
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: 700,
                padding: "8px 16px",
                borderRadius: "8px",
                textDecoration: "none",
              }}
            >
              Apply for Related Grants
            </a>
          </div>
        )}

        <ResourcesPanel signalId={signal.id} />
      </div>
    </div>
  );
}
