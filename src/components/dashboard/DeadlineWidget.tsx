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

type UrgencyBand = "overdue" | "this_week" | "upcoming";

// Three urgency bands, each rendered as a colored dot: red (overdue), amber
// (due within 7 days), green (further out).
const BAND_DOT: Record<UrgencyBand, string> = {
  overdue: "bg-red-500",
  this_week: "bg-amber-500",
  upcoming: "bg-green-500",
};

function urgency(dueDate: string): { band: UrgencyBand; label: string } {
  const days = differenceInCalendarDays(new Date(dueDate), new Date());
  if (days < 0) {
    const overdue = Math.abs(days);
    return {
      band: "overdue",
      label: `Overdue by ${overdue} day${overdue === 1 ? "" : "s"}`,
    };
  }
  if (days === 0) return { band: "this_week", label: "Due today" };
  const label = `In ${days} day${days === 1 ? "" : "s"}`;
  if (days <= 7) return { band: "this_week", label };
  return { band: "upcoming", label };
}

const DARK_DATE_COLOR: Record<UrgencyBand, string> = {
  overdue: "#EF4444",
  this_week: "#F59E0B",
  upcoming: "#94A3B8",
};

/**
 * Upcoming deadlines widget (BLUEPRINT §4.1 / §4.9): deadlines due within the
 * next 7 days plus anything overdue, color-coded by urgency. Data is loaded
 * server-side (incomplete deadlines only) and passed in, sorted by due date.
 *
 * `dark` renders each row for a dark navy panel (title/date colors flip to
 * light-on-dark) instead of the default light-surface treatment.
 */
export function DeadlineWidget({
  items,
  dark = false,
}: {
  items: DeadlineWidgetItem[];
  dark?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <CalendarCheck
          className={cn("h-6 w-6", dark ? "text-white/30" : "text-navy-300")}
          aria-hidden
        />
        <p className={cn("mt-2 text-sm", dark ? "text-white/50" : "text-navy-500")}>
          Nothing due in the next 7 days.
        </p>
      </div>
    );
  }

  if (dark) {
    return (
      <ul>
        {items.map((item) => {
          const { band, label } = urgency(item.dueDate);
          const row = (
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#F1F5F9",
                }}
                className="truncate"
              >
                {item.title}
              </span>
              <span
                style={{
                  fontSize: "12px",
                  color: DARK_DATE_COLOR[band],
                  fontWeight: 600,
                }}
                className="shrink-0"
              >
                {label}
              </span>
            </div>
          );

          return (
            <li key={item.id}>
              {item.href ? (
                <Link href={item.href} className="block transition hover:bg-white/[0.04]">
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const { band, label } = urgency(item.dueDate);
        const body = (
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                BAND_DOT[band],
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">
                {item.title}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {humanizeEnum(item.deadlineType)} · {formatDate(item.dueDate)}{" "}
                · {label}
              </p>
            </div>
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
