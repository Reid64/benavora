"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlarmClock,
  Bell,
  BellOff,
  CalendarClock,
  ChevronRight,
  KanbanSquare,
  Search,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";

import { Button, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import { useAlerts, type Alert } from "@/lib/hooks/useAlerts";
import {
  ALERT_TYPE_LABEL,
  type AlertSeverity,
  type AlertType,
} from "@/lib/alerts/alerts-service";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { formatRelative } from "@/lib/utils/formatters";

// Most-urgent category first. `system` is appended only if present.
const CATEGORY_ORDER: AlertType[] = [
  "deadline_due",
  "application_action",
  "draft_review",
  "new_opportunity",
  "system",
];

const CATEGORY_ICON: Record<AlertType, LucideIcon> = {
  deadline_due: CalendarClock,
  application_action: KanbanSquare,
  draft_review: Wand2,
  new_opportunity: Search,
  system: Bell,
};

const SEVERITY: Record<
  AlertSeverity,
  { accent: string; dot: string }
> = {
  critical: { accent: "border-l-red-500", dot: "bg-red-500" },
  warning: { accent: "border-l-amber-500", dot: "bg-amber-500" },
  info: { accent: "border-l-teal-500", dot: "bg-teal-500" },
};

const SNOOZE_OPTIONS: { label: string; ms: number }[] = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "Tomorrow", ms: 24 * 60 * 60 * 1000 },
  { label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { label: "1 week", ms: 7 * 24 * 60 * 60 * 1000 },
];

/**
 * Alerts (daily action list). Surfaces every active alert generated from live
 * data — deadlines within 7 days, opportunities new since last login,
 * applications needing action, and drafts pending review — grouped by category
 * and ordered by urgency. Each alert links to the record it concerns; every
 * alert can be dismissed or snoozed. Reads/writes are RLS-scoped to the org.
 */
export default function AlertsPage() {
  const { alerts, loading, error, refresh } = useAlerts();
  // Local mirror so dismiss/snooze can update optimistically.
  const [items, setItems] = useState<Alert[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setItems(alerts);
  }, [alerts]);

  async function dismiss(alert: Alert) {
    if (busyId) return;
    setBusyId(alert.id);
    setActionError(null);
    setItems((prev) => prev.filter((a) => a.id !== alert.id));
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("alerts")
      .update({ is_dismissed: true, dismissed_at: new Date().toISOString() })
      .eq("id", alert.id);
    if (updateError) {
      setActionError("Could not dismiss the alert. Please try again.");
      setItems((prev) => [alert, ...prev]); // restore
    } else {
      void refresh();
    }
    setBusyId(null);
  }

  async function snooze(alert: Alert, ms: number) {
    if (busyId) return;
    setBusyId(alert.id);
    setActionError(null);
    setItems((prev) => prev.filter((a) => a.id !== alert.id));
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("alerts")
      .update({ snoozed_until: new Date(Date.now() + ms).toISOString() })
      .eq("id", alert.id);
    if (updateError) {
      setActionError("Could not snooze the alert. Please try again.");
      setItems((prev) => [alert, ...prev]);
    } else {
      void refresh();
    }
    setBusyId(null);
  }

  function markRead(alert: Alert) {
    if (alert.is_read) return;
    setItems((prev) =>
      prev.map((a) => (a.id === alert.id ? { ...a, is_read: true } : a)),
    );
    const supabase = createClient();
    void supabase
      .from("alerts")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", alert.id);
  }

  const visibleCategories = CATEGORY_ORDER.filter((type) =>
    items.some((a) => a.type === type),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Alerts
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Your daily action list — deadlines, new opportunities, applications
            needing action, and drafts pending review. Click any alert to jump
            to it; dismiss or snooze the ones you have handled.
          </p>
        </div>
        {items.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
            <Bell className="h-4 w-4" aria-hidden />
            {items.length} active
          </span>
        )}
      </div>

      {(error || actionError) && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {actionError ?? error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading alerts…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="You're all caught up"
          description="No deadlines, new opportunities, pending drafts, or applications need your attention right now. New alerts will appear here automatically."
        />
      ) : (
        <div className="space-y-6">
          {visibleCategories.map((type) => {
            const group = items.filter((a) => a.type === type);
            const Icon = CATEGORY_ICON[type];
            return (
              <section key={type} className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-navy-700">
                  <Icon className="h-4 w-4 text-navy-400" aria-hidden />
                  {ALERT_TYPE_LABEL[type]}
                  <span className="text-navy-400">({group.length})</span>
                </div>
                <Card noPadding>
                  <ul className="divide-y divide-navy-100">
                    {group.map((alert) => (
                      <AlertRow
                        key={alert.id}
                        alert={alert}
                        busy={busyId === alert.id}
                        onDismiss={() => dismiss(alert)}
                        onSnooze={(ms) => snooze(alert, ms)}
                        onOpen={() => markRead(alert)}
                      />
                    ))}
                  </ul>
                </Card>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AlertRow({
  alert,
  busy,
  onDismiss,
  onSnooze,
  onOpen,
}: {
  alert: Alert;
  busy: boolean;
  onDismiss: () => void;
  onSnooze: (ms: number) => void;
  onOpen: () => void;
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const styles = SEVERITY[alert.severity];

  // Close the snooze menu on an outside click.
  useEffect(() => {
    if (!snoozeOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSnoozeOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [snoozeOpen]);

  const message = (
    <div className="flex min-w-0 items-start gap-3">
      <span
        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", styles.dot)}
        aria-hidden
      />
      <div className="min-w-0">
        <p
          className={cn(
            "truncate text-sm",
            alert.is_read ? "text-navy-600" : "font-semibold text-navy-900",
          )}
        >
          {alert.message}
        </p>
        <p className="mt-0.5 text-xs text-navy-400">
          {formatRelative(alert.created_at)}
        </p>
      </div>
    </div>
  );

  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-l-4 px-5 py-3",
        styles.accent,
      )}
    >
      {alert.link ? (
        <Link
          href={alert.link}
          onClick={onOpen}
          className="group min-w-0 flex-1 rounded-md transition hover:opacity-90"
        >
          <span className="flex items-center gap-2">
            {message}
            <ChevronRight
              className="h-4 w-4 shrink-0 text-navy-300 transition group-hover:text-navy-500"
              aria-hidden
            />
          </span>
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{message}</div>
      )}

      <div className="flex items-center gap-1.5">
        <div className="relative" ref={menuRef}>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setSnoozeOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={snoozeOpen}
          >
            <AlarmClock className="h-4 w-4" aria-hidden />
            Snooze
          </Button>
          {snoozeOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-10 mt-1 w-36 overflow-hidden rounded-lg border border-navy-200 bg-white py-1 shadow-lg"
            >
              {SNOOZE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSnoozeOpen(false);
                    onSnooze(opt.ms);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm text-navy-700 transition hover:bg-navy-50"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onDismiss}
          aria-label="Dismiss alert"
        >
          <X className="h-4 w-4" aria-hidden />
          Dismiss
        </Button>
      </div>
    </li>
  );
}
