import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { differenceInCalendarDays } from "date-fns";

import { cn } from "@/lib/utils/cn";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";

export type DeadlineWidgetItem = {
  id: string;
  title: string;
  /** Deadline type enum value, e.g. "application_deadline". */
  deadlineType: string;
  /** Due date (ISO/date string). */
  dueDate: string;
  /** Link target for the deadline's parent record, if any. */
  href: string | null;
};

type UrgencyBand = "overdue" | "orange" | "yellow" | "green";

// Four urgency bands (BLUEPRINT §4.9). The Badge component has no "orange",
// so urgency pills use explicit color classes to keep all four bands distinct.
const BAND_CLASSES: Record<UrgencyBand, { pill: string; dot: string }> = {
  overdue: { pill: "bg-red-100 text-red-700", dot: "bg-red-500" },
  orange: { pill: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  yellow: { pill: "bg-yellow-100 text-yellow-800", dot: "bg-yellow-500" },
  green: { pill: "bg-green-100 text-green-700", dot: "bg-green-500" },
};

/**
 * Urgency band for a deadline (BLUEPRINT §4.9): Red (overdue), Orange (≤3 days),
 * Yellow (≤7 days), Green (7+ days). Based on whole calendar days from today.
 */
function urgency(dueDate: string): { band: UrgencyBand; label: string } {
  const days = differenceInCalendarDays(new Date(dueDate), new Date());
  if (days < 0) {
    const overdue = Math.abs(days);
    return {
      band: "overdue",
      label: `Overdue by ${overdue} day${overdue === 1 ? "" : "s"}`,
    };
  }
  if (days === 0) return { band: "orange", label: "Due today" };
  const label = `In ${days} day${days === 1 ? "" : "s"}`;
  if (days <= 3) return { band: "orange", label };
  if (days <= 7) return { band: "yellow", label };
  return { band: "green", label };
}

/**
 * Upcoming deadlines widget (BLUEPRINT §4.1 / §4.9): deadlines due within the
 * next 7 days plus anything overdue, color-coded by urgency. Data is loaded
 * server-side (incomplete deadlines only) and passed in, sorted by due date.
 */
export function DeadlineWidget({ items }: { items: DeadlineWidgetItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <CalendarCheck className="h-6 w-6 text-navy-300" aria-hidden />
        <p className="mt-2 text-sm text-navy-500">
          Nothing due in the next 7 days.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const { band, label } = urgency(item.dueDate);
        const styles = BAND_CLASSES[band];
        const body = (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-navy-900">
                {item.title}
              </p>
              <p className="mt-0.5 text-xs text-navy-500">
                {humanizeEnum(item.deadlineType)} · {formatDate(item.dueDate)}
              </p>
            </div>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
                styles.pill,
              )}
            >
              <span
                className={cn("h-1.5 w-1.5 rounded-full", styles.dot)}
                aria-hidden
              />
              {label}
            </span>
          </div>
        );

        return (
          <li key={item.id}>
            {item.href ? (
              <Link
                href={item.href}
                className="-mx-2 block rounded-lg px-2 py-1.5 transition hover:bg-navy-50"
              >
                {body}
              </Link>
            ) : (
              <div className="py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
