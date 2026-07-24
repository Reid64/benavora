"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Target } from "lucide-react";

import type { RubricDimension } from "@/types/ai";

export interface RubricPanelProps {
  rubric: RubricDimension[] | null | undefined;
  rubricInferred?: boolean;
  /** Style the panel for a dark card background (draft generator page). Defaults to light. */
  dark?: boolean;
}

/**
 * Collapsible sidebar panel that surfaces the scoring rubric used when
 * optimizing the current draft. Auto-expands when rubric data arrives.
 * Shows an empty state when no rubric is available for the funder.
 */
export function RubricPanel({ rubric, rubricInferred = false, dark = false }: RubricPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const hasRubric = Array.isArray(rubric) && rubric.length > 0;
  const maxPoints = hasRubric ? Math.max(...rubric.map((d) => d.points)) : 0;

  // Auto-expand when rubric data arrives after generation.
  useEffect(() => {
    if (hasRubric) setExpanded(true);
  }, [hasRubric]);

  return (
    <div
      className={dark ? undefined : "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"}
      style={
        dark
          ? { backgroundColor: "#1E293B", borderRadius: "12px", padding: "20px", border: "1px solid rgba(255,255,255,0.08)", marginTop: "12px", overflow: "hidden" }
          : undefined
      }
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className={
          dark
            ? "flex w-full items-center justify-between gap-4"
            : `flex w-full items-center justify-between gap-4 bg-white-sunken px-5 py-4${expanded ? " border-b border-slate-200" : ""}`
        }
        style={dark && expanded ? { borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "12px" } : undefined}
      >
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-amber-500" aria-hidden />
          <h3 className={dark ? undefined : "text-base font-semibold text-slate-900"} style={dark ? { fontSize: "16px", fontWeight: 600, color: "#F8FAFC" } : undefined}>
            Scoring Optimization
          </h3>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0" style={dark ? { color: "rgba(248,250,252,0.5)" } : undefined} aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" style={dark ? { color: "rgba(248,250,252,0.5)" } : undefined} aria-hidden />
        )}
      </button>

      {expanded && (
        <div className={dark ? "pt-3" : "p-5"}>
          {!hasRubric ? (
            <p className={dark ? undefined : "text-sm text-navy-500"} style={dark ? { fontSize: "14px", color: "rgba(248,250,252,0.5)" } : undefined}>
              No scoring rubric available for this funder.
            </p>
          ) : (
            <div className="space-y-2">
              {rubricInferred && (
                <p className={dark ? "mb-3 text-xs italic" : "mb-3 text-xs italic text-navy-400"} style={dark ? { color: "rgba(248,250,252,0.4)" } : undefined}>
                  Inferred from opportunity description
                </p>
              )}
              {rubric.map((dim) => {
                const isHighWeight = maxPoints > 0 && dim.points >= maxPoints * 0.85;
                return (
                  <div
                    key={dim.name}
                    className={
                      isHighWeight
                        ? "rounded-lg border border-amber-200/50 bg-amber-500/10 p-3"
                        : dark
                          ? "rounded-lg p-3"
                          : "rounded-lg border border-navy-100 bg-navy-800/10 p-3"
                    }
                    style={!isHighWeight && dark ? { border: "1px solid rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.04)" } : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={
                          isHighWeight
                            ? "text-sm font-medium text-amber-600"
                            : dark
                              ? "text-sm font-medium"
                              : "text-sm font-medium text-navy-900"
                        }
                        style={!isHighWeight && dark ? { color: "rgba(248,250,252,0.85)" } : undefined}
                      >
                        {dim.name}
                      </span>
                      <span
                        className={
                          isHighWeight
                            ? "shrink-0 text-xs font-semibold text-amber-500"
                            : dark
                              ? "shrink-0 text-xs font-semibold"
                              : "shrink-0 text-xs font-semibold text-navy-500"
                        }
                        style={!isHighWeight && dark ? { color: "rgba(248,250,252,0.5)" } : undefined}
                      >
                        {dim.points} pts
                      </span>
                    </div>
                    <p
                      className={dark ? "mt-1 text-xs leading-snug" : "mt-1 text-xs leading-snug text-navy-500"}
                      style={dark ? { color: "rgba(248,250,252,0.5)" } : undefined}
                    >
                      {dim.description}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
