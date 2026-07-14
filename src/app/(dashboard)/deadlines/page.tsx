"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  addMonths,
  addWeeks,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronRight,
  List,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import { Badge, Button, EmptyState, LoadingSpinner } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { cn } from "@/lib/utils/cn";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import {
  BAND_VARIANT,
  urgency,
  parentHref,
} from "@/components/deadlines/DeadlinePill";
import type { DeadlineItem } from "@/components/deadlines/DeadlinePill";
import { CalendarGrid } from "@/components/deadlines/CalendarGrid";
import { WeekView } from "@/components/deadlines/WeekView";
import type { Tables } from "@/types/database";
import type { ComplianceItem } from "@/app/api/compliance/route";

type ViewMode = "calendar" | "week" | "list";
type UrgencyBand = "overdue" | "orange" | "yellow" | "green";
type PageTab = "deadlines" | "compliance";

// Three-tier display bucket for deadline/compliance list rows (Elevated Slate):
// the four-band urgency() output collapses to overdue / this-week / future.
type UrgencyBucket = "overdue" | "week" | "future";

function urgencyBucket(band: UrgencyBand): UrgencyBucket {
  if (band === "overdue") return "overdue";
  if (band === "green") return "future";
  return "week";
}

const URGENCY_ITEM_CLASSES: Record<UrgencyBucket, string> = {
  overdue: "bg-[#FEF2F2] border-l-4 border-[#EF4444] rounded-xl p-4 mb-3",
  week: "bg-[#FFFBEB] border-l-4 border-[#F59E0B] rounded-xl p-4 mb-3",
  future: "bg-surface shadow-sm border border-border rounded-xl p-4 mb-3",
};

const URGENCY_DATE_CLASSES: Record<UrgencyBucket, string> = {
  overdue: "text-[#EF4444] font-bold",
  week: "text-[#F59E0B] font-bold",
  future: "text-slate-500",
};

const DEADLINE_TYPES = [
  "application_deadline",
  "follow_up_date",
  "reporting_deadline",
  "renewal_date",
  "document_expiration",
] as const;

const TYPE_SHORT: Record<string, string> = {
  application_deadline: "Application",
  follow_up_date: "Follow-up",
  reporting_deadline: "Reporting",
  renewal_date: "Renewal",
  document_expiration: "Document",
};

type DbDeadline = Pick<
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

type RenewalRow = {
  id: string;
  application_id: string;
  opportunity_id: string | null;
  reporting_deadline: string | null;
  renewal_window_start: string | null;
  renewal_window_end: string | null;
  opportunities: { title: string } | null;
};

function dbDeadlineToItem(d: DbDeadline): DeadlineItem {
  return {
    ...d,
    deadline_type: d.deadline_type as string,
    is_completed: Boolean(d.is_completed),
    source: "deadline",
  };
}

function renewalToItems(r: RenewalRow): DeadlineItem[] {
  const base = r.opportunities?.title ?? "Grant";
  const items: DeadlineItem[] = [];
  if (r.reporting_deadline) {
    items.push({
      id: `renewal-${r.id}-report`,
      title: `${base} - Report Due`,
      description: null,
      deadline_type: "reporting_deadline",
      due_date: r.reporting_deadline,
      is_completed: false,
      application_id: r.application_id,
      opportunity_id: r.opportunity_id ?? null,
      source: "renewal",
    });
  }
  if (r.renewal_window_start) {
    items.push({
      id: `renewal-${r.id}-start`,
      title: `${base} - Renewal Window Opens`,
      description: null,
      deadline_type: "renewal_date",
      due_date: r.renewal_window_start,
      is_completed: false,
      application_id: r.application_id,
      opportunity_id: r.opportunity_id ?? null,
      source: "renewal",
    });
  }
  if (r.renewal_window_end) {
    items.push({
      id: `renewal-${r.id}-end`,
      title: `${base} - Renewal Deadline`,
      description: null,
      deadline_type: "renewal_date",
      due_date: r.renewal_window_end,
      is_completed: false,
      application_id: r.application_id,
      opportunity_id: r.opportunity_id ?? null,
      source: "renewal",
    });
  }
  return items;
}

