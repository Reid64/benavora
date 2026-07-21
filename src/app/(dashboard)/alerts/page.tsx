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

import { Button, LoadingSpinner } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAlerts, type Alert } from "@/lib/hooks/useAlerts";
import { type AlertSeverity, type AlertType } from "@/lib/alerts/alerts-service";
import { createClient } from "@/lib/supabase/client";
import { formatRelative } from "@/lib/utils/formatters";

type FilterType = "all" | "unread" | "urgent" | "snoozed";

interface DisplayCategory {
  key: string;
  label: string;
  Icon: LucideIcon;
  description: string;
  types: AlertType[];
  dot: string;
}

const CANVAS = "#D6E4F0";
const CARD = "#FFFFFF";
const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";
const ACCENT = "#0077B6";
const SHADOW = "0 4px 20px rgba(0,0,0,0.08)";

const DISPLAY_CATEGORIES: DisplayCategory[] = [
  {
    key: "deadline",
    label: "Deadline Alerts",
    Icon: Calendar,
    description:
      "Application deadlines, follow-up dates, and reporting deadlines approaching or overdue.",
    types: ["deadline_due"],
    dot: "#0077B6",
  },
  {
    key: "opportunity",
    label: "New Opportunities",
    Icon: Search,
    description:
      "Recently discovered opportunities matching your search profile and eligibility criteria.",
    types: ["new_opportunity"],
    dot: "#6B48CC",
  },
  {
    key: "submission",
    label: "Submission Results",
    Icon: CheckCircle,
    description:
      "AutoApply submission confirmations, failures, and items needing attention.",
    types: ["application_action", "draft_review"],
    dot: "#0F766E",
  },
  {
    key: "email",
    label: "Email Responses",
    Icon: Mail,
    description:
      "Funder replies detected in synced email threads requiring follow-up.",
    types: [],
    dot: "#B45309",
  },
  {
    key: "document",
    label: "Document Alerts",
    Icon: FileWarning,
    description:
      "Documents expiring soon or missing from pending applications.",
    types: [],
    dot: "#B91C1C",
  },
  {
    key: "system",
    label: "System Notices",
    Icon: Bell,
    description:
      "Agent run results, usage limit warnings, and platform updates.",
    types: ["system"],
    dot: "#475569",
  },
];

const FILTERS: { key: FilterType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "urgent", label: "Urgent" },
  { key: "snoozed", label: "Snoozed" },
];

