"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import { formatRelative } from "@/lib/utils/formatters";
import { notificationEventMeta } from "@/lib/notifications/event-meta";

type BellNotification = {
  id: string;
  event_type: string;
  title: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
};

const POLL_INTERVAL_MS = 60_000;
const DESCRIPTION_MAX_LEN = 80;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 8px pulse animation for critical (failure/urgent) notification icons. */
const pulseKeyframes = `
@keyframes notification-bell-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
`;

export function NotificationBell() {
  const [notifications, setNotifications] = useState<BellNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?unread_only=true", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications: BellNotification[]; unread_count: number };
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unread_count ?? 0);
    } catch {
      // Non-fatal — bell simply keeps its last known state.
    }
  }, []);

  useEffect(() => {
    void fetchUnread();
    const interval = setInterval(() => void fetchUnread(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function markRead(id: string) {
    setBusyId(id);
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setUnreadCount((c) => Math.max(0, c - 1));
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    setBusyId("all");
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setBusyId(null);
    }
  }

  const visible = notifications.slice(0, 10);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <style>{pulseKeyframes}</style>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
        style={{
          position: "relative",
          padding: "8px",
          borderRadius: "8px",
          backgroundColor: "transparent",
          border: "none",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Bell
          className="h-5 w-5"
          style={{ color: unreadCount > 0 ? "#0F172A" : "#94A3B8" }}
          aria-hidden
        />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: "16px",
              height: "16px",
              borderRadius: "50%",
              backgroundColor: "#EF4444",
              color: "#FFFFFF",
              fontSize: "10px",
              fontWeight: 700,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
              boxShadow: "0 0 0 2px #FFFFFF",
            }}
            aria-hidden
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            zIndex: 100,
            marginTop: "8px",
            width: "360px",
            backgroundColor: "#0D1526",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <span style={{ color: "#FFFFFF", fontSize: "13px", fontWeight: 700 }}>
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={busyId === "all"}
                style={{
                  color: "#C49A4F",
                  fontSize: "12px",
                  fontWeight: 600,
                  background: "none",
                  border: "none",
                  cursor: busyId === "all" ? "not-allowed" : "pointer",
                  opacity: busyId === "all" ? 0.5 : 1,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          <div style={{ maxHeight: "420px", overflowY: "auto" }}>
            {visible.length === 0 ? (
              <div style={{ padding: "32px 16px", textAlign: "center" }}>
                <Bell className="mx-auto mb-2 h-6 w-6" style={{ color: "rgba(255,255,255,0.3)" }} aria-hidden />
                <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "13px" }}>
                  You&apos;re all caught up.
                </p>
              </div>
            ) : (
              visible.map((n) => {
                const meta = notificationEventMeta(n.event_type);
                const Icon = meta.icon;
                return (
                  <button
                    key={n.id}
                    type="button"
                    role="menuitem"
                    onClick={() => markRead(n.id)}
                    disabled={busyId === n.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      width: "100%",
                      padding: "12px 16px",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      cursor: busyId === n.id ? "not-allowed" : "pointer",
                      opacity: busyId === n.id ? 0.5 : 1,
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "28px",
                        height: "28px",
                        borderRadius: "50%",
                        backgroundColor: "rgba(255,255,255,0.06)",
                        flexShrink: 0,
                        marginTop: "2px",
                        animation: meta.critical ? "notification-bell-pulse 1.6s ease-in-out infinite" : undefined,
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} aria-hidden />
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", color: "#FFFFFF", fontSize: "13px", fontWeight: 600 }}>
                        {n.title}
                      </span>
                      {n.message && (
                        <span style={{ display: "block", color: "rgba(255,255,255,0.55)", fontSize: "12px", marginTop: "2px" }}>
                          {truncate(n.message, DESCRIPTION_MAX_LEN)}
                        </span>
                      )}
                      <span style={{ display: "block", color: "rgba(255,255,255,0.35)", fontSize: "11px", marginTop: "4px" }}>
                        {formatRelative(n.created_at)}
                      </span>
                    </span>
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: "#C49A4F",
                        flexShrink: 0,
                        marginTop: "6px",
                      }}
                      aria-hidden
                    />
                  </button>
                );
              })
            )}
          </div>

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            style={{
              display: "block",
              padding: "12px 16px",
              textAlign: "center",
              color: "#C49A4F",
              fontSize: "12px",
              fontWeight: 600,
              borderTop: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