export default function DeadlinesPage() {
  const { profile } = useProfile();
  const { searchParams, setParams } = useUrlState();

  const [tab, setTab] = useState<PageTab>("deadlines");
  const [dbDeadlines, setDbDeadlines] = useState<DbDeadline[]>([]);
  const [renewalItems, setRenewalItems] = useState<DeadlineItem[]>([]);
  const [complianceItems, setComplianceItems] = useState<ComplianceItem[]>([]);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Google Calendar integration state
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(false);
  const [autoSyncSaving, setAutoSyncSaving] = useState(false);

  // Detect mobile on client so we can default to list view
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // --- URL state ---
  const viewParam = searchParams.get("view");
  const view: ViewMode = useMemo(() => {
    if (viewParam === "list") return "list";
    if (viewParam === "week") return "week";
    if (viewParam === "calendar") return "calendar";
    return isMobile ? "list" : "calendar";
  }, [viewParam, isMobile]);

  const showCompleted = searchParams.get("completed") === "1";

  const monthParam = searchParams.get("month");
  const month = useMemo<Date>(() => {
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const parsed = startOfMonth(parseISO(`${monthParam}-01`));
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return startOfMonth(new Date());
  }, [monthParam]);

  const weekParam = searchParams.get("week");
  const weekStart = useMemo<Date>(() => {
    if (weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
      const parsed = parseISO(weekParam);
      if (!Number.isNaN(parsed.getTime())) return startOfWeek(parsed);
    }
    return startOfWeek(new Date());
  }, [weekParam]);

  const typesParam = searchParams.get("types");
  const activeTypes = useMemo<Set<string>>(() => {
    if (!typesParam) return new Set(DEADLINE_TYPES);
    return new Set(typesParam.split(",").filter(Boolean));
  }, [typesParam]);

  // --- Navigation ---
  function goToMonth(next: Date) {
    const current = format(startOfMonth(new Date()), "yyyy-MM");
    const value = format(next, "yyyy-MM");
    setParams({ month: value === current ? null : value });
  }

  function goToWeek(next: Date) {
    const ws = startOfWeek(next);
    const currentWs = startOfWeek(new Date());
    const isCurrent =
      format(ws, "yyyy-MM-dd") === format(currentWs, "yyyy-MM-dd");
    setParams({ week: isCurrent ? null : format(ws, "yyyy-MM-dd") });
  }

  function toggleType(type: string) {
    const next = new Set(activeTypes);
    if (next.has(type)) {
      if (next.size === 1) return;
      next.delete(type);
    } else {
      next.add(type);
    }
    const isAll = next.size === DEADLINE_TYPES.length;
    setParams({ types: isAll ? null : [...next].join(",") });
  }

  // --- Data loading ---
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [deadlinesResult, renewalsResult] = await Promise.all([
      supabase
        .from("deadlines")
        .select(
          "id, title, description, deadline_type, due_date, is_completed, completed_at, application_id, opportunity_id, google_calendar_event_id",
        )
        .order("due_date", { ascending: true }),
      supabase
        .from("renewals")
        .select(
          "id, application_id, opportunity_id, reporting_deadline, renewal_window_start, renewal_window_end, opportunities(title)",
        ),
    ]);

    if (deadlinesResult.error) {
      setError("Could not load deadlines.");
      setLoading(false);
      return;
    }
    setDbDeadlines((deadlinesResult.data ?? []) as DbDeadline[]);

    if (!renewalsResult.error && renewalsResult.data) {
      const rows = renewalsResult.data as unknown as RenewalRow[];
      setRenewalItems(rows.flatMap(renewalToItems));
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab !== "compliance") return;
    setComplianceLoading(true);
    fetch("/api/compliance")
      .then((r) => r.json())
      .then((body: { data?: ComplianceItem[] }) => {
        setComplianceItems(body.data ?? []);
      })
      .catch(() => {
        // Leave items empty on failure
      })
      .finally(() => setComplianceLoading(false));
  }, [tab]);

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
        // Leave disconnected on failure
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

  const editable = canEdit(profile?.role);

  // --- Derived data ---
  const allItems = useMemo<DeadlineItem[]>(() => {
    const deadlineItems = dbDeadlines.map(dbDeadlineToItem);
    return [...deadlineItems, ...renewalItems].sort((a, b) =>
      a.due_date.localeCompare(b.due_date),
    );
  }, [dbDeadlines, renewalItems]);

  const visibleItems = useMemo(
    () =>
      allItems.filter((d) => {
        if (!showCompleted && d.is_completed) return false;
        if (!activeTypes.has(d.deadline_type)) return false;
        return true;
      }),
    [allItems, showCompleted, activeTypes],
  );

  const completedCount = useMemo(
    () => dbDeadlines.filter((d) => d.is_completed).length,
    [dbDeadlines],
  );

  // --- Actions ---
  async function syncOne(d: DeadlineItem) {
    if (!editable || syncingId || syncingAll || d.source === "renewal") return;
    setSyncingId(d.id);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/integrations/google/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deadlineId: d.id }),
      });
      const data = (await res.json().catch(() => null)) as {
        eventId?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.eventId) {
        setSyncMessage(data?.error ?? "Could not add this deadline to your calendar.");
        return;
      }
      setDbDeadlines((prev) =>
        prev.map((row) =>
          row.id === d.id
            ? {
                ...row,
                google_calendar_event_id:
                  data.eventId ?? row.google_calendar_event_id,
              }
            : row,
        ),
      );
      setSyncMessage(`Added "${d.title}" to your calendar.`);
    } catch {
      setSyncMessage("Could not reach the server. Please try again.");
    } finally {
      setSyncingId(null);
    }
  }

  async function syncAll() {
    if (!editable || syncingAll) return;
    setSyncingAll(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/integrations/google/calendar", {
        method: "POST",
      });
      const data = (await res.json().catch(() => null)) as {
        created?: number;
        updated?: number;
        errors?: number;
        error?: string;
      } | null;
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
      await load();
    } catch {
      setSyncMessage("Could not reach the server. Please try again.");
    } finally {
      setSyncingAll(false);
    }
  }

  async function toggleAutoSync(next: boolean) {
    if (!profile?.organization_id || autoSyncSaving) return;
    setAutoSync(next);
    setAutoSyncSaving(true);
    const supabase = createClient();
    const { error: upsertError } = await supabase
      .from("platform_config")
      .upsert(
        {
          organization_id: profile.organization_id,
          key: "calendar.auto_sync",
          value: next ? "true" : "false",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,key" },
      );
    if (upsertError) {
      setAutoSync(!next);
      setSyncMessage("Could not save the auto-sync setting.");
    }
    setAutoSyncSaving(false);
  }

  async function toggleComplete(d: DeadlineItem) {
    if (!editable || busyId || d.source === "renewal") return;
    setBusyId(d.id);
    const nextCompleted = !d.is_completed;
    const supabase = createClient();
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
    setDbDeadlines((prev) =>
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

  // --- Render ---
  return (
    <div className="min-h-screen space-y-6 bg-page p-6">
      <PageHeader
        title="Deadlines"
        description="Application, follow-up, reporting, renewal, and document-expiration dates, color-coded by urgency."
        actions={
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
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => setParams({ view: null })}
                aria-pressed={view === "calendar"}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
                  view === "calendar"
                    ? "bg-[#0077B6] text-white"
                    : "text-slate-600 hover:bg-slate-50",
                )}
              >
                <CalendarDays className="h-4 w-4" aria-hidden />
                Month
              </button>
              <button
                type="button"
                onClick={() => setParams({ view: "week" })}
                aria-pressed={view === "week"}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
                  view === "week"
                    ? "bg-[#0077B6] text-white"
                    : "text-slate-600 hover:bg-slate-50",
                )}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
                Week
              </button>
              <button
                type="button"
                onClick={() => setParams({ view: "list" })}
                aria-pressed={view === "list"}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
                  view === "list"
                    ? "bg-[#0077B6] text-white"
                    : "text-slate-600 hover:bg-slate-50",
                )}
              >
                <List className="h-4 w-4" aria-hidden />
                List
              </button>
            </div>
          </div>
        }
      />

      {/* Page tab switcher */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
        <button
          type="button"
          onClick={() => setTab("deadlines")}
          aria-pressed={tab === "deadlines"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
            tab === "deadlines"
              ? "bg-[#0077B6] text-white"
              : "text-slate-600 hover:bg-slate-50",
          )}
        >
          <CalendarDays className="h-4 w-4" aria-hidden />
          Deadlines
        </button>
        <button
          type="button"
          onClick={() => setTab("compliance")}
          aria-pressed={tab === "compliance"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
            tab === "compliance"
              ? "bg-[#0077B6] text-white"
              : "text-slate-600 hover:bg-slate-50",
          )}
        >
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Compliance
        </button>
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

      {tab === "compliance" ? (
        complianceLoading ? (
          <LoadingSpinner center label="Loading compliance obligations..." />
        ) : (
          <ComplianceList items={complianceItems} />
        )
      ) : (
        <>
          {/* Urgency legend + toggles */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <UrgencyLegend />
            <div className="flex flex-wrap items-center gap-4">
              {calendarConnected && editable && (
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={autoSync}
                    disabled={autoSyncSaving}
                    onChange={(e) => void toggleAutoSync(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0077B6] focus:ring-[#0077B6]"
                  />
                  Auto-sync new deadlines
                </label>
              )}
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(e) =>
                    setParams({ completed: e.target.checked ? "1" : null })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-[#0077B6] focus:ring-[#0077B6]"
                />
                Show completed
                {completedCount > 0 && (
                  <span className="text-slate-400">({completedCount})</span>
                )}
              </label>
            </div>
          </div>

          {/* Type filter */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Filter:</span>
            <button
              type="button"
              onClick={() => setParams({ types: null })}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition",
                activeTypes.size === DEADLINE_TYPES.length
                  ? "bg-slate-800 text-white"
                  : "border border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700",
              )}
            >
              All
            </button>
            {DEADLINE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition",
                  activeTypes.has(type)
                    ? "bg-[#0077B6] text-white"
                    : "border border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700",
                )}
              >
                {TYPE_SHORT[type]}
              </button>
            ))}
          </div>

          {/* Content */}
          {loading ? (
            <LoadingSpinner center label="Loading deadlines..." />
          ) : allItems.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No deadlines yet"
              description="Deadlines are created automatically when you add opportunities with dates. They'll appear here on the calendar and in the list."
              action={
                <Link href="/opportunities/new">
                  <Button variant="secondary">Add an opportunity</Button>
                </Link>
              }
            />
          ) : view === "calendar" ? (
            <CalendarGrid
              month={month}
              deadlines={visibleItems}
              onPrev={() => goToMonth(subMonths(month, 1))}
              onNext={() => goToMonth(addMonths(month, 1))}
              onToday={() => goToMonth(startOfMonth(new Date()))}
            />
          ) : view === "week" ? (
            <WeekView
              weekStart={weekStart}
              deadlines={visibleItems}
              onPrevWeek={() => goToWeek(subWeeks(weekStart, 1))}
              onNextWeek={() => goToWeek(addWeeks(weekStart, 1))}
              onToday={() => goToWeek(new Date())}
            />
          ) : (
            <ListView
              deadlines={visibleItems}
              editable={editable}
              busyId={busyId}
              onToggle={toggleComplete}
              calendarConnected={calendarConnected}
              syncingId={syncingId}
              onSync={syncOne}
            />
          )}
        </>
      )}
    </div>
  );
}

