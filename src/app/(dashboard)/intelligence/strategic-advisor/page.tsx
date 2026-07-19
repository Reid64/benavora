"use client";

// AG-40 Strategic Advisor UI (AUTONOMOUS_PLATFORM_VISION.md Phase 5, "AI
// Strategic Advisor"; src/lib/agents/strategic-advisor-agent.ts). Talks to
// /api/intelligence/strategic-advisor, which wraps StrategicAdvisorAgent —
// the capstone agent that reads every other agent's output and synthesizes
// a single prioritized, proactive recommendation list. Every color on this
// page is an inline hex value per BLUEPRINT_v2.md §7.5 — no CSS variables,
// no Tailwind color classes.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
  TrendingUp,
  XCircle,
} from "lucide-react";

type RecommendationCategory =
  | "apply_now"
  | "postpone"
  | "hire"
  | "expand"
  | "pivot"
  | "partnership"
  | "board"
  | "technology"
  | "compliance";

type Urgency = "immediate" | "urgent" | "normal" | "low";
type RecommendationStatus = "pending" | "actioned" | "dismissed" | "snoozed";

interface StrategicRecommendation {
  id: string;
  org_id: string;
  recommendation_category: RecommendationCategory;
  title: string;
  recommendation: string;
  reasoning: string;
  urgency: Urgency;
  time_sensitivity: string | null;
  expected_impact: string | null;
  confidence_score: number | null;
  data_basis: Record<string, unknown>;
  status: RecommendationStatus;
  generated_at: string;
  actioned_at: string | null;
}

const URGENCY_COLOR: Record<Urgency, string> = {
  immediate: "#DC2626",
  urgent: "#F59E0B",
  normal: "#0EA5E9",
  low: "#6B7280",
};

const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  apply_now: "Apply Now",
  postpone: "Postpone",
  hire: "Hire",
  expand: "Expand",
  pivot: "Pivot",
  partnership: "Partnership",
  board: "Board",
  technology: "Technology",
  compliance: "Compliance",
};

const CATEGORY_COLORS: Record<RecommendationCategory, string> = {
  apply_now: "#10B981",
  postpone: "#6B7280",
  hire: "#8B5CF6",
  expand: "#0077B6",
  pivot: "#F59E0B",
  partnership: "#00B4D8",
  board: "#1A2B3C",
  technology: "#0EA5E9",
  compliance: "#DC2626",
};

function confidenceColor(score: number | null): string {
  if (score == null) return "#6B7280";
  if (score >= 70) return "#10B981";
  if (score >= 50) return "#F59E0B";
  return "#EF4444";
}

function isDeadlineBased(timeSensitivity: string): boolean {
  return /deadline/i.test(timeSensitivity);
}

