import type { LucideIcon } from "lucide-react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export type MetricTrendDirection = "up" | "down" | "neutral";

export type MetricTrend = {
  /** Direction of movement — drives the icon and color. */
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
  /** Optional trend indicator shown under the value. */
  trend?: MetricTrend;
  /** Optional supporting line under the value (when no trend is shown). */
  hint?: string;
  className?: string;
};

const TREND_STYLES: Record<
  MetricTrendDirection,
  { icon: LucideIcon; className: string }
> = {
  up: { icon: TrendingUp, className: "text-plum-600" },
  down: { icon: TrendingDown, className: "text-red-600" },
  neutral: { icon: Minus, className: "text-navy-400" },
};

/**
 * A single dashboard metric (BLUEPRINT §4.1): a label, a prominent value, and
 * an optional trend or hint. Pure presentational — values are computed and
 * formatted server-side and passed in, so this renders in a Server Component.
 */
export function MetricCard({
  label,
  value,
  icon: Icon,
  trend,
  hint,
  className,
}: MetricCardProps) {
  const TrendIcon = trend ? TREND_STYLES[trend.direction].icon : null;

  return (
    <div
      className={cn(
        "group rounded-xl border border-navy-100 bg-white p-5 shadow-card transition-shadow hover:shadow-card-hover",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-navy-500">{label}</span>
        {Icon && (
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-600 ring-1 ring-inset ring-teal-100 transition group-hover:bg-teal-100">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-navy-900">
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
        hint && <p className="mt-2 text-xs text-navy-400">{hint}</p>
      )}
    </div>
  );
}
