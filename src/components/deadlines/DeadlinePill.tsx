"use client";

import { differenceInCalendarDays, parseISO } from "date-fns";
import { CalendarCheck, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { cn } from "@/lib/utils/cn";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";

export type UrgencyBand = "overdue" | "orange" | "yellow" | "green";

export const BAND_VARIANT: Record<UrgencyBand, BadgeVariant> = {
  overdue: "error",
  orange: "warning",
  yellow: "warning",
  green: "success",
};

export const BAND_CLASSES: Record<
  UrgencyBand,
  { dot: string; cell: string }
> = {
  overdue: {
    dot: "bg-red-500",
    cell: "bg-red-100 text-red-700 hover:bg-red-200 border border-red-200",
  },
  orange: {
    dot: "bg-warning-text",
    cell: "bg-warning-bg text-warning-text hover:bg-warning-bg/70 border border-warning-text/20",
  },
  yellow: {
    dot: "bg-yellow-500",
    cell: "bg-yellow-100 text-yellow-800 hover:bg-yellow-200 border border-yellow-200",
  },
  green: {
    dot: "bg-green-500",
    cell: "bg-green-100 text-green-700 hover:bg-green-200 border border-green-200",
  },
};

export const COMPLETED_CELL =
  "bg-navy-100 text-navy-400 line-through hover:bg-navy-200 border border-navy-200";

export interface DeadlineItem {
  id: string;
  title: string;
  description?: string | null;
  deadline_type: string;
  due_date: string;
  is_completed: boolean;
  completed_at?: string | null;
  application_id?: string | null;
  opportunity_id?: string | null;
  google_calendar_event_id?: string | null;
  source: "deadline" | "renewal";
}

export function toLocalDate(value: string): Date {
  return value.length === 10 ? parseISO(value) : new Date(value);
}

export function urgency(dueDate: string): { band: UrgencyBand; label: string } {
  const days = differenceInCalendarDays(toLocalDate(dueDate), new Date());
  if (days < 0) {
    const n = Math.abs(days);
    return { band: "overdue", label: `Overdue by ${n} day${n === 1 ? "" : "s"}` };
  }
  if (days === 0) return { band: "orange", label: "Due today" };
  const label = `In ${days} day${days === 1 ? "" : "s"}`;
  if (days <= 3) return { band: "orange", label };
  if (days <= 7) return { band: "yellow", label };
  return { band: "green", label };
}

export function parentHref(d: DeadlineItem): string | null {
  if (d.application_id) return `/applications/${d.application_id}`;
  if (d.opportunity_id) return `/opportunities/${d.opportunity_id}`;
  return null;
}

interface PillProps {
  deadline: DeadlineItem;
  onClick: (d: DeadlineItem) => void;
}

export function DeadlinePill({ deadline, onClick }: PillProps) {
  const completed = deadline.is_completed;
  const synced = Boolean(deadline.google_calendar_event_id);
  const { band, label } = urgency(deadline.due_date);

  const tooltipTitle = `${deadline.title} · ${humanizeEnum(deadline.deadline_type)} · ${label}${
    synced ? " · on calendar" : ""
  }`;

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-xs font-medium transition",
        completed ? COMPLETED_CELL : BAND_CLASSES[band].cell,
      )}
      title={tooltipTitle}
      onClick={() => onClick(deadline)}
    >
      {synced && (
        <CalendarCheck className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      )}
      <span className="truncate">{deadline.title}</span>
    </button>
  );
}

interface ModalProps {
  deadline: DeadlineItem;
  onClose: () => void;
}

export function DeadlineDetailModal({ deadline, onClose }: ModalProps) {
  const completed = deadline.is_completed;
  const { band, label } = urgency(deadline.due_date);
  const href = parentHref(deadline);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-navy-100 px-5 py-4">
          <div className="min-w-0 pr-2">
            <p className="truncate text-base font-semibold text-navy-900">
              {deadline.title}
            </p>
            <p className="mt-0.5 text-sm text-navy-500">
              {humanizeEnum(deadline.deadline_type)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-navy-400 hover:bg-navy-100 hover:text-navy-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-navy-500">Due date</span>
            <span className="font-medium text-navy-800">
              {formatDate(deadline.due_date)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-navy-500">Status</span>
            {completed ? (
              <span className="text-navy-400">Completed</span>
            ) : (
              <Badge variant={BAND_VARIANT[band]}>{label}</Badge>
            )}
          </div>
          {deadline.description && (
            <p className="text-sm text-navy-600">{deadline.description}</p>
          )}
          {deadline.source === "renewal" && (
            <div className="rounded-md bg-teal-50 px-3 py-2 text-xs text-teal-700">
              From renewals tracker
            </div>
          )}
        </div>

        {href && (
          <div className="border-t border-navy-100 px-5 py-3">
            <Link
              href={href}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 hover:text-teal-700"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View {deadline.application_id ? "application" : "opportunity"}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
