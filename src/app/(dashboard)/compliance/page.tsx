"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Plus, ShieldCheck, XCircle } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Button,
  EmptyState,
  Input,
  LoadingSpinner,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import { urgency } from "@/components/deadlines/DeadlinePill";
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

// Applications & Pipeline section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
// Frame: Deep Navy (cards/panels). Secondary accent: Teal (links, outline
// buttons). Real semantic status colors (GREEN/AMBER/RED below) are never
// touched by this system.
const FRAME_NAVY = "#101B2D";
const ACCENT_TEAL = "#2E6B66";
const CARD = "#F8F5EE";
const CARD_BORDER = "rgba(16,27,45,0.18)";
const ON_FRAME_TEXT = "#F8F5EE";
const TEXT_PRIMARY = FRAME_NAVY;
const TEXT_MUTED = "rgba(16,27,45,0.55)";
const ACCENT = ACCENT_TEAL;
const GREEN = "#15803D";
const AMBER = "#B45309";
const RED = "#B91C1C";
const SHADOW = "0 4px 20px rgba(16,27,45,0.22)";

const EVENT_TYPE_TINT: Record<ComplianceEvent["event_type"], { bg: string; text: string }> = {
  report: { bg: "#E0F2FE", text: "#0369A1" },
  audit: { bg: "#FEF3C7", text: AMBER },
  renewal: { bg: "#DCFCE7", text: GREEN },
  meeting: { bg: "#F1F5F9", text: "#475569" },
};

type StatusColor = "red" | "amber" | "green";

function statusColorFor(dueDate: string): StatusColor {
  const { band } = urgency(dueDate);
  if (band === "overdue") return "red";
  if (band === "green") return "green";
  return "amber";
}