const COMPLIANCE_TYPE_LABEL: Record<string, string> = {
  reporting_deadline: "Reporting",
  renewal_reporting: "Renewal Report",
  document_expiration: "Document Expiry",
};

function ComplianceList({ items }: { items: ComplianceItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No compliance obligations"
        description="Reporting deadlines, renewal compliance reports, and expiring documents will appear here."
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 pb-1 text-xs text-slate-500">
        <UrgencyLegend />
      </div>
      <div>
        {items.map((item) => {
          const { band, label } = urgency(item.due_date);
          const bucket = urgencyBucket(band);
          const isCompleted =
            item.status === "completed" || item.status === "complete";
          return (
            <div
              key={item.id}
              className={cn(
                "flex flex-wrap items-center justify-between gap-3",
                isCompleted
                  ? "mb-3 rounded-xl border border-border bg-surface shadow-sm p-4"
                  : URGENCY_ITEM_CLASSES[bucket],
              )}
            >
              <div className="min-w-0">
                <div
                  className={cn(
                    "truncate text-sm font-medium",
                    isCompleted
                      ? "text-slate-400 line-through"
                      : "text-slate-900",
                  )}
                >
                  {item.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <span>
                    {COMPLIANCE_TYPE_LABEL[item.type] ?? item.type}
                  </span>
                  <span>·</span>
                  <span
                    className={
                      isCompleted ? undefined : URGENCY_DATE_CLASSES[bucket]
                    }
                  >
                    {formatDate(item.due_date)}
                  </span>
                  {item.status && item.status !== "pending" && (
                    <>
                      <span>·</span>
                      <span className="capitalize">{humanizeEnum(item.status)}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {isCompleted ? (
                  <span className="text-xs text-slate-400">Completed</span>
                ) : (
                  <Badge variant={BAND_VARIANT[band]} className="shrink-0">
                    {label}
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UrgencyLegend() {
  const items: { bucket: UrgencyBucket; label: string; dot: string }[] = [
    { bucket: "overdue", label: "Overdue", dot: "bg-[#EF4444]" },
    { bucket: "week", label: "Due this week", dot: "bg-[#F59E0B]" },
    { bucket: "future", label: "Future", dot: "bg-slate-400" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
      {items.map((item) => (
        <span key={item.bucket} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", item.dot)} aria-hidden />
          {item.label}
        </span>
      ))}
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
  deadlines: DeadlineItem[];
  editable: boolean;
  busyId: string | null;
  onToggle: (d: DeadlineItem) => void;
  calendarConnected: boolean;
  syncingId: string | null;
  onSync: (d: DeadlineItem) => void;
}) {
  if (deadlines.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface shadow-sm p-4">
        <p className="py-4 text-center text-sm text-slate-500">
          No deadlines to show. Toggle &quot;Show completed&quot; to include
          finished ones, or adjust the type filter.
        </p>
      </div>
    );
  }

  return (
    <div>
      {deadlines.map((d) => {
        const completed = d.is_completed;
        const synced = Boolean(d.google_calendar_event_id);
        const { band, label } = urgency(d.due_date);
        const bucket = urgencyBucket(band);
        const href = parentHref(d);
        const isRenewal = d.source === "renewal";
        return (
          <div
            key={d.id}
            className={cn(
              "flex flex-wrap items-center justify-between gap-3",
              completed
                ? "mb-3 rounded-xl border border-slate-200 bg-white p-4"
                : URGENCY_ITEM_CLASSES[bucket],
            )}
          >
            <div className="min-w-0">
              <div
                className={cn(
                  "truncate text-sm font-medium",
                  completed ? "text-slate-400 line-through" : "text-slate-900",
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
              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                <span>{humanizeEnum(d.deadline_type)}</span>
                <span>·</span>
                <span
                  className={completed ? undefined : URGENCY_DATE_CLASSES[bucket]}
                >
                  {formatDate(d.due_date)}
                </span>
                {isRenewal && <Badge variant="info">Renewal</Badge>}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {completed ? (
                <span className="text-xs text-slate-400">Completed</span>
              ) : (
                <Badge variant={BAND_VARIANT[band]} className="shrink-0">
                  {label}
                </Badge>
              )}
              {calendarConnected &&
                !isRenewal &&
                (synced ? (
                  <span
                    className="inline-flex items-center gap-1 text-xs text-[#0077B6]"
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
              {editable && !isRenewal && (
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
          </div>
        );
      })}
    </div>
  );
}
