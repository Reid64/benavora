"use client";

import { useMemo, useState } from "react";
import {
  eachDayOfInterval,
  endOfWeek,
  format,
  isToday,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { humanizeEnum } from "@/lib/utils/formatters";
import {
  BAND_CLASSES,
  COMPLETED_CELL,
  DeadlineDetailModal,
  toLocalDate,
  urgency,
} from "./DeadlinePill";
import type { DeadlineItem } from "./DeadlinePill";

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  weekStart: Date;
  deadlines: DeadlineItem[];
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
}

export function WeekView({
  weekStart,
  deadlines,
  onPrevWeek,
  onNextWeek,
  onToday,
}: Props) {
  const [selected, setSelected] = useState<DeadlineItem | null>(null);

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(weekStart),
        end: endOfWeek(weekStart),
      }),
    [weekStart],
  );

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

  const weekLabel = `${format(days[0]!, "MMM d")} - ${format(days[6]!, "MMM d, yyyy")}`;

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
          <h2 className="text-base font-semibold text-navy-900">{weekLabel}</h2>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={onToday}>
              Today
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onPrevWeek}
              aria-label="Previous week"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onNextWeek}
              aria-label="Next week"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="divide-y divide-navy-100">
          {days.map((day, i) => {
            const key = format(day, "yyyy-MM-dd");
            const dayDeadlines = byDay.get(key) ?? [];
            const today = isToday(day);

            return (
              <div
                key={key}
                className={cn(
                  "flex gap-4 px-5 py-3",
                  today && "bg-teal-50/40",
                )}
              >
                <div className="w-20 shrink-0 pt-0.5">
                  <div
                    className={cn(
                      "text-sm font-semibold",
                      today ? "text-teal-600" : "text-navy-700",
                    )}
                  >
                    {DAY_ABBR[i]}
                  </div>
                  <div
                    className={cn(
                      "text-xs",
                      today ? "text-teal-500" : "text-navy-400",
                    )}
                  >
                    {format(day, "MMM d")}
                  </div>
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  {dayDeadlines.length === 0 ? (
                    <span className="text-xs text-navy-300">No deadlines</span>
                  ) : (
                    dayDeadlines.map((d) => {
                      const completed = d.is_completed;
                      const { band, label } = urgency(d.due_date);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setSelected(d)}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition",
                            completed
                              ? COMPLETED_CELL
                              : BAND_CLASSES[band].cell,
                          )}
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {d.title}
                            </div>
                            <div className="text-xs opacity-75">
                              {humanizeEnum(d.deadline_type)}
                              {d.source === "renewal" && (
                                <Badge variant="info" className="ml-1.5">
                                  Renewal
                                </Badge>
                              )}
                            </div>
                          </div>
                          <span className="shrink-0 text-xs opacity-75">
                            {completed ? "Done" : label}
                          </span>
                        </button>
                      );
                    })
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


