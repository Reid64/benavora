"use client";

import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";

import { Card, LoadingSpinner } from "@/components/ui";
import { humanizeEnum } from "@/lib/utils/formatters";

type ProbabilityFactor = {
  name: string;
  weight: number;
  value: number;
  contribution: number;
};

type ProbabilityResponse = {
  score: number;
  confidence: "high" | "medium" | "low";
  factors: ProbabilityFactor[];
};

function scoreColor(score: number): string {
  if (score >= 70) return "#10B981";
  if (score >= 40) return "#F59E0B";
  return "#EF4444";
}

const CONFIDENCE_COLOR: Record<ProbabilityResponse["confidence"], string> = {
  high: "#10B981",
  medium: "#F59E0B",
  low: "#94A3B8",
};

/**
 * Five-factor eligibility breakdown: the top factors (by weight) from the
 * Grant Probability Engine, each rendered as an inline-styled progress bar
 * colored by its own value (BLUEPRINT §7.5 - hardcoded hex, no Tailwind color
 * classes).
 */
export function SuccessProbabilityCard({
  opportunityId,
}: {
  opportunityId: string;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [data, setData] = useState<ProbabilityResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus("loading");
      try {
        const res = await fetch(
          `/api/opportunities/${encodeURIComponent(opportunityId)}/probability`,
        );
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error ?? "Failed to load success probability.");
        }
        const json = (await res.json()) as ProbabilityResponse;
        if (!cancelled) {
          setData(json);
          setStatus("loaded");
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(
            err instanceof Error ? err.message : "Failed to load success probability.",
          );
          setStatus("error");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [opportunityId]);

  const topFactors = data
    ? [...data.factors].sort((a, b) => b.weight - a.weight).slice(0, 5)
    : [];

  return (
    <Card title="Success Probability">
      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-navy-600">
          <LoadingSpinner />
          <span>Calculating&hellip;</span>
        </div>
      )}

      {status === "error" && (
        <div
          role="alert"
          style={{
            borderRadius: "10px",
            border: "1px solid #FECACA",
            backgroundColor: "#FEE2E2",
            padding: "10px 14px",
            fontSize: "14px",
            color: "#B91C1C",
          }}
        >
          {fetchError}
        </div>
      )}

      {status === "loaded" && data && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                borderRadius: "999px",
                padding: "4px 12px",
                fontSize: "14px",
                fontWeight: 800,
                backgroundColor: `${scoreColor(data.score)}1A`,
                color: scoreColor(data.score),
              }}
            >
              <TrendingUp style={{ height: "14px", width: "14px" }} aria-hidden />
              {data.score}%
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: "999px",
                padding: "4px 12px",
                fontSize: "12px",
                fontWeight: 700,
                backgroundColor: `${CONFIDENCE_COLOR[data.confidence]}1A`,
                color: CONFIDENCE_COLOR[data.confidence],
              }}
            >
              {humanizeEnum(data.confidence)} confidence
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {topFactors.map((f) => {
              const pct = Math.max(0, Math.min(100, Math.round(f.value * 100)));
              const barColor = scoreColor(pct);
              return (
                <div key={f.name}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      marginBottom: "6px",
                    }}
                  >
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>
                      {humanizeEnum(f.name)}
                      <span style={{ marginLeft: "6px", fontSize: "11px", fontWeight: 400, color: "#94A3B8" }}>
                        ({Math.round(f.weight * 100)}% weight)
                      </span>
                    </span>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#0F172A" }}>
                      {pct}%
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={humanizeEnum(f.name)}
                    style={{
                      height: "8px",
                      width: "100%",
                      borderRadius: "999px",
                      backgroundColor: "#E2E8F0",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${pct}%`,
                        borderRadius: "999px",
                        backgroundColor: barColor,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
