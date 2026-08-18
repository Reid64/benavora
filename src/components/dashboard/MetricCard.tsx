import type { LucideIcon } from "lucide-react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import {
  ColorIcon,
  ICON_HUE_BORDER_CLASSES,
  type IconHue,
} from "@/components/ui/ColorIcon";

export type MetricTrendDirection = "up" | "down" | "neutral";

export type MetricTrend = {
  /** Direction of movement - drives the icon and color. */
  direction: MetricTrendDirection;
  /** Short label, e.g. "+12% vs last month" or "3 due this week". */
  label: string;
};

export type MetricCardProps = {
  /** What the metric measures, e.g. "Total Opportunities". */
  label: string;
  /** The metric value, pre-formatted by the caller (currency, percent, count). */
  value: string;
  /** Optional leading icon for the metric. */
  icon?: LucideIcon;
  /** Icon chip + left-border accent color, by function (see ColorIcon). */
  hue?: IconHue;
  /** Optional trend indicator shown under the value. */
  trend?: MetricTrend;
  /** Optional supporting line under the value (when no trend is shown). */
  hint?: string;
  className?: string;
  /** Optional inline style on the root card, e.g. a solid custom background color. */
  style?: React.CSSProperties;
  /** Full replacement for the label's default classes (not merged). */
  labelClassName?: string;
  /** Full replacement for the value's default classes (not merged). */
  valueClassName?: string;
  /** Full replacement for the hint's default classes (not merged). */
  hintClassName?: string;
};

const TREND_STYLES: Record<
  MetricTrendDirection,
  { icon: LucideIcon; className: string }
> = {
  up: { icon: TrendingUp, className: "text-success-text" },
  down: { icon: TrendingDown, className: "text-error-text" },
  neutral: { icon: Minus, className: "text-text-muted" },
};

/**
 * A single dashboard metric (BLUEPRINT §4.1): a label, a prominent value, and
 * an optional trend or hint. Pure presentational - values are computed and
 * formatted server-side and passed in, so this renders in a Server Component.
 */
export function MetricCard({
  label,
  value,
  icon: Icon,
  hue = "blue",
  trend,
  hint,
  className,
  style,
  labelClassName,
  valueClassName,
  hintClassName,
}: MetricCardProps) {
  const TrendIcon = trend ? TREND_STYLES[trend.direction].icon : null;
  const colored = Boolean(style);

  return (
    <div
      style={style}
      className={cn(
        "group rounded-xl border border-border border-l-4 p-5 shadow-md transition-shadow hover:shadow-lg",
        !colored && "bg-surface",
        ICON_HUE_BORDER_CLASSES[hue],
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={labelClassName ?? "text-xs font-medium text-text-muted"}>
          {label}
        </span>
        {Icon && <ColorIcon icon={Icon} hue={hue} size="sm" />}
      </div>
      <div
        className={
          valueClassName ?? "mt-3 text-2xl font-bold tracking-tight text-text"
        }
      >
        {value}
      </div>
      {trend && TrendIcon ? (
        <div
          className={cn(
            "mt-2 inline-flex items-center gap-1 text-xs font-medium",
            TREND_STYLES[trend.direction].className,
          )}
        >
          <TrendIcon className="h-3.5 w-3.5" aria-hidden />
          {trend.label}
        </div>
      ) : (
        hint && (
          <p className={hintClassName ?? "mt-2 text-xs text-text-muted"}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}
