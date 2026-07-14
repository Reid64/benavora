"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlarmClock,
  Bell,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FileWarning,
  Mail,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";

import { Badge, Button, LoadingSpinner } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAlerts, type Alert } from "@/lib/hooks/useAlerts";
import { type AlertSeverity, type AlertType } from "@/lib/alerts/alerts-service";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { formatRelative } from "@/lib/utils/formatters";

type FilterType = "all" | "unread" | "urgent" | "snoozed";

interface DisplayCategory {
  key: string;
  label: string;
  Icon: LucideIcon;
  description: string;
  types: AlertType[];
}

const DISPLAY_CATEGORIES: DisplayCategory[] = [
  {
    key: "deadline",
    label: "Deadline Alerts",
    Icon: Calendar,
    description:
      "Application deadlines, follow-up dates, and reporting deadlines approaching or overdue.",
    types: ["deadline_due"],
  },
  {
    key: "opportunity",
    label: "New Opportunities",
    Icon: Search,
    description:
      "Recently discovered opportunities matching your search profile and eligibility criteria.",
    types: ["new_opportunity"],
  },
  {
    key: "submission",
    label: "Submission Results",
    Icon: CheckCircle,
    description:
      "AutoApply submission confirmations, failures, and items needing attention.",
    types: ["application_action", "draft_review"],
  },
  {
    key: "email",
    label: "Email Responses",
    Icon: Mail,
    description:
      "Funder replies detected in synced email threads requiring follow-up.",
    types: [],
  },
  {
    key: "document",
    label: "Document Alerts",
    Icon: FileWarning,
    description:
      "Documents expiring soon or missing from pending applications.",
    types: [],
  },
  {
    key: "system",
    label: "System Notices",
    Icon: Bell,
    description:
      "Agent run results, usage limit warnings, and platform updates.",
    types: ["system"],
  },
];

const FILTERS: { key: FilterType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "urgent", label: "Urgent" },
  { key: "snoozed", label: "Snoozed" },
];

const SEVERITY: Record<AlertSeverity, { accent: string }> = {
  critical: { accent: "border-l-4 border-[#EF4444]" },
  warning: { accent: "border-l-4 border-[#F59E0B]" },
  info: { accent: "border-l-4 border-[#0077B6]" },
};

const SNOOZE_OPTIONS: { label: string; ms: number }[] = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "Tomorrow", ms: 24 * 60 * 60 * 1000 },
  { label: "3 days", ms: 3 * 24 * 60 * 60 * 1000 },
  { label: "1 week", ms: 7 * 24 * 60 * 60 * 1000 },
];

export default function AlertsPage() {
  const { alerts, loading, error, refresh } = useAlerts();
  const [items, setItems] = useState<Alert[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setItems(alerts);
  }, [alerts]);

  function toggleCollapsed(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const filteredItems = items.filter((a) => {
    if (filter === "unread") return !a.is_read;
    if (filter === "urgent") return a.severity === "critical";
    return true;
  });

  const unreadCount = items.filter((a) => !a.is_read).length;

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
      setItems((prev) => [alert, ...prev]);
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

  async function markAllRead() {
    const unread = items.filter((a) => !a.is_read);
    if (unread.length === 0) return;
    setItems((prev) => prev.map((a) => ({ ...a, is_read: true })));
    const supabase = createClient();
    await supabase
      .from("alerts")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .in(
        "id",
        unread.map((a) => a.id),
      );
  }

  return (
    <div className="min-h-screen space-y-6 bg-page p-6">
      <PageHeader
        title="Alerts"
        description="Your daily action list — deadlines, new opportunities, applications needing action, and drafts pending review."
        actions={
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <Badge variant="error">
                <Bell className="h-4 w-4" aria-hidden />
                {unreadCount} unread
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllRead}
              disabled={unreadCount === 0}
            >
              Mark all read
            </Button>
          </div>
        }
      />

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium transition",
              filter === f.key
                ? "bg-[#0077B6] text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:border-[#0077B6] hover:text-[#0077B6]",
            )}
          >
            {f.label}
          </button>
        ))}
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
        <LoadingSpinner center label="Loading alerts..." />
      ) : (
        <div className="space-y-4">
          {DISPLAY_CATEGORIES.map((cat) => {
            const catItems = filteredItems.filter((a) =>
              (cat.types as string[]).includes(a.type),
            );
            const isCollapsed = collapsed[cat.key] ?? false;
            const { Icon } = cat;

            return (
              <section key={cat.key}>
                <button
                  type="button"
                  onClick={() => toggleCollapsed(cat.key)}
                  className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left transition hover:bg-slate-100"
                >
                  <Icon
                    className="h-4 w-4 shrink-0 text-slate-400"
                    aria-hidden
                  />
                  <span className="flex-1 text-sm font-semibold text-slate-700">
                    {cat.label}
                  </span>
                  {catItems.length > 0 && (
                    <Badge variant="neutral">{catItems.length}</Badge>
                  )}
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-slate-400 transition-transform duration-150",
                      isCollapsed && "-rotate-90",
                    )}
                    aria-hidden
                  />
                </button>

                {!isCollapsed && (
                  <div className="mt-1">
                    {catItems.length === 0 ? (
                      <div className="rounded-xl border border-border bg-surface shadow-sm px-5 py-6 text-center">
                        <p className="text-sm text-slate-500">
                          {cat.description}
                        </p>
                        <p className="mt-2 text-xs text-slate-400">
                          No alerts in this category.
                        </p>
                      </div>
                    ) : (
                      <ul>
                        {catItems.map((alert) => (
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
                    )}
                  </div>
                )}
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
    <div className="min-w-0">
      <p
        className={cn(
          "truncate text-sm",
          alert.is_read ? "text-slate-600" : "font-semibold text-slate-900",
        )}
      >
        {alert.message}
      </p>
      <p className="mt-0.5 text-xs text-slate-400">
        {formatRelative(alert.created_at)}
      </p>
    </div>
  );

  return (
    <li
      className={cn(
        "mb-3 flex items-start gap-4 rounded-xl border border-slate-200 p-4 transition-shadow hover:shadow-sm",
        alert.is_read ? "bg-white" : "bg-[#EFF6FF]",
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
              className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-slate-500"
              aria-hidden
            />
          </span>
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{message}</div>
      )}

      <div className="flex shrink-0 items-center gap-3">
        {!alert.is_read && (
          <button
            type="button"
            onClick={onOpen}
            className="text-xs font-medium text-[#0077B6] hover:underline"
          >
            Mark as read
          </button>
        )}
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
              className="absolute right-0 top-full z-10 mt-1 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
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
                  className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
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
