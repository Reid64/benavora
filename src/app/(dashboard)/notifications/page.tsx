"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Bot,
  Calendar,
  CheckCircle2,
  Key,
  Target,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { formatRelative } from "@/lib/utils/formatters";

type NotificationEventType =
  | "automation_completed"
  | "automation_failed"
  | "automation_paused"
  | "deadline_approaching"
  | "agent_completed"
  | "agent_failed"
  | "key_expired"
  | "target_paused"
  | "daily_limit_reached";

type AutoNotification = {
  id: string;
  event_type: string;
  title: string;
  message: string | null;
  is_read: boolean;
  sent_via: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  created_at: string;
};

const EVENT_META: Record<
  NotificationEventType,
  { label: string; icon: LucideIcon; color: string }
> = {
  automation_completed: {
    label: "Automation Completed",
    icon: CheckCircle2,
    color: "text-success-text",
  },
  automation_failed: {
    label: "Automation Failed",
    icon: TriangleAlert,
    color: "text-error-text",
  },
  automation_paused: {
    label: "Automation Paused",
    icon: Bot,
    color: "text-warning-text",
  },
  deadline_approaching: {
    label: "Deadline Approaching",
    icon: Calendar,
    color: "text-warning-text",
  },
  agent_completed: {
    label: "Agent Completed",
    icon: CheckCircle2,
    color: "text-success-text",
  },
  agent_failed: {
    label: "Agent Failed",
    icon: TriangleAlert,
    color: "text-error-text",
  },
  key_expired: { label: "Key Expired", icon: Key, color: "text-error-text" },
  target_paused: {
    label: "Target Paused",
    icon: Target,
    color: "text-warning-text",
  },
  daily_limit_reached: {
    label: "Daily Limit Reached",
    icon: Zap,
    color: "text-warning-text",
  },
};

const ALL_EVENT_TYPES = Object.keys(EVENT_META) as NotificationEventType[];

function metaFor(event_type: string) {
  return (
    EVENT_META[event_type as NotificationEventType] ?? {
      label: event_type,
      icon: Bell,
      color: "text-text-muted",
    }
  );
}

type ReadFilter = "all" | "unread" | "read";

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<AutoNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filters
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [typeFilter, setTypeFilter] = useState<NotificationEventType | "all">(
    "all",
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error("Failed to load notifications.");
      const json = await res.json();
      setNotifications(json.notifications ?? []);
      setUnreadCount(json.unread_count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function markRead(id: string) {
    setBusyId(id);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notification_id: id }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    setBusyId("all");
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } finally {
      setBusyId(null);
    }
  }

  // Apply client-side filters (data already scoped to 90 days by the API).
  const visible = notifications.filter((n) => {
    if (readFilter === "unread" && n.is_read) return false;
    if (readFilter === "read" && !n.is_read) return false;
    if (typeFilter !== "all" && n.event_type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">Notifications</h1>
          <p className="mt-1 text-sm text-text-muted">
            Last 90 days · {unreadCount} unread
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            disabled={busyId === "all"}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-muted transition hover:bg-surface-raised hover:text-text disabled:opacity-50"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Read/unread toggle */}
        <div className="flex overflow-hidden rounded-lg border border-border text-sm">
          {(["all", "unread", "read"] as ReadFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setReadFilter(f)}
              className={cn(
                "px-3 py-1.5 capitalize transition",
                readFilter === f
                  ? "bg-teal-600 text-white"
                  : "text-text-muted hover:bg-surface-raised hover:text-text",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Event type filter */}
        <select
          value={typeFilter}
          onChange={(e) =>
            setTypeFilter(e.target.value as NotificationEventType | "all")
          }
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="all">All types</option>
          {ALL_EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EVENT_META[t].label}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-16 text-center text-sm text-text-muted">
          Loading notifications…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-error-border bg-error-bg px-4 py-6 text-center text-sm text-error-text">
          {error}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface py-16 text-center">
          <Bell className="mx-auto mb-3 h-8 w-8 text-text-muted" />
          <p className="text-sm text-text-muted">No notifications match your filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          {visible.map((n, idx) => {
            const meta = metaFor(n.event_type);
            const Icon = meta.icon;
            return (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-4 border-b border-border px-4 py-4 last:border-0",
                  !n.is_read && "bg-primary/[0.04]",
                  idx === 0 && "rounded-t-xl",
                  idx === visible.length - 1 && "rounded-b-xl",
                )}
              >
                {/* Icon */}
                <div
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-raised",
                    meta.color,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>

                {/* Body */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          n.is_read ? "text-text-muted" : "text-text",
                        )}
                      >
                        {n.title}
                      </p>
                      {n.message && (
                        <p className="mt-0.5 text-sm text-text-muted">
                          {n.message}
                        </p>
                      )}
                      <p className="mt-1.5 text-xs text-text-muted">
                        <span className="mr-2 rounded-full border border-border px-1.5 py-0.5">
                          {meta.label}
                        </span>
                        {formatRelative(n.created_at)}
                      </p>
                    </div>

                    {/* Mark read */}
                    {!n.is_read && (
                      <button
                        type="button"
                        onClick={() => markRead(n.id)}
                        disabled={busyId === n.id}
                        className="shrink-0 rounded-md px-2 py-1 text-xs text-text-muted transition hover:bg-surface-raised hover:text-text disabled:opacity-50"
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                </div>

                {/* Unread dot */}
                {!n.is_read && (
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-teal-400" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
