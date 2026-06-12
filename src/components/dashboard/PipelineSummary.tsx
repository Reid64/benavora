import Link from "next/link";

import type { BadgeColor } from "@/components/ui";
import {
  STAGE_COLOR,
  STAGE_LABEL,
  type PipelineStage,
} from "@/components/applications/pipeline";
import { PIPELINE_STAGES } from "@/lib/utils/constants";
import { cn } from "@/lib/utils/cn";

/** Solid bar/segment fill for each Badge color used by the pipeline stages. */
const BAR_FILL: Record<BadgeColor, string> = {
  gray: "bg-navy-400",
  teal: "bg-teal-500",
  indigo: "bg-teal-500",
  purple: "bg-plum-500",
  navy: "bg-navy-600",
  green: "bg-green-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
};

/**
 * Pipeline summary (BLUEPRINT §4.1 / §4.5): a horizontal bar of application
 * counts across the 12 pipeline stages, with a per-stage legend. Counts are
 * computed server-side and passed in as a map keyed by stage.
 */
export function PipelineSummary({
  counts,
}: {
  counts: Record<PipelineStage, number>;
}) {
  const total = PIPELINE_STAGES.reduce(
    (sum, stage) => sum + (counts[stage] ?? 0),
    0,
  );

  if (total === 0) {
    return (
      <p className="py-6 text-center text-sm text-navy-500">
        No applications in the pipeline yet. Create one from a qualified
        opportunity to get started.
      </p>
    );
  }

  const present = PIPELINE_STAGES.filter((stage) => (counts[stage] ?? 0) > 0);

  return (
    <div className="space-y-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-navy-100">
        {present.map((stage) => {
          const count = counts[stage] ?? 0;
          return (
            <div
              key={stage}
              className={cn("h-full", BAR_FILL[STAGE_COLOR[stage]])}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${STAGE_LABEL[stage]}: ${count}`}
              aria-hidden
            />
          );
        })}
      </div>

      <ul className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        {present.map((stage) => (
          <li key={stage}>
            <Link
              href="/applications"
              className="flex items-center justify-between gap-2 text-sm transition hover:opacity-80"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    BAR_FILL[STAGE_COLOR[stage]],
                  )}
                  aria-hidden
                />
                <span className="truncate text-navy-600">
                  {STAGE_LABEL[stage]}
                </span>
              </span>
              <span className="shrink-0 font-semibold text-navy-900">
                {counts[stage]}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-xs text-navy-400">
        {total} application{total === 1 ? "" : "s"} across{" "}
        {present.length} stage{present.length === 1 ? "" : "s"}.
      </p>
    </div>
  );
}
