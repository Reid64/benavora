import { Badge } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

/**
 * Shared display helpers for an opportunity's eligibility score and the
 * Eligibility Scoring Agent's recommendation (BLUEPRINT §4.4). Used by both
 * OpportunityTable and OpportunityDetail so the colour thresholds stay in one
 * place: green 80+, yellow 60–79, red below 60.
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
  /** 0–100 score, or null when the agent has not scored it yet. */
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

const RECOMMENDATION_COLOR: Record<string, BadgeColor> = {
  apply: "green",
  review: "yellow",
  skip: "gray",
};

export type RecommendationBadgeProps = {
  /** Free-text recommendation set by the agent: 'apply' | 'skip' | 'review'. */
  recommendation: string | null;
};

/** Badge for the agent's apply/skip/review recommendation. */
export function RecommendationBadge({ recommendation }: RecommendationBadgeProps) {
  if (!recommendation) return null;
  const color = RECOMMENDATION_COLOR[recommendation.toLowerCase()] ?? "gray";
  return <Badge color={color}>{humanizeEnum(recommendation)}</Badge>;
}

/** Badge colour for an opportunity_status value. Shared across views. */
export const OPPORTUNITY_STATUS_COLOR: Record<
  Enums<"opportunity_status">,
  BadgeColor
> = {
  open: "green",
  applied: "blue",
  closed: "gray",
  expired: "red",
};
