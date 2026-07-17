"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { CalendarClock, Plus, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingSpinner,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { cn } from "@/lib/utils/cn";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import { BAND_VARIANT, urgency } from "@/components/deadlines/DeadlinePill";
import type { ComplianceItem } from "@/app/api/compliance/route";
import type { ComplianceEvent } from "@/app/api/compliance/events/route";

const REQUIREMENT_TYPE_OPTIONS = [
  { value: "reporting", label: "Reporting" },
  { value: "spending_restriction", label: "Spending Restriction" },
  { value: "matching_fund", label: "Matching Fund" },
  { value: "regulatory", label: "Regulatory Filing" },
];

const EVENT_TYPE_OPTIONS = [
  { value: "report", label: "Report" },
  { value: "audit", label: "Audit" },
  { value: "renewal", label: "Renewal" },
  { value: "meeting", label: "Meeting" },
];

const RECURRENCE_OPTIONS = [
  { value: "", label: "One-time (no recurrence)" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
];

const EVENT_TYPE_BADGE_VARIANT: Record<ComplianceEvent["event_type"], "info" | "warning" | "success" | "neutral"> = {
  report: "info",
  audit: "warning",
  renewal: "success",
  meeting: "neutral",
};

type UrgencyColor = "red" | "amber" | "green";

function urgencyColor(dueDate: string): UrgencyColor {
  const { band } = urgency(dueDate);
  if (band === "overdue") return "red";
  if (band === "green") return "green";
  return "amber";
}

const ITEM_CLASSES: Record<UrgencyColor, string> = {
  red: "bg-[#FEF2F2] border-l-4 border-[#EF4444] rounded-xl p-4",
  amber: "bg-[#FFFBEB] border-l-4 border-[#F59E0B] rounded-xl p-4",
  green: "bg-white shadow-sm border border-border rounded-xl p-4",
};

const DATE_CLASSES: Record<UrgencyColor, string> = {
  red: "text-[#EF4444] font-bold",
  amber: "text-[#F59E0B] font-bold",
  green: "text-slate-500",
};

type EventColor = "red" | "amber" | "blue" | "green";

function eventColor(event: ComplianceEvent): EventColor {
  if (event.completed_at) return "green";
  const dueMs = new Date(event.due_date).getTime();
  const daysUntil = (dueMs - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysUntil < 0) return "red";
  if (daysUntil <= 7) return "amber";
  return "blue";
}

const EVENT_ITEM_CLASSES: Record<EventColor, string> = {
  red: "bg-[#FEF2F2] border-l-4 border-[#EF4444] rounded-xl p-4",
  amber: "bg-[#FFFBEB] border-l-4 border-[#F59E0B] rounded-xl p-4",
  blue: "bg-[#EFF6FF] border-l-4 border-[#0077B6] rounded-xl p-4",
  green: "bg-[#F0FDF4] border-l-4 border-[#10B981] rounded-xl p-4",
};

const EVENT_DATE_CLASSES: Record<EventColor, string> = {
  red: "text-[#EF4444] font-bold",
  amber: "text-[#F59E0B] font-bold",
  blue: "text-[#0077B6] font-medium",
  green: "text-[#10B981]",
};

const EVENT_LABEL: Record<EventColor, string> = {
  red: "Overdue",
  amber: "Due this week",
  blue: "Upcoming",
  green: "Complete",
};

function monthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/**
 * Compliance calendar: compliance_events (reports, audits, renewals,
 * meetings) grouped by month, plus manually tracked obligations
 * (matching funds, regulatory filings) from compliance_requirements and
 * deadlines/renewals/document expirations aggregated via /api/compliance.
 */
export default function CompliancePage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const [events, setEvents] = useState<ComplianceEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/compliance");
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { data: ComplianceItem[] };
      setItems(data.data ?? []);
    } catch {
      setError("Could not load compliance obligations.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const res = await fetch("/api/compliance/events");
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { data: ComplianceEvent[] };
      setEvents(data.data ?? []);
    } catch {
      setEventsError("Could not load compliance events.");
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadEvents();
  }, [load, loadEvents]);

  async function markSubmitted(item: ComplianceItem) {
    if (!editable || submittingId) return;
    setSubmittingId(item.id);
    try {
      const res = await fetch("/api/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.entity_id, status: "submitted" }),
      });
      if (!res.ok) {
        setError("Could not mark the requirement submitted.");
        return;
      }
      await load();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmittingId(null);
    }
  }

  async function markEventComplete(event: ComplianceEvent) {
    if (!editable || completingId) return;
    setCompletingId(event.id);
    try {
      const res = await fetch(`/api/compliance/events/${event.id}`, { method: "PATCH" });
      if (!res.ok) {
        setEventsError("Could not mark the event complete.");
        return;
      }
      await loadEvents();
    } catch {
      setEventsError("Could not reach the server. Please try again.");
    } finally {
      setCompletingId(null);
    }
  }

  const groupedEvents = useMemo(() => {
    const groups = new Map<string, ComplianceEvent[]>();
    for (const event of events) {
      const key = monthKey(event.due_date);
      const list = groups.get(key) ?? [];
      list.push(event);
      groups.set(key, list);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, list]) => ({ key, label: monthLabel(key), events: list }));
  }, [events]);

  const showEmpty = !loading && !error && items.length === 0;
  const showEventsEmpty = !eventsLoading && !eventsError && events.length === 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Compliance Calendar"
        description="Reports, audits, renewals, and meetings tracked across all active grants, plus reporting deadlines, matching funds, regulatory filings, and document expirations."
        actions={
          editable && (
            <Button onClick={() => setCreatingEvent(true)}>
              <CalendarClock className="h-4 w-4" aria-hidden />
              New Event
            </Button>
          )
        }
      />

      <section className="space-y-3">
        {eventsError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {eventsError}
          </div>
        )}

        {eventsLoading ? (
          <LoadingSpinner center label="Loading compliance events..." />
        ) : showEventsEmpty ? (
          <EmptyState
            icon={CalendarClock}
            title="No compliance events"
            description="Reports, audits, renewals, and meetings you schedule will appear here, grouped by month."
            action={
              editable ? (
                <Button onClick={() => setCreatingEvent(true)}>
                  <Plus className="h-4 w-4" aria-hidden />
                  New Event
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-6">
            {groupedEvents.map((group) => (
              <div key={group.key}>
                <h2 className="mb-2 text-sm font-semibold text-slate-900">{group.label}</h2>
                <div className="space-y-3">
                  {group.events.map((event) => {
                    const color = eventColor(event);
                    const isComplete = Boolean(event.completed_at);
                    return (
                      <div
                        key={event.id}
                        className={cn(
                          "flex flex-wrap items-center justify-between gap-3",
                          EVENT_ITEM_CLASSES[color],
                        )}
                      >
                        <div className="min-w-0">
                          <div
                            className={cn(
                              "truncate text-sm font-medium",
                              isComplete ? "text-slate-400 line-through" : "text-slate-900",
                            )}
                          >
                            {event.title}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <Badge variant={EVENT_TYPE_BADGE_VARIANT[event.event_type]}>
                              {humanizeEnum(event.event_type)}
                            </Badge>
                            <span>·</span>
                            <span className={EVENT_DATE_CLASSES[color]}>{formatDate(event.due_date)}</span>
                            {event.recurrence && (
                              <>
                                <span>·</span>
                                <span>{humanizeEnum(event.recurrence)}</span>
                              </>
                            )}
                            {event.application_id && (
                              <>
                                <span>·</span>
                                <Link
                                  href={`/applications/${event.application_id}`}
                                  className="text-[#0077B6] hover:underline"
                                >
                                  {event.application_title ?? "View application"}
                                </Link>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span
                            className={cn(
                              "text-xs",
                              color === "blue" || color === "green" ? EVENT_DATE_CLASSES[color] : "text-slate-500",
                            )}
                          >
                            {EVENT_LABEL[color]}
                          </span>
                          {editable && !isComplete && (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={completingId === event.id}
                              isLoading={completingId === event.id}
                              onClick={() => markEventComplete(event)}
                            >
                              Mark Complete
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Other Tracked Requirements</h2>
          {editable && (
            <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Add Requirement
            </Button>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {loading ? (
          <LoadingSpinner center label="Loading compliance obligations..." />
        ) : showEmpty ? (
          <EmptyState
            icon={ShieldCheck}
            title="No compliance obligations"
            description="Reporting deadlines, renewal compliance reports, document expirations, and manually tracked requirements will appear here."
            action={
              editable ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Add Requirement
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const isSubmitted = item.status === "submitted" || item.status === "completed";
              const color = urgencyColor(item.due_date);
              const { label } = urgency(item.due_date);
              const canMarkSubmitted =
                editable && item.entity_type === "requirement" && !isSubmitted;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3",
                    isSubmitted
                      ? "rounded-xl border border-border bg-white p-4 shadow-sm"
                      : ITEM_CLASSES[color],
                  )}
                >
                  <div className="min-w-0">
                    <div
                      className={cn(
                        "truncate text-sm font-medium",
                        isSubmitted ? "text-slate-400 line-through" : "text-slate-900",
                      )}
                    >
                      {item.title}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{humanizeEnum(item.type)}</span>
                      <span>·</span>
                      <span className={isSubmitted ? undefined : DATE_CLASSES[color]}>
                        {formatDate(item.due_date)}
                      </span>
                      {item.notes && (
                        <>
                          <span>·</span>
                          <span className="truncate">{item.notes}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {isSubmitted ? (
                      <span className="text-xs text-slate-400">
                        {item.status === "submitted" ? "Submitted" : "Completed"}
                      </span>
                    ) : (
                      <Badge variant={BAND_VARIANT[urgency(item.due_date).band]}>{label}</Badge>
                    )}
                    {canMarkSubmitted && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={submittingId === item.entity_id}
                        isLoading={submittingId === item.entity_id}
                        onClick={() => markSubmitted(item)}
                      >
                        Mark Submitted
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Modal isOpen={creating} onClose={() => setCreating(false)} title="Add Requirement">
        <RequirementForm
          onCancel={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      </Modal>

      <Modal isOpen={creatingEvent} onClose={() => setCreatingEvent(false)} title="New Compliance Event">
        <EventForm
          onCancel={() => setCreatingEvent(false)}
          onSaved={async () => {
            setCreatingEvent(false);
            await loadEvents();
          }}
        />
      </Modal>
    </div>
  );
}

function RequirementForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [requirementType, setRequirementType] = useState(REQUIREMENT_TYPE_OPTIONS[0]!.value);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim() === "") {
      setError("Title is required.");
      return;
    }
    if (dueDate.trim() === "") {
      setError("Due date is required.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await fetch("/api/compliance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        requirement_type: requirementType,
        due_date: dueDate,
        notes: notes.trim(),
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not save the requirement.");
      setSaving(false);
      return;
    }

    setSaving(false);
    await onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <Input
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Q3 matching fund verification"
        required
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Requirement type"
          value={requirementType}
          options={REQUIREMENT_TYPE_OPTIONS}
          onChange={(e) => setRequirementType(e.target.value)}
          required
        />
        <Input
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          required
        />
      </div>

      <Textarea
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional detail about this obligation"
        rows={3}
      />

      <div className="flex justify-end gap-2 border-t border-navy-200 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" isLoading={saving}>
          Add requirement
        </Button>
      </div>
    </form>
  );
}

function EventForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState(EVENT_TYPE_OPTIONS[0]!.value);
  const [dueDate, setDueDate] = useState("");
  const [recurrence, setRecurrence] = useState(RECURRENCE_OPTIONS[0]!.value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim() === "") {
      setError("Title is required.");
      return;
    }
    if (dueDate.trim() === "") {
      setError("Due date is required.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await fetch("/api/compliance/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        event_type: eventType,
        due_date: dueDate,
        recurrence: recurrence || null,
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not save the event.");
      setSaving(false);
      return;
    }

    setSaving(false);
    await onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <Input
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Annual programmatic audit"
        required
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Event type"
          value={eventType}
          options={EVENT_TYPE_OPTIONS}
          onChange={(e) => setEventType(e.target.value)}
          required
        />
        <Input
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          required
        />
      </div>

      <Select
        label="Recurrence"
        value={recurrence}
        options={RECURRENCE_OPTIONS}
        onChange={(e) => setRecurrence(e.target.value)}
      />

      <div className="flex justify-end gap-2 border-t border-navy-200 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" isLoading={saving}>
          Add event
        </Button>
      </div>
    </form>
  );
}
