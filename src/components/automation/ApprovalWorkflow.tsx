"use client";

import { useState } from "react";
import { Check, CircleCheck, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

/** The four phases of the approval flow, in order. */
export type ApprovalPhase = "review" | "approve" | "submitting" | "confirmed";

const PHASES: { key: ApprovalPhase; label: string }[] = [
  { key: "review", label: "Review" },
  { key: "approve", label: "Approve" },
  { key: "submitting", label: "Submitting" },
  { key: "confirmed", label: "Confirmed" },
];

const CHECKLIST = [
  "I have reviewed all filled fields",
  "I confirm this application should be submitted",
] as const;

export type ApprovalWorkflowProps = {
  /** Current phase, derived from the session status by the parent. */
  phase: ApprovalPhase;
  /** Whether the current role may approve (owner/admin only). */
  canApprove: boolean;
  /** Trigger the approval + submission flow. */
  onApprove: () => void;
  /** True while the submission request is in flight. */
  submitting?: boolean;
  /** Error from a failed approval attempt. */
  error?: string | null;
};

/**
 * Approval workflow (BLUEPRINT §Phase 3 components - ApprovalWorkflow). A
 * four-step indicator (Review → Approve → Submitting → Confirmed) plus a
 * two-item checklist. Both boxes must be ticked before the Approve & Submit
 * button enables - the human gate that BEHAVIORAL_CONTRACTS §18 requires before
 * any automated submission.
 */
export function ApprovalWorkflow({
  phase,
  canApprove,
  onApprove,
  submitting = false,
  error = null,
}: ApprovalWorkflowProps) {
  const [checked, setChecked] = useState<boolean[]>(() =>
    CHECKLIST.map(() => false),
  );

  const activeIndex = PHASES.findIndex((p) => p.key === phase);
  const allChecked = checked.every(Boolean);
  const interactive = phase === "review" || phase === "approve";

  function toggle(index: number) {
    setChecked((prev) => prev.map((v, i) => (i === index ? !v : v)));
  }

  return (
    <div className="space-y-5">
      {/* Step indicator */}
      <ol className="flex items-center">
        {PHASES.map((p, i) => {
          const complete = i < activeIndex || phase === "confirmed";
          const current = i === activeIndex && phase !== "confirmed";
          return (
            <li key={p.key} className="flex flex-1 items-center last:flex-none">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition",
                    complete
                      ? "bg-green-500 text-white"
                      : current
                        ? "bg-teal-500 text-white"
                        : "bg-navy-100 text-navy-400",
                  )}
                >
                  {complete ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : p.key === "submitting" && current ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={cn(
                    "text-sm font-medium",
                    complete || current ? "text-navy-900" : "text-navy-400",
                  )}
                >
                  {p.label}
                </span>
              </div>
              {i < PHASES.length - 1 && (
                <span
                  className={cn(
                    "mx-3 h-px flex-1",
                    i < activeIndex || phase === "confirmed"
                      ? "bg-green-400"
                      : "bg-navy-200",
                  )}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>

      {phase === "confirmed" ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CircleCheck className="h-5 w-5 shrink-0" aria-hidden />
          This application has been submitted.
        </div>
      ) : (
        <>
          <fieldset
            className="space-y-3"
            disabled={!interactive || !canApprove || submitting}
          >
            <legend className="sr-only">Submission checklist</legend>
            {CHECKLIST.map((item, i) => (
              <label
                key={item}
                className="flex cursor-pointer items-start gap-3 text-sm text-navy-700"
              >
                <input
                  type="checkbox"
                  checked={checked[i]}
                  onChange={() => toggle(i)}
                  className="mt-0.5 h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500 disabled:cursor-not-allowed"
                />
                <span>{item}</span>
              </label>
            ))}
          </fieldset>

          {!canApprove && (
            <p className="text-sm text-navy-500">
              Only an owner or admin can approve a submission.
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <Button
            onClick={onApprove}
            disabled={!allChecked || !canApprove || !interactive}
            isLoading={submitting}
            fullWidth
          >
            <Send className="h-4 w-4" aria-hidden />
            Approve &amp; Submit
          </Button>
        </>
      )}
    </div>
  );
}
