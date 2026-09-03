"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

// Fundability Intelligence panel (AUTONOMOUS_PLATFORM_VISION.md §"Fundability
// Intelligence Score"; /api/intelligence/fundability; fundability_scores,
// migration 091). All colors/backgrounds/borders/shadows are inline
// style={{}} with hardcoded hex per BLUEPRINT_v2.md §7.5 - never Tailwind
// color classes.

type FixType = "kb_gap" | "twin_gap" | "structural";

interface Deficiency {
  factor: string;
  issue: string;
  fix_type: FixType;
  fix_action: string;
  auto_fixable: boolean;
}

interface FundabilityScoreRow {
  id: string;
  opportunity_id: string | null;
  overall_score: number | null;
  probability_without_fixes: number | null;
  probability_with_fixes: number | null;
  confidence: string | null;
  deficiencies: Deficiency[] | null;
  recommendation: string | null;
  generated_at: string | null;
}

export function FundabilityPanel({ opportunityId }: { opportunityId: string }) {
  const [score, setScore] = useState<FundabilityScoreRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/intelligence/fundability?opportunityId=${encodeURIComponent(opportunityId)}`,
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Failed to load fundability score.");
      }
      const json = (await res.json()) as { scores: FundabilityScoreRow[] };
      setScore(json.scores[0] ?? null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load fundability score.",
      );
    } finally {
      setLoading(false);
    }
  }, [opportunityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/intelligence/fundability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Fundability analysis failed.");
      }
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Fundability analysis failed.",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  const withoutFixes = score?.probability_without_fixes ?? null;
  const withFixes = score?.probability_with_fixes ?? null;
  const delta =
    withoutFixes != null && withFixes != null ? withFixes - withoutFixes : null;
  const deficiencies = score?.deficiencies ?? [];

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #B8C9D9",
        borderRadius: "16px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
        padding: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div>
          <h3
            style={{
              fontSize: "16px",
              fontWeight: 700,
              color: "#0F172A",
              margin: 0,
            }}
          >
            Fundability Intelligence
          </h3>
          <p style={{ fontSize: "13px", color: "#64748B", marginTop: "4px" }}>
            Diagnoses why this opportunity scores the way it does and what
            fixing gaps would do to its odds.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={analyzing}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            backgroundColor: analyzing ? "#94A3B8" : "#3D6B50",
            color: "#FFFFFF",
            border: "none",
            borderRadius: "8px",
            padding: "8px 14px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: analyzing ? "default" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <Sparkles style={{ width: "14px", height: "14px" }} aria-hidden />
          {analyzing ? "Analyzing..." : score ? "Re-Analyze" : "Analyze"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            color: "#B91C1C",
            borderRadius: "8px",
            padding: "10px 12px",
            fontSize: "13px",
            marginBottom: "16px",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: "13px", color: "#64748B" }}>Loading...</p>
      ) : !score ? (
        <p style={{ fontSize: "13px", color: "#64748B" }}>
          Not yet analyzed. Click Analyze to diagnose this opportunity&apos;s
          fundability.
        </p>
      ) : (
        <div>
          <div
            style={{
              display: "flex",
              gap: "16px",
              flexWrap: "wrap",
              marginBottom: "20px",
            }}
          >
            <div
              style={{
                flex: "1 1 160px",
                backgroundColor: "#C8D4DC",
                borderRadius: "12px",
                padding: "16px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#64748B",
                }}
              >
                Current Probability
              </div>
              <div
                style={{
                  fontSize: "40px",
                  fontWeight: 900,
                  color: "#0F172A",
                  marginTop: "4px",
                }}
              >
                {withoutFixes ?? "-"}
                {withoutFixes != null && (
                  <span style={{ fontSize: "20px" }}>%</span>
                )}
              </div>
            </div>
            <div
              style={{
                flex: "1 1 160px",
                backgroundColor: "#C8D4DC",
                borderRadius: "12px",
                padding: "16px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#64748B",
                }}
              >
                With Fixes
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  marginTop: "4px",
                }}
              >
                <div
                  style={{ fontSize: "40px", fontWeight: 900, color: "#0F172A" }}
                >
                  {withFixes ?? "-"}
                  {withFixes != null && (
                    <span style={{ fontSize: "20px" }}>%</span>
                  )}
                </div>
                {delta != null && delta > 0 && (
                  <span
                    style={{
                      backgroundColor: "#10B981",
                      color: "#FFFFFF",
                      borderRadius: "999px",
                      padding: "3px 8px",
                      fontSize: "12px",
                      fontWeight: 700,
                    }}
                  >
                    +{delta}
                  </span>
                )}
              </div>
            </div>
          </div>

          {score.recommendation && (
            <div
              style={{
                marginBottom: "16px",
                fontSize: "13px",
                color: "#0F172A",
              }}
            >
              <span style={{ fontWeight: 700 }}>Recommendation: </span>
              {score.recommendation.replace(/_/g, " ")}
            </div>
          )}

          <div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#64748B",
                marginBottom: "10px",
              }}
            >
              Deficiencies ({deficiencies.length})
            </div>
            {deficiencies.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#64748B" }}>
                No deficiencies found.
              </p>
            ) : (
              <div
                style={{ display: "flex", flexDirection: "column", gap: "10px" }}
              >
                {deficiencies.map((d, i) => (
                  <div
                    key={`${d.factor}-${i}`}
                    style={{
                      display: "flex",
                      gap: "12px",
                      backgroundColor: "#FFFFFF",
                      border: "1px solid #B8C9D9",
                      borderLeft: `4px solid ${
                        d.auto_fixable ? "#10B981" : "#F59E0B"
                      }`,
                      borderRadius: "8px",
                      padding: "10px 14px",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "#0F172A",
                          }}
                        >
                          {d.factor}
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: d.auto_fixable ? "#10B981" : "#F59E0B",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {d.auto_fixable ? "Auto-Fixable" : "Manual"}
                        </span>
                      </div>
                      <p
                        style={{
                          fontSize: "13px",
                          color: "#64748B",
                          marginTop: "4px",
                        }}
                      >
                        {d.issue}
                      </p>
                      <p
                        style={{
                          fontSize: "13px",
                          color: "#0F172A",
                          marginTop: "4px",
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>Fix: </span>
                        {d.fix_action}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
