"use client";

import { useMemo, useState } from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import {
  BAND_CLASSES,
  COMPLETED_CELL,
  DeadlineDetailModal,
  DeadlinePill,
  toLocalDate,
} from "./DeadlinePill";
import type { DeadlineItem } from "./DeadlinePill";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  month: Date;
  deadlines: DeadlineItem[];
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function CalendarGrid({ month, deadlines, onPrev, onNext, onToday }: Props) {
  const [selected, setSelected] = useState<DeadlineItem | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month));
    const end = endOfWeek(endOfMonth(month));
    return eachDayOfInterval({ start, end });
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, DeadlineItem[]>();
    for (const d of deadlines) {
      const key = format(toLocalDate(d.due_date), "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    return map;
  }, [deadlines]);

  return (
    <>
      {/* Plain div, not <Card>: Card's default `bg-white` class is forced by
          globals.css's `!important` compat layer and would silently defeat
          this inline background color (same issue documented in
          DraftsHistoryPanel.tsx). */}
      <div
        className="rounded-xl shadow-sm border border-border transition-shadow hover:shadow-md"
        style={{ backgroundColor: "#F8F5EE", border: "2px solid #101B2D", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
      >
        <div className="flex items-center justify-between border-b border-navy-200 px-5 py-4">
          <h2 className="text-base font-semibold text-navy-900">
            {format(month, "MMMM yyyy")}
          </h2>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={onToday}>
              Today
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onPrev}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onNext}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-navy-200 bg-sidebar text-center text-xs font-medium text-white">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-2 py-2">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const inMonth = isSameMonth(day, month);
            const dayDeadlines = byDay.get(key) ?? [];
            const isExpanded = expanded === key;
            const MAX = 3;
            const visible = isExpanded ? dayDeadlines : dayDeadlines.slice(0, MAX);
            const overflow = !isExpanded && dayDeadlines.length > MAX ? dayDeadlines.length - MAX : 0;

            return (
              <div
                key={key}
                className={cn(
                  "min-h-[6.5rem] border-b border-r border-navy-100 p-1.5",
                  !inMonth && "bg-navy-50/60",
                )}
              >
                <div
                  className={cn(
                    "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs",
                    isToday(day)
                      ? "bg-teal-600 font-semibold text-white"
                      : inMonth
                        ? "text-navy-600"
                        : "text-navy-400",
                  )}
                >
                  {format(day, "d")}
                </div>
                <div className="space-y-0.5">
                  {visible.map((d) => (
                    <DeadlinePill key={d.id} deadline={d} onClick={setSelected} />
                  ))}
                  {overflow > 0 && (
                    <button
                      type="button"
                      className="w-full rounded px-1.5 py-0.5 text-left text-xs text-navy-500 hover:bg-navy-100"
                      onClick={() => setExpanded(key)}
                    >
                      +{overflow} more
                    </button>
                  )}
                  {isExpanded && dayDeadlines.length > MAX && (
                    <button
                      type="button"
                      className="w-full rounded px-1.5 py-0.5 text-left text-xs text-navy-400 hover:bg-navy-100"
                      onClick={() => setExpanded(null)}
                    >
                      Show less
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <DeadlineDetailModal
          deadline={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// Re-export so page.tsx can import band utilities from one place
export { BAND_CLASSES, COMPLETED_CELL };


