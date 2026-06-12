"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  List,
  RotateCcw,
} from "lucide-react";

import { Button, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { cn } from "@/lib/utils/cn";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Tables } from "@/types/database";

type Deadline = Pick<
  Tables<"deadlines">,
  | "id"
  | "title"
  | "description"
  | "deadline_type"
  | "due_date"
  | "is_completed"
  | "completed_at"
  | "application_id"
  | "opportunity_id"
  | "google_calendar_event_id"
>;

type ViewMode = "calendar" | "list";

type UrgencyBand = "overdue" | "orange" | "yellow" | "green";

// Four urgency bands (BLUEPRINT §4.9): Red (overdue), Orange (≤3 days),
// Yellow (≤7 days), Green (7+ days). Mirrors DeadlineWidget; the Badge component
// has no "orange", so urgency styling uses explicit color classes.
const BAND_CLASSES: Record<
  UrgencyBand,
  { pill: string; dot: string; cell: string }
> = {
  overdue: {
    pill: "bg-red-100 text-red-700",
    dot: "bg-red-500",
    cell: "bg-red-50 text-red-700 hover:bg-red-100",
  },
  orange: {
    pill: "bg-orange-100 text-orange-700",
    dot: "bg-orange-500",
    cell: "bg-orange-50 text-orange-700 hover:bg-orange-100",
  },
  yellow: {
    pill: "bg-yellow-100 text-yellow-800",
    dot: "bg-yellow-500",
    cell: "bg-yellow-50 text-yellow-800 hover:bg-yellow-100",
  },
  green: {
    pill: "bg-green-100 text-green-700",
    dot: "bg-green-500",
    cell: "bg-green-50 text-green-700 hover:bg-green-100",
  },
};

const COMPLETED_CELL =
  "bg-navy-100 text-navy-400 line-through hover:bg-navy-200";

/**
 * Parse a `date`-typed column value ("yyyy-MM-dd") into a local-midnight Date so
 * day comparisons don't drift across the UTC boundary. Falls back to the native
 * parser for full timestamps.
 */
function toLocalDate(value: string): Date {
  return value.length === 10 ? parseISO(value) : new Date(value);
}

/**
 * Urgency band + label for a deadline (BLUEPRINT §4.9). Overdue, incomplete
 * deadlines are always red (Contracts §11). Based on whole calendar days.
 */