const SEVERITY_BORDER: Record<AlertSeverity, string> = {
  critical: "#EF4444",
  warning: "#F59E0B",
  info: "#0077B6",
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
    <div style={{ backgroundColor: CANVAS, minHeight: "100vh" }} className="space-y-6 p-6">
      <style>{`
        @keyframes alerts-critical-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
      <PageHeader
        title="Alerts"
        description="Your daily action list — deadlines, new opportunities, applications needing action, and drafts pending review."
        actions={
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <span
                style={{ backgroundColor: "#FEE2E2", color: "#B91C1C" }}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              >
                <Bell className="h-3.5 w-3.5" aria-hidden />
                {unreadCount} unread
              </span>
            )}
            <button
              type="button"
              onClick={markAllRead}
              disabled={unreadCount === 0}
              style={{
                backgroundColor: unreadCount === 0 ? "#F1F5F9" : ACCENT,
                color: unreadCount === 0 ? "#94A3B8" : "#FFFFFF",
                cursor: unreadCount === 0 ? "not-allowed" : "pointer",
              }}
              className="rounded-lg px-4 py-2 text-sm font-semibold transition"
            >
              Mark all read
            </button>
          </div>
        }
      />

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                backgroundColor: isActive ? ACCENT : CARD,
                color: isActive ? "#FFFFFF" : TEXT_SECONDARY,
                border: isActive ? "none" : "1px solid #E2E8F0",
              }}
              className="rounded-full px-3 py-1 text-sm font-medium transition"
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {(error || actionError) && (
        <div
          role="alert"
          style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: "#B91C1C" }}
          className="rounded-lg px-4 py-3 text-sm"
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
                  className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-left transition hover:bg-white/40"
                >
                  <span
                    style={{ backgroundColor: cat.dot }}
                    className="h-2 w-2 shrink-0 rounded-full"
                    aria-hidden
                  />
                  <Icon className="h-4 w-4 shrink-0" style={{ color: TEXT_MUTED }} aria-hidden />
                  <span style={{ color: TEXT_PRIMARY }} className="flex-1 text-sm font-semibold">
                    {cat.label}
                  </span>
                  {catItems.length > 0 && (
                    <span
                      style={{ backgroundColor: "#F1F5F9", color: "#475569" }}
                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    >
                      {catItems.length}
                    </span>
                  )}
                  <ChevronDown
                    style={{ color: TEXT_MUTED }}
                    className={`h-4 w-4 transition-transform duration-150 ${isCollapsed ? "-rotate-90" : ""}`}
                    aria-hidden
                  />
                </button>

                {!isCollapsed && (
                  <div className="mt-1">
                    {catItems.length === 0 ? (
                      <div
                        style={{ backgroundColor: CARD, borderRadius: "16px", boxShadow: SHADOW }}
                        className="px-5 py-6 text-center"
                      >
                        <p style={{ color: TEXT_SECONDARY }} className="text-sm">
                          {cat.description}
                        </p>
                        <p style={{ color: TEXT_MUTED }} className="mt-2 text-xs">
                          No alerts in this category.
                        </p>
                      </div>
                    ) : (
                      <ul>
                        {catItems.map((alert) => (
                          <AlertRow
                            key={alert.id}
                            alert={alert}
                            dotColor={cat.dot}
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
  dotColor,
  busy,
  onDismiss,
  onSnooze,
  onOpen,
}: {
  alert: Alert;
  dotColor: string;
  busy: boolean;
  onDismiss: () => void;
  onSnooze: (ms: number) => void;
  onOpen: () => void;
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const isCritical = alert.severity === "critical";

  const message = (
    <div className="flex min-w-0 items-start gap-2.5">
      <span
        style={{
          backgroundColor: isCritical ? SEVERITY_BORDER.critical : dotColor,
          animation: isCritical ? "alerts-critical-pulse 1.6s ease-in-out infinite" : undefined,
        }}
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        aria-hidden
      />
      <div className="min-w-0">
        <p
          style={{ color: alert.is_read ? TEXT_SECONDARY : TEXT_PRIMARY }}
          className={`truncate text-sm ${alert.is_read ? "" : "font-semibold"}`}
        >
          {alert.message}
        </p>
        <p style={{ color: TEXT_MUTED }} className="mt-0.5 text-xs">
          {formatRelative(alert.created_at)}
        </p>
      </div>
    </div>
  );

  return (
    <li
      style={{
        backgroundColor: alert.is_read ? CARD : "#EFF6FF",
        borderLeft: `4px solid ${SEVERITY_BORDER[alert.severity]}`,
        borderRadius: "12px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      }}
      className="mb-3 flex items-start gap-4 p-4 transition-shadow hover:shadow-md"
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
              style={{ color: "#CBD5E1" }}
              className="h-4 w-4 shrink-0 transition group-hover:opacity-70"
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
            style={{ color: ACCENT }}
            className="text-xs font-medium hover:underline"
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
              style={{ border: "1px solid #E2E8F0", backgroundColor: CARD, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
              className="absolute right-0 top-full z-10 mt-1 w-36 overflow-hidden rounded-lg py-1"
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
                  style={{ color: TEXT_SECONDARY }}
                  className="block w-full px-3 py-1.5 text-left text-sm transition hover:bg-slate-50"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          aria-label="Dismiss alert"
          style={{ color: TEXT_MUTED, opacity: busy ? 0.5 : 1 }}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition hover:bg-red-50 hover:text-red-600"
        >
          <X className="h-4 w-4" aria-hidden />
          Dismiss
        </button>
      </div>
    </li>
  );
}
