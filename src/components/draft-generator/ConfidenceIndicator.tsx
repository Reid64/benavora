import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/utils/constants";

export type ConfidenceIndicatorProps = {
  /** AI confidence score, 0-100. */
  score: number;
  /** Threshold below which a draft is flagged for review. Defaults to 70. */
  threshold?: number;
  className?: string;
};

type Band = {
  label: string;
  hint: string;
  bar: string;
  text: string;
  icon: typeof ShieldCheck;
};

// Bands mirror BEHAVIORAL_CONTRACTS §9 / Agent 05 confidence scoring.
function bandFor(score: number): Band {
  if (score >= 90) {
    return {
      label: "High confidence",
      hint: "Grounded in verified Knowledge Base content and proven narratives.",
      bar: "bg-green-500",
      text: "text-green-700",
      icon: ShieldCheck,
    };
  }
  if (score >= 70) {
    return {
      label: "Good confidence",
      hint: "Mostly verified content with minor, reasonable inferences.",
      bar: "bg-teal-500",
      text: "text-teal-700",
      icon: ShieldCheck,
    };
  }
  if (score >= 50) {
    return {
      label: "Review needed",
      hint: "Significant AI-generated content beyond your Knowledge Base.",
      bar: "bg-yellow-500",
      text: "text-yellow-700",
      icon: ShieldQuestion,
    };
  }
  return {
    label: "Insufficient data",
    hint: "Not enough verified content - update your Knowledge Base before submitting.",
    bar: "bg-red-500",
    text: "text-red-700",
    icon: ShieldAlert,
  };
}

/**
 * Visual confidence score (BLUEPRINT §4.8): a labelled, colour-coded bar with a
 * short interpretation tied to the review threshold.
 */
export function ConfidenceIndicator({
  score,
  threshold = AI_CONFIDENCE_THRESHOLD,
  className,
}: ConfidenceIndicatorProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = bandFor(clamped);
  const Icon = band.icon;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <div className={cn("flex items-center gap-1.5 text-sm font-medium", band.text)}>
          <Icon className="h-4 w-4" aria-hidden />
          {band.label}
        </div>
        <span className="text-sm font-semibold text-navy-900">
          {clamped}
          <span className="text-navy-400">/100</span>
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-navy-100"
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="AI confidence score"
      >
        <div
          className={cn("h-full rounded-full transition-all", band.bar)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <p className="text-xs text-navy-500">
        {band.hint}
        {clamped < threshold &&
          " This draft falls below your review threshold."}
      </p>
    </div>
  );
}