function urgency(dueDate: string): { band: UrgencyBand; label: string } {
  const days = differenceInCalendarDays(toLocalDate(dueDate), new Date());
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

/** Link to a deadline's parent record (application or opportunity), if any. */
function parentHref(d: Deadline): string | null {
  if (d.application_id) return `/applications/${d.application_id}`;
  if (d.opportunity_id) return `/opportunities/${d.opportunity_id}`;
  return null;
}

/**
 * Deadlines (BLUEPRINT §4.9 / Contracts §11). Calendar (monthly grid) and list
 * views with a toggle. Color-coded by urgency: red (overdue), orange (≤3 days),
 * yellow (≤7 days), green (7+ days). Completed deadlines are hidden by default
 * (toggle to show). Marking complete sets is_completed=true and completed_at=now;
 * un-completing clears both. All reads/writes are RLS-scoped to the organization.
 */
export default function DeadlinesPage() {
  const { profile } = useProfile();
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("calendar");
  const [showCompleted, setShowCompleted] = useState(false);
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [busyId, setBusyId] = useState<string | null>(null);

  // Google Calendar integration state (BLUEPRINT Phase 4 / Contracts §20).
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(false);
  const [autoSyncSaving, setAutoSyncSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("deadlines")
      .select(
        "id, title, description, deadline_type, due_date, is_completed, completed_at, application_id, opportunity_id, google_calendar_event_id",
      )
      .order("due_date", { ascending: true });

    if (loadError) {
      setError("Could not load deadlines.");
      setLoading(false);
      return;
    }
    setDeadlines((data ?? []) as Deadline[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = canEdit(profile?.role);

  // Load the Google Calendar connection status and the auto-sync preference. The
  // status comes from the calendar integration route; the preference lives in
  // platform_config (key calendar.auto_sync), RLS-scoped to the org.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/integrations/google/calendar");
        if (active && res.ok) {
          const data = (await res.json()) as { connected?: boolean };
          setCalendarConnected(Boolean(data.connected));
        }
      } catch {
        // Leave disconnected on failure — the sync controls simply stay hidden.
      }

      const supabase = createClient();
      const { data: config } = await supabase
        .from("platform_config")
        .select("value")
        .eq("key", "calendar.auto_sync")
        .maybeSingle();
      if (active && config) setAutoSync(config.value === "true");
    })();
    return () => {
      active = false;
    };
  }, []);

  // Sync a single deadline to Google Calendar, then reflect the linked event id.
  async function syncOne(d: Deadline) {
    if (!editable || syncingId || syncingAll) return;
    setSyncingId(d.id);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/integrations/google/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deadlineId: d.id }),
      });
      const data = (await res.json().catch(() => null)) as
        | { eventId?: string; error?: string }
        | null;
      if (!res.ok || !data?.eventId) {
        setSyncMessage(data?.error ?? "Could not add this deadline to your calendar.");
        return;
      }
      setDeadlines((prev) =>
        prev.map((row) =>
          row.id === d.id
            ? { ...row, google_calendar_event_id: data.eventId ?? row.google_calendar_event_id }
            : row,
        ),
      );
      setSyncMessage(`Added “${d.title}” to your calendar.`);
    } catch {
      setSyncMessage("Could not reach the server. Please try again.");
    } finally {
      setSyncingId(null);
    }
  }

  // Sync every incomplete deadline to Google Calendar in one pass.
  async function syncAll() {
    if (!editable || syncingAll) return;
    setSyncingAll(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/integrations/google/calendar", {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as
        | { synced?: number; created?: number; updated?: number; errors?: number; error?: string }
        | null;
      if (!res.ok || !data) {
        setSyncMessage(data?.error ?? "Could not sync deadlines to your calendar.");
        return;
      }
      const { created = 0, updated = 0, errors = 0 } = data;
      setSyncMessage(
        `Synced to calendar: ${created} created, ${updated} updated${
          errors ? `, ${errors} failed` : ""
        }.`,
      );
      // Re-load so the synced indicators reflect newly linked events.
      await load();
    } catch {
      setSyncMessage("Could not reach the server. Please try again.");
    } finally {
      setSyncingAll(false);
    }
  }

  // Persist the auto-sync preference to platform_config (org-scoped upsert).
  async function toggleAutoSync(next: boolean) {
    if (!profile?.organization_id || autoSyncSaving) return;
    setAutoSync(next);
    setAutoSyncSaving(true);
    const supabase = createClient();
    const { error: upsertError } = await supabase.from("platform_config").upsert(
      {
        organization_id: profile.organization_id,
        key: "calendar.auto_sync",
        value: next ? "true" : "false",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,key" },
    );
    if (upsertError) {
      setAutoSync(!next); // revert on failure
      setSyncMessage("Could not save the auto-sync setting.");
    }
    setAutoSyncSaving(false);
  }

  // Completed deadlines are excluded by default in both views (Contracts §11).
  const visible = useMemo(
    () => (showCompleted ? deadlines : deadlines.filter((d) => !d.is_completed)),
    [deadlines, showCompleted],
  );

  const completedCount = useMemo(
    () => deadlines.filter((d) => d.is_completed).length,
    [deadlines],
  );

  async function toggleComplete(d: Deadline) {
    if (!editable || busyId) return;
    setBusyId(d.id);
    const nextCompleted = !d.is_completed;
    const supabase = createClient();
    // Completion toggles is_completed and sets completed_at (Contracts §11).
    const { error: updateError } = await supabase
      .from("deadlines")
      .update({
        is_completed: nextCompleted,
        completed_at: nextCompleted ? new Date().toISOString() : null,
      })
      .eq("id", d.id);

    if (updateError) {
      setError("Could not update the deadline. Please try again.");
      setBusyId(null);
      return;
    }
    setDeadlines((prev) =>
      prev.map((row) =>
        row.id === d.id
          ? {
              ...row,
              is_completed: nextCompleted,
              completed_at: nextCompleted ? new Date().toISOString() : null,
            }
          : row,
      ),
    );
    setBusyId(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Deadlines
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Application, follow-up, reporting, renewal, and document-expiration
            dates, color-coded by urgency.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {calendarConnected && editable && (
            <Button
              variant="secondary"
              size="sm"
              onClick={syncAll}
              isLoading={syncingAll}
              disabled={Boolean(syncingId)}
            >
              <CalendarClock className="h-4 w-4" aria-hidden />
              Sync to Calendar
            </Button>
          )}
          <div className="inline-flex rounded-lg border border-navy-200 bg-white p-0.5 shadow-sm">
          <button
            type="button"
            onClick={() => setView("calendar")}
            aria-pressed={view === "calendar"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
              view === "calendar"
                ? "bg-teal-600 text-white"
                : "text-navy-600 hover:bg-navy-50",
            )}
          >
            <CalendarDays className="h-4 w-4" aria-hidden />
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
              view === "list"
                ? "bg-teal-600 text-white"
                : "text-navy-600 hover:bg-navy-50",
            )}
          >
            <List className="h-4 w-4" aria-hidden />
            List
          </button>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {syncMessage && (
        <div
          role="status"
          className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800"
        >
          {syncMessage}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <UrgencyLegend />
        <div className="flex flex-wrap items-center gap-4">
          {calendarConnected && editable && (
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-navy-600">
              <input
                type="checkbox"
                checked={autoSync}
                disabled={autoSyncSaving}
                onChange={(e) => void toggleAutoSync(e.target.checked)}
                className="h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
              />
              Auto-sync new deadlines to calendar
            </label>
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-navy-600">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
              className="h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
            />
            Show completed
            {completedCount > 0 && (
              <span className="text-navy-400">({completedCount})</span>
            )}
          </label>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner center label="Loading deadlines…" />
      ) : deadlines.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No deadlines yet"
          description="Deadlines are created automatically when you add opportunities with dates. They’ll appear here on the calendar and in the list."
          action={
            <Link href="/opportunities/new">
              <Button variant="secondary">Add an opportunity</Button>
            </Link>
          }
        />
      ) : view === "calendar" ? (
        <CalendarView
          month={month}
          deadlines={visible}
          onPrev={() => setMonth((m) => subMonths(m, 1))}
          onNext={() => setMonth((m) => addMonths(m, 1))}
          onToday={() => setMonth(startOfMonth(new Date()))}
        />
      ) : (
        <ListView
          deadlines={visible}
          editable={editable}
          busyId={busyId}
          onToggle={toggleComplete}
          calendarConnected={calendarConnected}
          syncingId={syncingId}
          onSync={syncOne}
        />
      )}
    </div>
  );
}