const STATUS_HEX: Record<StatusColor, string> = { red: RED, amber: AMBER, green: "#0F766E" };
const STATUS_BG: Record<StatusColor, string> = { red: "#FEF2F2", amber: "#FFFBEB", green: CARD };
const STATUS_BORDER: Record<StatusColor, string> = { red: "#EF4444", amber: "#F59E0B", green: "#E2E8F0" };
const STATUS_LABEL: Record<StatusColor, string> = { red: "Overdue", amber: "Due Soon", green: "On Track" };

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
 * An overall compliance score is computed live from real completion state
 * — never a placeholder.
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

  const groupedRequirements = useMemo(() => {
    const groups = new Map<string, ComplianceItem[]>();
    for (const item of items) {
      const key = item.type;
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).map(([key, list]) => ({
      key,
      label: humanizeEnum(key),
      items: list,
    }));
  }, [items]);

  // Overall compliance score: share of tracked obligations (events + requirements)
  // that are resolved (completed/submitted), computed live from real records.
  const score = useMemo(() => {
    const totalEvents = events.length;
    const doneEvents = events.filter((e) => Boolean(e.completed_at)).length;
    const totalItems = items.length;
    const doneItems = items.filter(
      (i) => i.status === "submitted" || i.status === "completed",
    ).length;
    const total = totalEvents + totalItems;
    if (total === 0) return null;
    return Math.round(((doneEvents + doneItems) / total) * 100);
  }, [events, items]);

  const showEmpty = !loading && !error && items.length === 0;
  const showEventsEmpty = !eventsLoading && !eventsError && events.length === 0;

  return (
    <div style={{ minHeight: "100vh" }} className="space-y-8 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          accent={FRAME_NAVY}
          title="Compliance Calendar"
          description="Reports, audits, renewals, and meetings tracked across all active grants, plus reporting deadlines, matching funds, regulatory filings, and document expirations."
          actions={
            editable && (
              <Button
                variant="ghost"
                onClick={() => setCreatingEvent(true)}
                style={{
                  border: "none",
                  backgroundColor: ACCENT_TEAL,
                  color: ON_FRAME_TEXT,
                  boxShadow: "0 2px 8px rgba(16,27,45,0.25)",
                }}
              >
                <CalendarClock className="h-4 w-4" aria-hidden />
                New Event
              </Button>
            )
          }
        />
        {score !== null && <ScoreBadge score={score} />}
      </div>

      <section className="space-y-3">
        {eventsError && (
          <div
            role="alert"
            style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: RED }}
            className="rounded-lg px-4 py-3 text-sm"
          >
            {eventsError}
          </div>
        )}

        {eventsLoading ? (
          <LoadingSpinner center label="Loading compliance events..." />
        ) : showEventsEmpty ? (
          <div style={{ backgroundColor: FRAME_NAVY, borderRadius: "16px", boxShadow: SHADOW, padding: "4px" }}>
            <div
              style={{ backgroundColor: CARD, borderRadius: "13px", boxShadow: "inset 0 1px 2px rgba(16,27,45,0.06)" }}
              className="p-10"
            >
              <EmptyState
                icon={CalendarClock}
                title="No compliance events"
                description="Reports, audits, renewals, and meetings you schedule will appear here, grouped by month."
                action={
                  editable ? (
                    <Button
                      variant="ghost"
                      onClick={() => setCreatingEvent(true)}
                      style={{ border: "none", backgroundColor: ACCENT_TEAL, color: ON_FRAME_TEXT }}
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      New Event
                    </Button>
                  ) : undefined
                }
              />
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {groupedEvents.map((group) => (
              <div
                key={group.key}
                style={{ backgroundColor: FRAME_NAVY, borderRadius: "16px", boxShadow: SHADOW, padding: "4px" }}
              >
              <div
                style={{ backgroundColor: CARD, borderRadius: "13px", boxShadow: "inset 0 1px 2px rgba(16,27,45,0.06)" }}
                className="overflow-hidden"
              >
                <div style={{ borderBottom: "1px solid rgba(16,27,45,0.1)" }} className="px-6 py-4">
                  <h2 style={{ color: TEXT_PRIMARY }} className="text-sm font-semibold">
                    {group.label}
                  </h2>
                </div>
                <ul>
                  {group.events.map((event, idx) => {
                    const isComplete = Boolean(event.completed_at);
                    const status: StatusColor = isComplete
                      ? "green"
                      : statusColorFor(event.due_date);
                    const tint = EVENT_TYPE_TINT[event.event_type];
                    return (
                      <li
                        key={event.id}
                        style={{
                          borderBottom:
                            idx === group.events.length - 1 ? "none" : "1px solid #F1F5F9",
                        }}
                        className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <ChecklistStatusIcon complete={isComplete} status={status} />
                          <div className="min-w-0">
                            <div
                              style={{ color: isComplete ? TEXT_MUTED : TEXT_PRIMARY }}
                              className={`truncate text-sm font-medium ${isComplete ? "line-through" : ""}`}
                            >
                              {event.title}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                              <span
                                style={{ backgroundColor: tint.bg, color: tint.text }}
                                className="inline-flex items-center rounded-full px-2 py-0.5 font-semibold"
                              >
                                {humanizeEnum(event.event_type)}
                              </span>
                              <span style={{ color: STATUS_HEX[status] }} className="font-semibold">
                                {formatDate(event.due_date)}
                              </span>
                              {event.recurrence && (
                                <span style={{ color: TEXT_MUTED }}>{humanizeEnum(event.recurrence)}</span>
                              )}
                              {event.application_id && (
                                <Link
                                  href={`/applications/${event.application_id}`}
                                  style={{ color: ACCENT }}
                                  className="hover:underline"
                                >
                                  {event.application_title ?? "View application"}
                                </Link>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {!isComplete && (
                            <span style={{ color: STATUS_HEX[status] }} className="text-xs font-semibold">
                              {STATUS_LABEL[status]}
                            </span>
                          )}
                          {editable && !isComplete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={completingId === event.id}
                              isLoading={completingId === event.id}
                              onClick={() => markEventComplete(event)}
                              style={{
                                border: `1.5px solid ${ACCENT_TEAL}`,
                                backgroundColor: "rgba(46,107,102,0.08)",
                                color: ACCENT_TEAL,
                              }}
                            >
                              Mark Complete
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 style={{ color: TEXT_PRIMARY }} className="text-sm font-semibold">
            Other Tracked Requirements
          </h2>
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCreating(true)}
              style={{ border: `1px solid ${CARD_BORDER}`, backgroundColor: CARD, color: FRAME_NAVY }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add Requirement
            </Button>
          )}
        </div>

        {error && (
          <div
            role="alert"
            style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: RED }}
            className="rounded-lg px-4 py-3 text-sm"
          >
            {error}
          </div>
        )}

        {loading ? (
          <LoadingSpinner center label="Loading compliance obligations..." />
        ) : showEmpty ? (
          <div style={{ backgroundColor: FRAME_NAVY, borderRadius: "16px", boxShadow: SHADOW, padding: "4px" }}>
            <div
              style={{ backgroundColor: CARD, borderRadius: "13px", boxShadow: "inset 0 1px 2px rgba(16,27,45,0.06)" }}
              className="p-10"
            >
              <EmptyState
                icon={ShieldCheck}
                title="No compliance obligations"
                description="Reporting deadlines, renewal compliance reports, document expirations, and manually tracked requirements will appear here."
                action={
                  editable ? (
                    <Button
                      variant="ghost"
                      onClick={() => setCreating(true)}
                      style={{ border: "none", backgroundColor: ACCENT_TEAL, color: ON_FRAME_TEXT }}
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      Add Requirement
                    </Button>
                  ) : undefined
                }
              />
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {groupedRequirements.map((group) => (
              <div
                key={group.key}
                style={{ backgroundColor: FRAME_NAVY, borderRadius: "16px", boxShadow: SHADOW, padding: "4px" }}
              >
              <div
                style={{ backgroundColor: CARD, borderRadius: "13px", boxShadow: "inset 0 1px 2px rgba(16,27,45,0.06)" }}
                className="overflow-hidden"
              >
                <div style={{ borderBottom: "1px solid rgba(16,27,45,0.1)" }} className="px-6 py-4">
                  <h3 style={{ color: TEXT_PRIMARY }} className="text-sm font-semibold">
                    {group.label}
                  </h3>
                </div>
                <ul>
                  {group.items.map((item, idx) => {
                    const isSubmitted = item.status === "submitted" || item.status === "completed";
                    const status: StatusColor = isSubmitted ? "green" : statusColorFor(item.due_date);
                    const canMarkSubmitted =
                      editable && item.entity_type === "requirement" && !isSubmitted;
                    return (
                      <li
                        key={item.id}
                        style={{
                          borderBottom: idx === group.items.length - 1 ? "none" : "1px solid #F1F5F9",
                        }}
                        className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <ChecklistStatusIcon complete={isSubmitted} status={status} />
                          <div className="min-w-0">
                            <div
                              style={{ color: isSubmitted ? TEXT_MUTED : TEXT_PRIMARY }}
                              className={`truncate text-sm font-medium ${isSubmitted ? "line-through" : ""}`}
                            >
                              {item.title}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                              <span
                                style={{ color: isSubmitted ? TEXT_MUTED : STATUS_HEX[status] }}
                                className="font-semibold"
                              >
                                {formatDate(item.due_date)}
                              </span>
                              {item.notes && (
                                <span style={{ color: TEXT_MUTED }} className="truncate">
                                  {item.notes}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {isSubmitted ? (
                            <span style={{ color: TEXT_MUTED }} className="text-xs">
                              {item.status === "submitted" ? "Submitted" : "Completed"}
                            </span>
                          ) : (
                            <span style={{ color: STATUS_HEX[status] }} className="text-xs font-semibold">
                              {STATUS_LABEL[status]}
                            </span>
                          )}
                          {canMarkSubmitted && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={submittingId === item.entity_id}
                              isLoading={submittingId === item.entity_id}
                              onClick={() => markSubmitted(item)}
                              style={{
                                border: `1.5px solid ${ACCENT_TEAL}`,
                                backgroundColor: "rgba(46,107,102,0.08)",
                                color: ACCENT_TEAL,
                              }}
                            >
                              Mark Submitted
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              </div>
            ))}
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

/** Overall compliance score badge: green/amber/red circular pill driven by real completion data. */
function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? GREEN : score >= 50 ? AMBER : RED;
  const bg = score >= 80 ? "#DCFCE7" : score >= 50 ? "#FEF3C7" : "#FEE2E2";
  const ring = score >= 80 ? "#BBF7D0" : score >= 50 ? "#FDE68A" : "#FECACA";
  return (
    <div style={{ backgroundColor: FRAME_NAVY, borderRadius: "16px", boxShadow: SHADOW, padding: "4px" }}>
    <div
      style={{ backgroundColor: CARD, borderRadius: "13px", boxShadow: "inset 0 1px 2px rgba(16,27,45,0.06)" }}
      className="flex items-center gap-4 px-5 py-4"
    >
      <div
        style={{ backgroundColor: bg, border: `3px solid ${ring}`, color }}
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-black"
      >
        {score}%
      </div>
      <div>
        <div style={{ color: TEXT_MUTED }} className="text-xs font-bold uppercase tracking-wide">
          Compliance Score
        </div>
        <div style={{ color }} className="text-sm font-semibold">
          {score >= 80 ? "On Track" : score >= 50 ? "Needs Attention" : "At Risk"}
        </div>
      </div>
    </div>
    </div>
  );
}

function ChecklistStatusIcon({ complete, status }: { complete: boolean; status: StatusColor }) {
  if (complete) {
    return <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: GREEN }} aria-hidden />;
  }
  if (status === "red") {
    return <XCircle className="h-5 w-5 shrink-0" style={{ color: RED }} aria-hidden />;
  }
  return (
    <span
      style={{
        backgroundColor: STATUS_BG[status],
        border: `2px solid ${STATUS_BORDER[status]}`,
      }}
      className="h-5 w-5 shrink-0 rounded-full"
      aria-hidden
    />
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
          style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: RED }}
          className="rounded-lg px-3 py-2 text-sm"
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

      <div style={{ borderTop: "1px solid #E2E8F0" }} className="flex justify-end gap-2 pt-4">
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
          style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: RED }}
          className="rounded-lg px-3 py-2 text-sm"
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

      <div style={{ borderTop: "1px solid #E2E8F0" }} className="flex justify-end gap-2 pt-4">
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