export default function StrategicAdvisorPage() {
  const [recommendations, setRecommendations] = useState<StrategicRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateNotice, setGenerateNotice] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/intelligence/strategic-advisor", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (payload as { error?: string }).error ?? "Could not load strategic recommendations.",
        );
        return;
      }
      setRecommendations(
        (payload as { recommendations?: StrategicRecommendation[] }).recommendations ?? [],
      );
    } catch {
      setError("Could not reach the strategic advisor service.");
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

  async function handleGenerate() {
    setGenerating(true);
    setGenerateNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/intelligence/strategic-advisor", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((payload as { error?: string }).error ?? "Strategic advisor run failed.");
        return;
      }
      const data = payload as {
        recommendations?: StrategicRecommendation[];
        itemsProcessed?: number;
      };
      setRecommendations(data.recommendations ?? []);
      setGenerateNotice(
        data.itemsProcessed && data.itemsProcessed > 0
          ? `Generated ${data.itemsProcessed} new recommendation${data.itemsProcessed !== 1 ? "s" : ""}.`
          : "No new recommendations this run — your intelligence profile hasn't changed enough yet.",
      );
    } catch {
      setError("Could not reach the strategic advisor service.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleStatusChange(id: string, status: RecommendationStatus) {
    setActingOn((prev) => new Set(prev).add(id));
    try {
      const res = await fetch("/api/intelligence/strategic-advisor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) {
        setRecommendations((prev) => prev.filter((r) => r.id !== id));
      } else {
        const payload = await res.json().catch(() => ({}));
        setError((payload as { error?: string }).error ?? "Could not update the recommendation.");
      }
    } catch {
      setError("Could not reach the strategic advisor service.");
    } finally {
      setActingOn((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const immediateRecs = recommendations.filter((r) => r.urgency === "immediate");
  const restRecs = recommendations.filter((r) => r.urgency !== "immediate");
  const showEmpty = !loading && recommendations.length === 0;

  return (
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh", padding: "32px" }}>
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
        <div>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "#0F172A",
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            AI Strategic Advisor
          </h1>
          <p style={{ fontSize: "14px", color: "#64748B", marginTop: "6px" }}>
            Proactive intelligence — recommendations you did not ask for but need to hear.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={generating}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "#1A2B3C",
            color: "#FFFFFF",
            fontSize: "14px",
            fontWeight: 700,
            padding: "12px 24px",
            borderRadius: "10px",
            border: "none",
            cursor: generating ? "default" : "pointer",
            opacity: generating ? 0.7 : 1,
            boxShadow: "0 4px 16px rgba(26,43,60,0.25)",
          }}
        >
          {generating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {generating ? "Generating Insights..." : "Generate Insights"}
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

      {generateNotice && !error && (
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
          {generateNotice}
        </div>
      )}

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
          Loading strategic recommendations...
        </div>
      ) : showEmpty ? (
        <div
          style={{
            backgroundColor: "#FFFFFF",
            borderRadius: "14px",
            padding: "56px 24px",
            textAlign: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
          }}
        >
          <TrendingUp size={32} color="#94A3B8" style={{ margin: "0 auto 12px" }} />
          <p style={{ fontSize: "14px", fontWeight: 700, color: "#1A2B3C", margin: 0 }}>
            No strategic recommendations yet.
          </p>
          <p style={{ fontSize: "13px", color: "#64748B", marginTop: "8px" }}>
            Click Generate Insights to have your AI advisor analyze your full
            intelligence profile.
          </p>
        </div>
      ) : (
        <>
          {/* Immediate banner */}
          {immediateRecs.length > 0 && (
            <div
              style={{
                backgroundColor: "#FEF2F2",
                border: "2px solid #DC2626",
                borderRadius: "14px",
                padding: "20px 24px",
                marginBottom: "24px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                <AlertTriangle size={20} color="#DC2626" />
                <span style={{ fontSize: "14px", fontWeight: 800, color: "#991B1B", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Immediate Attention Required
                </span>
              </div>
              <div>
                {immediateRecs.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    acting={actingOn.has(rec.id)}
                    onStatusChange={handleStatusChange}
                    compact
                  />
                ))}
              </div>
            </div>
          )}

          {/* Remaining recommendations */}
          <div>
            {restRecs.map((rec) => (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                acting={actingOn.has(rec.id)}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RecommendationCard({
  rec,
  acting,
  onStatusChange,
  compact = false,
}: {
  rec: StrategicRecommendation;
  acting: boolean;
  onStatusChange: (id: string, status: RecommendationStatus) => void | Promise<void>;
  compact?: boolean;
}) {
  const accentColor = URGENCY_COLOR[rec.urgency];
  const categoryColor = CATEGORY_COLORS[rec.recommendation_category];
  const deadlineBased = rec.time_sensitivity ? isDeadlineBased(rec.time_sensitivity) : false;

  return (
    <div
      style={{
        display: "flex",
        backgroundColor: "#FFFFFF",
        borderRadius: "14px",
        overflow: "hidden",
        marginBottom: compact ? "12px" : "16px",
        boxShadow: compact ? "0 2px 10px rgba(0,0,0,0.08)" : "0 4px 20px rgba(0,0,0,0.12)",
      }}
    >
      <div style={{ width: "6px", flexShrink: 0, backgroundColor: accentColor }} aria-hidden />
      <div style={{ flex: 1, padding: "28px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            marginBottom: "12px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#FFFFFF",
              backgroundColor: categoryColor,
              borderRadius: "999px",
              padding: "3px 12px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {CATEGORY_LABELS[rec.recommendation_category]}
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#FFFFFF",
              backgroundColor: confidenceColor(rec.confidence_score),
              borderRadius: "999px",
              padding: "3px 12px",
            }}
          >
            {rec.confidence_score != null ? `${rec.confidence_score}% confidence` : "confidence unknown"}
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: accentColor,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {rec.urgency}
          </span>
        </div>

        <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#1A2B3C", margin: "0 0 8px" }}>
          {rec.title}
        </h3>

        <p style={{ fontSize: "15px", color: "#374151", lineHeight: 1.6, margin: "0 0 12px" }}>
          {rec.recommendation}
        </p>

        <p
          style={{
            fontSize: "13px",
            fontStyle: "italic",
            color: "#6B7280",
            lineHeight: 1.5,
            margin: "0 0 16px",
          }}
        >
          Why we recommend this: {rec.reasoning}
        </p>

        {rec.expected_impact && (
          <div
            style={{
              backgroundColor: "#ECFDF5",
              border: "1px solid #A7F3D0",
              borderRadius: "10px",
              padding: "12px 16px",
              marginBottom: "12px",
            }}
          >
            <p
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#065F46",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                margin: "0 0 4px",
              }}
            >
              Expected Impact
            </p>
            <p style={{ fontSize: "13px", color: "#047857", margin: 0 }}>{rec.expected_impact}</p>
          </div>
        )}

        {rec.time_sensitivity && (
          <div style={{ marginBottom: "16px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                fontWeight: 700,
                color: deadlineBased ? "#DC2626" : "#0369A1",
                backgroundColor: deadlineBased ? "#FEF2F2" : "#F0F9FF",
                border: `1px solid ${deadlineBased ? "#FECACA" : "#BAE6FD"}`,
                borderRadius: "999px",
                padding: "5px 14px",
              }}
            >
              <Clock size={12} />
              {rec.time_sensitivity}
            </span>
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={acting}
            onClick={() => void onStatusChange(rec.id, "actioned")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "#10B981",
              color: "#FFFFFF",
              fontSize: "13px",
              fontWeight: 700,
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              cursor: acting ? "default" : "pointer",
              opacity: acting ? 0.6 : 1,
            }}
          >
            <CheckCircle2 size={14} />
            Mark Done
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={() => void onStatusChange(rec.id, "dismissed")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "#F1F5F9",
              color: "#334155",
              fontSize: "13px",
              fontWeight: 700,
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid #CBD5E1",
              cursor: acting ? "default" : "pointer",
              opacity: acting ? 0.6 : 1,
            }}
          >
            <XCircle size={14} />
            Dismiss
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={() => void onStatusChange(rec.id, "snoozed")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "transparent",
              color: "#0077B6",
              fontSize: "13px",
              fontWeight: 700,
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid #0077B6",
              cursor: acting ? "default" : "pointer",
              opacity: acting ? 0.6 : 1,
            }}
          >
            <Clock size={14} />
            Snooze 1 Week
          </button>
        </div>
      </div>
    </div>
  );
}