function UrgencyLegend() {
  const items: { band: UrgencyBand; label: string }[] = [
    { band: "overdue", label: "Overdue" },
    { band: "orange", label: "≤ 3 days" },
    { band: "yellow", label: "≤ 7 days" },
    { band: "green", label: "7+ days" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-navy-500">
      {items.map((item) => (
        <span key={item.band} className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              BAND_CLASSES[item.band].dot,
            )}
            aria-hidden
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function CalendarView({
  month,
  deadlines,
  onPrev,
  onNext,
  onToday,
}: {
  month: Date;
  deadlines: Deadline[];
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  // Six-week grid covering the visible month, padded to full weeks.
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  // Bucket deadlines by their due day for O(1) per-cell lookup.
  const byDay = useMemo(() => {
    const map = new Map<string, Deadline[]>();
    for (const d of deadlines) {
      const key = format(toLocalDate(d.due_date), "yyyy-MM-dd");
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    return map;
  }, [deadlines]);

  return (
    <Card noPadding>
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

      <div className="grid grid-cols-7 border-b border-navy-200 bg-navy-50 text-center text-xs font-medium text-navy-500">
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
              <div className="space-y-1">
                {dayDeadlines.map((d) => (
                  <CalendarEntry key={d.id} deadline={d} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CalendarEntry({ deadline }: { deadline: Deadline }) {
  const href = parentHref(deadline);
  const completed = Boolean(deadline.is_completed);
  const synced = Boolean(deadline.google_calendar_event_id);
  const band = completed ? null : urgency(deadline.due_date).band;
  const className = cn(
    "flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-xs font-medium transition",
    completed ? COMPLETED_CELL : BAND_CLASSES[band as UrgencyBand].cell,
  );
  const title = `${deadline.title} · ${humanizeEnum(deadline.deadline_type)}${
    synced ? " · on calendar" : ""
  }`;

  const content = (
    <>
      {synced && (
        <CalendarCheck className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      )}
      <span className="truncate">{deadline.title}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className} title={title}>
        {content}
      </Link>
    );
  }
  return (
    <div className={className} title={title}>
      {content}
    </div>
  );
}

function ListView({
  deadlines,
  editable,
  busyId,
  onToggle,
  calendarConnected,
  syncingId,
  onSync,
}: {
  deadlines: Deadline[];
  editable: boolean;
  busyId: string | null;
  onToggle: (d: Deadline) => void;
  calendarConnected: boolean;
  syncingId: string | null;
  onSync: (d: Deadline) => void;
}) {
  // Already loaded sorted by due_date ascending; keep that order here.
  if (deadlines.length === 0) {
    return (
      <Card>
        <p className="py-4 text-center text-sm text-navy-500">
          No deadlines to show. Toggle “Show completed” to include finished ones.
        </p>
      </Card>
    );
  }

  return (
    <Card noPadding>
      <ul className="divide-y divide-navy-100">
        {deadlines.map((d) => {
          const completed = Boolean(d.is_completed);
          const synced = Boolean(d.google_calendar_event_id);
          const { band, label } = urgency(d.due_date);
          const styles = BAND_CLASSES[band];
          const href = parentHref(d);
          return (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
            >
              <div className="flex min-w-0 items-start gap-3">
                {!completed && (
                  <span
                    className={cn(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      styles.dot,
                    )}
                    aria-hidden
                  />
                )}
                <div className="min-w-0">
                  <div
                    className={cn(
                      "truncate text-sm font-medium",
                      completed
                        ? "text-navy-400 line-through"
                        : "text-navy-900",
                    )}
                  >
                    {href ? (
                      <Link href={href} className="hover:underline">
                        {d.title}
                      </Link>
                    ) : (
                      d.title
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-navy-500">
                    {humanizeEnum(d.deadline_type)} · {formatDate(d.due_date)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {completed ? (
                  <span className="text-xs text-navy-400">Completed</span>
                ) : (
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                      styles.pill,
                    )}
                  >
                    {label}
                  </span>
                )}
                {calendarConnected &&
                  (synced ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-teal-600"
                      title="Synced to Google Calendar"
                    >
                      <CalendarCheck className="h-4 w-4" aria-hidden />
                      On calendar
                    </span>
                  ) : (
                    editable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={syncingId === d.id}
                        onClick={() => onSync(d)}
                        aria-label="Add deadline to Google Calendar"
                      >
                        <CalendarPlus className="h-4 w-4" aria-hidden />
                        Add to Calendar
                      </Button>
                    )
                  ))}
                {editable && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === d.id}
                    onClick={() => onToggle(d)}
                    aria-label={
                      completed
                        ? "Mark deadline incomplete"
                        : "Mark deadline complete"
                    }
                  >
                    {completed ? (
                      <>
                        <RotateCcw className="h-4 w-4" aria-hidden />
                        Reopen
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4" aria-hidden />
                        Complete
                      </>
                    )}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
