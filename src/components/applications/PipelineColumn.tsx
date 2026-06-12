"use client";

import { useState } from "react";

import { Badge } from "@/components/ui";
import { ApplicationCard } from "@/components/applications/ApplicationCard";
import {
  STAGE_COLOR,
  STAGE_LABEL,
  type EnrichedApplication,
  type PipelineStage,
} from "@/components/applications/pipeline";

export type PipelineColumnProps = {
  stage: PipelineStage;
  applications: EnrichedApplication[];
  /** Whether cards can be dragged and drops are accepted (false for viewers). */
  interactive: boolean;
  /** The application currently being dragged, if any (to suppress self-drops). */
  draggingId: string | null;
  onDragStart: (application: EnrichedApplication) => void;
  onDragEnd: () => void;
  /** Called when an application is dropped onto this column. */
  onDrop: (stage: PipelineStage) => void;
};

/**
 * One stage column on the pipeline board. Renders its applications as cards and,
 * when interactive, acts as an HTML5 drop target that highlights on drag-over.
 */
export function PipelineColumn({
  stage,
  applications,
  interactive,
  draggingId,
  onDragStart,
  onDragEnd,
  onDrop,
}: PipelineColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  // A drop onto this column only makes sense for a card from another column.
  const draggingFromElsewhere =
    draggingId != null &&
    !applications.some((app) => app.id === draggingId);

  return (
    <div
      className="flex w-72 shrink-0 flex-col"
      onDragOver={(e) => {
        if (!interactive) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        if (!interactive) return;
        e.preventDefault();
        setIsDragOver(false);
        onDrop(stage);
      }}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <div className="flex items-center gap-2">
          <Badge color={STAGE_COLOR[stage]} withDot>
            {STAGE_LABEL[stage]}
          </Badge>
        </div>
        <span className="text-xs font-medium text-navy-400">
          {applications.length}
        </span>
      </div>

      <div
        className={
          "flex flex-1 flex-col gap-2 rounded-lg border border-dashed p-2 transition " +
          (isDragOver && draggingFromElsewhere
            ? "border-teal-400 bg-teal-50/60"
            : "border-navy-200 bg-navy-50/50")
        }
      >
        {applications.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-navy-400">
            No applications
          </p>
        ) : (
          applications.map((app) => (
            <ApplicationCard
              key={app.id}
              application={app}
              draggable={interactive}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>
    </div>
  );
}
