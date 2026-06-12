"use client";

import { useRouter } from "next/navigation";
import { Building2, CalendarClock, Clock } from "lucide-react";

import { formatCurrency, formatDate } from "@/lib/utils/formatters";
import {
  daysInStage,
  type EnrichedApplication,
} from "@/components/applications/pipeline";

export type ApplicationCardProps = {
  application: EnrichedApplication;
  /** Whether the card can be dragged (false for read-only viewers). */
  draggable: boolean;
  /** Called when a drag starts so the board can track the dragged application. */
  onDragStart: (application: EnrichedApplication) => void;
  /** Called when a drag ends (drop or cancel). */
  onDragEnd: () => void;
};

/**
 * A single application card on the pipeline board (BLUEPRINT §4.5). Shows the
 * opportunity name, funder, requested amount, deadline, and days in the current
 * stage. Draggable via the HTML5 drag API; clicking opens the detail view.
 */
export function ApplicationCard({
  application,
  draggable,
  onDragStart,
  onDragEnd,
}: ApplicationCardProps) {
  const router = useRouter();
  const days = daysInStage(application.stageEnteredAt);

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", application.id);
        onDragStart(application);
      }}
      onDragEnd={onDragEnd}
      onClick={() => router.push(`/applications/${application.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/applications/${application.id}`);
        }
      }}
      className={
        "group rounded-lg border border-navy-200 bg-white p-3 text-left shadow-sm transition hover:border-teal-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 " +
        (draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer")
      }
    >
      <p className="line-clamp-2 text-sm font-medium text-navy-900">
        {application.opportunityName ?? "Untitled opportunity"}
      </p>

      {application.funderName && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-navy-500">
          <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{application.funderName}</span>
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-navy-500">
        <span className="font-medium text-navy-700">
          {formatCurrency(application.requested_amount)}
        </span>
        {application.deadline && (
          <span className="flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            {formatDate(application.deadline)}
          </span>
        )}
      </div>

      <p className="mt-2 flex items-center gap-1 text-xs text-navy-400">
        <Clock className="h-3.5 w-3.5" aria-hidden />
        {days === 0
          ? "In stage today"
          : `${days} day${days === 1 ? "" : "s"} in stage`}
      </p>
    </div>
  );
}
