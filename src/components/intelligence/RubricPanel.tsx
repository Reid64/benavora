"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Target } from "lucide-react";

import type { RubricDimension } from "@/types/ai";

export interface RubricPanelProps {
  rubric: RubricDimension[] | null | undefined;
  rubricInferred?: boolean;
}

/**
 * Collapsible sidebar panel that surfaces the scoring rubric used when
 * optimizing the current draft. Auto-expands when rubric data arrives.
 * Shows an empty state when no rubric is available for the funder.
 */
export function RubricPanel({ rubric, rubricInferred = false }: RubricPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const hasRubric = Array.isArray(rubric) && rubric.length > 0;
  const maxPoints = hasRubric ? Math.max(...rubric.map((d) => d.points)) : 0;

  // Auto-expand when rubric data arrives after generation.
  useEffect(() => {
    if (hasRubric) setExpanded(true);
  }, [hasRubric]);

  return (
    <div className="glow-border rounded-xl bg-ink-700/60 shadow-card backdrop-blur-md transition-shadow hover:shadow-card-hover">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between gap-4 px-5 py-4${expanded ? " border-b border-navy-100" : ""}`}
      >
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-amber-500" aria-hidden />
          <h3 className="text-base font-semibold text-navy-900">
            Scoring Optimization
          </h3>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-navy-500" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-navy-500" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="p-5">
          {!hasRubric ? (
            <p className="text-sm text-navy-500">
              No scoring rubric available for this funder.
            </p>
          ) : (
            <div className="space-y-2">
              {rubricInferred && (
                <p className="mb-3 text-xs italic text-navy-400">
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
                        : "rounded-lg border border-navy-100 bg-navy-800/10 p-3"
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={
                          isHighWeight
                            ? "text-sm font-medium text-amber-600"
                            : "text-sm font-medium text-navy-900"
                        }
                      >
                        {dim.name}
                      </span>
                      <span
                        className={
                          isHighWeight
                            ? "shrink-0 text-xs font-semibold text-amber-500"
                            : "shrink-0 text-xs font-semibold text-navy-500"
                        }
                      >
                        {dim.points} pts
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-snug text-navy-500">
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
