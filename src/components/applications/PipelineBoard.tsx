"use client";

import { useMemo, useState } from "react";

import { PipelineColumn } from "@/components/applications/PipelineColumn";
import { StageTransitionModal } from "@/components/applications/StageTransitionModal";
import {
  type EnrichedApplication,
  type PipelineStage,
} from "@/components/applications/pipeline";
import { PIPELINE_STAGES } from "@/lib/utils/constants";
import type { Tables } from "@/types/database";

export type PipelineBoardProps = {
  applications: EnrichedApplication[];
  /** Whether the board allows drag-and-drop transitions (false for viewers). */
  interactive: boolean;
  role: Tables<"profiles">["role"] | undefined;
  changedBy: string | null;
  /** Called after a successful transition so the parent can reload. */
  onChanged: () => void;
};

/**
 * The 12-column kanban pipeline board (BLUEPRINT §4.5). Columns match the
 * pipeline_stage enum order. Dragging a card to another column opens the
 * StageTransitionModal, which validates the move against the transition rules
 * and records the change. The board itself performs no DB writes.
 */
export function PipelineBoard({
  applications,
  interactive,
  role,
  changedBy,
  onChanged,
}: PipelineBoardProps) {
  const [dragging, setDragging] = useState<EnrichedApplication | null>(null);
  const [pending, setPending] = useState<{
    application: EnrichedApplication;
    target: PipelineStage;
  } | null>(null);

  const byStage = useMemo(() => {
    const groups = new Map<PipelineStage, EnrichedApplication[]>();
    for (const stage of PIPELINE_STAGES) {
      groups.set(stage, []);
    }
    for (const app of applications) {
      groups.get(app.stage)?.push(app);
    }
    return groups;
  }, [applications]);

  function handleDrop(target: PipelineStage) {
    const application = dragging;
    setDragging(null);
    if (!application) return;
    // Dropping onto the same column is a no-op; the modal handles validation of
    // every other move (including showing why a move is not allowed).
    if (application.stage === target) return;
    setPending({ application, target });
  }

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {PIPELINE_STAGES.map((stage) => (
          <PipelineColumn
            key={stage}
            stage={stage}
            applications={byStage.get(stage) ?? []}
            interactive={interactive}
            draggingId={dragging?.id ?? null}
            onDragStart={setDragging}
            onDragEnd={() => setDragging(null)}
            onDrop={handleDrop}
          />
        ))}
      </div>

      <StageTransitionModal
        isOpen={pending != null}
        onClose={() => setPending(null)}
        application={pending?.application ?? null}
        initialTargetStage={pending?.target ?? null}
        role={role}
        changedBy={changedBy}
        onComplete={() => {
          setPending(null);
          onChanged();
        }}
      />
    </>
  );
}
