import { AlertTriangle, Flame, Target } from "lucide-react";

import { Badge } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

/**
 * Shared display helpers for an opportunity's eligibility score and the
 * Eligibility Scoring Agent's recommendation (BLUEPRINT §4.4). Used by both
 * OpportunityTable and OpportunityDetail so the colour thresholds stay in one
 * place: green 80+, yellow 60-79, red below 60.
 */

type ScoreColor = "green" | "yellow" | "red";

export function eligibilityColor(score: number): ScoreColor {
  if (score >= 80) return "green";
  if (score >= 60) return "yellow";
  return "red";
}

const BAR_FILL: Record<ScoreColor, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
};

const SCORE_TEXT: Record<ScoreColor, string> = {
  green: "text-green-700",
  yellow: "text-yellow-800",
  red: "text-red-700",
};

export type EligibilityBarProps = {
  /** 0-100 score, or null when the agent has not scored it yet. */
  score: number | null;
  /** Width of the bar track. Defaults to a compact 6rem for table rows. */
  width?: "sm" | "lg";
  className?: string;
};

/** A coloured progress bar for an eligibility score, with the numeric value. */
export function EligibilityBar({
  score,
  width = "sm",
  className,
}: EligibilityBarProps) {
  if (score == null) {
    return <span className="text-xs text-navy-400">Not scored</span>;
  }
  const clamped = Math.max(0, Math.min(100, score));
  const color = eligibilityColor(clamped);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "h-2 overflow-hidden rounded-full bg-navy-100",
          width === "lg" ? "w-full" : "w-24",
        )}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Eligibility score"
      >
        <div
          className={cn("h-full rounded-full transition-all", BAR_FILL[color])}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className={cn("text-xs font-semibold tabular-nums", SCORE_TEXT[color])}>
        {clamped}
      </span>
    </div>
  );
}

const RECOMMENDATION_VARIANT: Record<string, BadgeVariant> = {
  apply: "success",
  review: "warning",
  skip: "neutral",
};

export type RecommendationBadgeProps = {
  /** Free-text recommendation set by the agent: 'apply' | 'skip' | 'review'. */
  recommendation: string | null;
};

/** Badge for the agent's apply/skip/review recommendation. */
export function RecommendationBadge({ recommendation }: RecommendationBadgeProps) {
  if (!recommendation) return null;
  const variant = RECOMMENDATION_VARIANT[recommendation.toLowerCase()] ?? "neutral";
  return <Badge variant={variant}>{humanizeEnum(recommendation)}</Badge>;
}

// --- match percentage --------------------------------------------------------
//
// The match percentage is the Eligibility Scoring Agent's fit score surfaced as
// the opportunity's headline "match" (BLUEPRINT §4.4): it drives the colour-
// coded badge, the high-priority flag, and the default list sort. Thresholds
// mirror src/lib/agents/eligibility-scorer.ts (kept in sync intentionally; the
// agent module is server-only so its constants are not imported here).

/** Match >= this auto-flags the opportunity as high priority. */
export const HIGH_PRIORITY_THRESHOLD = 80;
/** Below this match the specific mismatch reasons are shown to the user. */
export const MISMATCH_REASON_THRESHOLD = 40;

export function matchColor(percentage: number): ScoreColor {
  if (percentage <= 0) return "red";
  if (percentage > 50) return "green";
  return "yellow";
}

const MATCH_BADGE_VARIANT: Record<ScoreColor, BadgeVariant> = {
  green: "success",
  yellow: "warning",
  red: "error",
};

export type MatchBadgeProps = {
  /** 0-100 match, or null when the agent has not scored it yet. */
  percentage: number | null;
  className?: string;
};

/** A colour-coded "NN% match" pill. Renders "Not scored" when null. */
export function MatchBadge({ percentage, className }: MatchBadgeProps) {
  if (percentage == null) {
    return (
      <Badge variant="neutral" className={className}>
        <Target className="h-3 w-3" aria-hidden />
        Not scored
      </Badge>
    );
  }
  const clamped = Math.max(0, Math.min(100, percentage));
  return (
    <Badge variant={MATCH_BADGE_VARIANT[matchColor(clamped)]} className={className}>
      <Target className="h-3 w-3" aria-hidden />
      <span className="tabular-nums">{clamped}%</span> match
    </Badge>
  );
}

/** Flag shown on the strongest opportunities (match >= 80). */
export function HighPriorityBadge({ className }: { className?: string }) {
  return (
    <Badge variant="warning" className={className}>
      <Flame className="h-3 w-3" aria-hidden />
      High priority
    </Badge>
  );
}

export type MismatchReasonsProps = {
  /** "<criterion>: <reason>" lines from the scoring agent. */
  reasons: string[] | null;
  className?: string;
};

/**
 * The eligibility criteria that failed, shown for poorly-matched opportunities
 * (match below 40) so the user knows why an opportunity is a weak fit.
 */
export function MismatchReasons({ reasons, className }: MismatchReasonsProps) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <div
      className={cn(
        "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        Why this is a weak match
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {reasons.map((reason, i) => (
          <li key={`${reason}-${i}`}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

/** Badge variant for an opportunity_status value. Shared across views. */
export const OPPORTUNITY_STATUS_VARIANT: Record<
  Enums<"opportunity_status">,
  BadgeVariant
> = {
  open: "success",
  applied: "info",
  closed: "neutral",
  expired: "error",
};
