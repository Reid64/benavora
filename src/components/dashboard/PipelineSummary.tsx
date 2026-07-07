import Link from "next/link";

import { cn } from "@/lib/utils/cn";
import {
  STAGE_LABEL,
  type PipelineStage,
} from "@/components/applications/pipeline";
import { PIPELINE_STAGES } from "@/lib/utils/constants";

type MacroPhase = {
  id: string;
  label: string;
  stages: PipelineStage[];
  barColor: string;
  dotColor: string;
  headerColor: string;
};

const MACRO_PHASES: MacroPhase[] = [
  {
    id: "discovery",
    label: "Discovery",
    stages: ["discovered", "eligibility_review", "qualified"],
    barColor: "bg-blue-500",
    dotColor: "bg-blue-400",
    headerColor: "text-blue-600",
  },
  {
    id: "preparation",
    label: "Preparation",
    stages: ["drafting", "awaiting_documents", "ready_for_review"],
    barColor: "bg-accent",
    dotColor: "bg-accent",
    headerColor: "text-accent",
  },
  {
    id: "active",
    label: "Active",
    stages: ["submitted", "follow_up_due"],
    barColor: "bg-success-text",
    dotColor: "bg-success-text",
    headerColor: "text-success-text",
  },
  {
    id: "outcome",
    label: "Outcome",
    stages: ["awarded", "denied", "reporting_required", "renewal_opportunity"],
    barColor: "bg-amber-500",
    dotColor: "bg-amber-400",
    headerColor: "text-amber-600",
  },
];

const STAGE_PHASE: Partial<Record<PipelineStage, MacroPhase>> = {};
for (const phase of MACRO_PHASES) {
  for (const stage of phase.stages) {
    STAGE_PHASE[stage] = phase;
  }
}

/**
 * Pipeline summary: a segmented horizontal bar grouped into 4 macro-phases
 * (Discovery / Preparation / Active / Outcome), each with a distinct color.
 * Segment width is proportional to count; when total ≤ 3 each segment is
 * capped at 40% so a single application doesn't fill the entire bar.
 */
export function PipelineSummary({
  counts,
}: {
  counts: Record<PipelineStage, number>;
}) {
  const total = PIPELINE_STAGES.reduce(
    (sum, s) => sum + (counts[s] ?? 0),
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

  const maxPct = total <= 3 ? 40 : 100;
  const presentStages = PIPELINE_STAGES.filter((s) => (counts[s] ?? 0) > 0);

  return (
    <div className="space-y-4">
      {/* Segmented bar */}
      <div
        className="flex h-4 w-full overflow-hidden rounded-full bg-navy-100"
        role="img"
        aria-label="Pipeline stages distribution"
      >
        {presentStages.map((stage) => {
          const count = counts[stage] ?? 0;
          const rawPct = (count / total) * 100;
          const pct = Math.min(rawPct, maxPct);
          const phase = STAGE_PHASE[stage];
          const showCount = pct >= 8;

          return (
            <div
              key={stage}
              className={cn(
                "relative flex h-full items-center justify-center",
                phase?.barColor ?? "bg-navy-400",
              )}
              style={{ width: `${pct}%` }}
              title={`${STAGE_LABEL[stage]}: ${count}`}
              aria-hidden
            >
              {showCount && (
                <span className="select-none text-[10px] font-bold text-white drop-shadow-sm">
                  {count}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Phase legend — 4 columns, each listing stage-level counts */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        {MACRO_PHASES.map((phase) => {
          const phaseTotal = phase.stages.reduce(
            (sum, s) => sum + (counts[s] ?? 0),
            0,
          );
          if (phaseTotal === 0) return null;

          return (
            <div key={phase.id} className="space-y-1.5">
              <p
                className={cn(
                  "text-[10px] font-bold uppercase tracking-widest",
                  phase.headerColor,
                )}
              >
                {phase.label}
              </p>
              {phase.stages
                .filter((s) => (counts[s] ?? 0) > 0)
                .map((stage) => (
                  <Link
                    key={stage}
                    href="/applications"
                    className="flex items-center justify-between gap-1.5 transition hover:opacity-75"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          phase.dotColor,
                        )}
                        aria-hidden
                      />
                      <span className="truncate text-xs text-navy-600">
                        {STAGE_LABEL[stage]}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-navy-900">
                      {counts[stage]}
                    </span>
                  </Link>
                ))}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-navy-400">
        {total} application{total === 1 ? "" : "s"} across{" "}
        {presentStages.length} stage{presentStages.length === 1 ? "" : "s"}.
      </p>
    </div>
  );
}
