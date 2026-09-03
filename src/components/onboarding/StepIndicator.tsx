"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import {
  ONBOARDING_STEPS,
  type OnboardingStepId,
} from "@/lib/onboarding";

export type StepIndicatorProps = {
  /** Index of the step currently being shown. */
  current: number;
  /** Step ids the user has already completed (records exist). */
  completed: Set<OnboardingStepId>;
  /** Jump to a step. Disabled on steps the user hasn't reached yet. */
  onSelect: (index: number) => void;
};

/**
 * Horizontal onboarding step indicator (BLUEPRINT onboarding flow).
 *
 * Renders a node per step with a connecting rail. Completed steps show a
 * checkmark, the current step is highlighted, and not-yet-reached steps are
 * grayed and non-interactive - you can revisit a completed/visited step but
 * can't skip ahead by clicking. Labels collapse on small screens so the rail
 * stays legible; the active label always shows.
 */
export function StepIndicator({
  current,
  completed,
  onSelect,
}: StepIndicatorProps) {
  return (
    <nav aria-label="Onboarding progress">
      <ol className="flex items-center">
        {ONBOARDING_STEPS.map((step, index) => {
          const isDone = completed.has(step.id);
          const isActive = index === current;
          // Reachable = already visited (current or earlier) or completed.
          const reachable = index <= current || isDone;
          const isLast = index === ONBOARDING_STEPS.length - 1;

          return (
            <li
              key={step.id}
              className={cn("flex items-center", !isLast && "flex-1")}
            >
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => reachable && onSelect(index)}
                  disabled={!reachable}
                  aria-current={isActive ? "step" : undefined}
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition",
                    isDone
                      ? "bg-teal-500 text-white shadow-sm shadow-teal-900/20"
                      : isActive
                        ? "border border-teal-500 bg-surface text-teal-600"
                        : "border border-navy-200 bg-surface text-navy-400",
                    reachable && !isActive && "hover:border-teal-400",
                    !reachable && "cursor-not-allowed",
                  )}
                >
                  {isDone ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : (
                    index + 1
                  )}
                </button>
                <span
                  className={cn(
                    "mt-1.5 max-w-[5rem] truncate text-center text-xs font-medium",
                    isActive
                      ? "text-navy-900"
                      : isDone
                        ? "text-navy-600"
                        : "text-navy-400",
                    // Keep the rail tidy on phones: only the active label shows.
                    isActive ? "block" : "hidden sm:block",
                  )}
                >
                  {step.title}
                </span>
              </div>

              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    "mx-2 h-0.5 flex-1 rounded-full transition-colors",
                    index < current || isDone ? "bg-teal-400" : "bg-navy-200",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
