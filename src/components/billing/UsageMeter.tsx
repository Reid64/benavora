import { cn } from "@/lib/utils/cn";

export type UsageMeterProps = {
  /** Metric label, e.g. "Agent runs / day". */
  label: string;
  /** Current usage. */
  used: number;
  /** Tier limit for this metric. */
  limit: number;
  /** Optional unit suffix appended to the numbers, e.g. "MB". */
  unit?: string;
};

/**
 * A labelled usage bar (BLUEPRINT Phase 5). The fill colour reflects how close
 * the org is to its tier limit (Contracts §25: warn at 80%):
 *   green  < 50%, yellow 50-80%, red > 80%.
 */
export function UsageMeter({ label, used, limit, unit }: UsageMeterProps) {
  const pct =
    limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : used > 0 ? 100 : 0;

  const barColor =
    pct > 80 ? "bg-red-500" : pct >= 50 ? "bg-amber-400" : "bg-teal-400";

  const suffix = unit ? ` ${unit}` : "";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-navy-800">{label}</span>
        <span className="text-sm tabular-nums text-navy-500">
          {used.toLocaleString()}
          {suffix} / {limit.toLocaleString()}
          {suffix}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-navy-100"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={label}
      >
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
