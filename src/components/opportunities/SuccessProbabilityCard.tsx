"use client";

import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";

import { Badge, Card, LoadingSpinner } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
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

function scoreVariant(score: number): BadgeVariant {
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "error";
}

const CONFIDENCE_VARIANT: Record<ProbabilityResponse["confidence"], BadgeVariant> = {
  high: "success",
  medium: "warning",
  low: "neutral",
};

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
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {fetchError}
        </div>
      )}

      {status === "loaded" && data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={scoreVariant(data.score)} className="text-base">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              <span className="tabular-nums">{data.score}%</span>
            </Badge>
            <Badge variant={CONFIDENCE_VARIANT[data.confidence]}>
              {humanizeEnum(data.confidence)} confidence
            </Badge>
          </div>

          <ul className="space-y-2">
            {data.factors.map((f) => (
              <li
                key={f.name}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="text-navy-700">
                  {humanizeEnum(f.name)}
                  <span className="ml-1 text-xs text-navy-400">
                    ({Math.round(f.weight * 100)}% weight)
                  </span>
                </span>
                <span className="tabular-nums font-medium text-navy-900">
                  {Math.round(f.value * 100)}%
                  <span className="ml-1 text-xs font-normal text-navy-400">
                    (+{f.contribution.toFixed(1)} pts)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
