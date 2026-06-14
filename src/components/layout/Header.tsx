"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, LogOut, Menu } from "lucide-react";

import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { recordAuthEvent } from "@/lib/audit/client";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { formatRelative } from "@/lib/utils/formatters";

type AutoNotification = {
  id: string;
  event_type: string;
  title: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
};

type HeaderProps = {
  /** Authenticated user's email, derived server-side from the session. */
  userEmail: string;
  /** Open the mobile sidebar drawer. */
  onMenuClick: () => void;
};

export function Header({ userEmail, onMenuClick }: HeaderProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  // Notification bell state
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<AutoNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);

  // Fetch notifications on mount and whenever the dropdown opens.
  async function fetchNotifications() {
    setLoadingNotifs(true);
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const json = await res.json();
        setNotifications((json.notifications ?? []).slice(0, 10));
        setUnreadCount(json.unread_count ?? 0);
      }
    } finally {
      setLoadingNotifs(false);
    }
  }

  useEffect(() => {
    fetchNotifications();
  }, []);

  useEffect(() => {
    if (bellOpen) fetchNotifications();
  }, [bellOpen]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!bellOpen) return;
    function handleOutside(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [bellOpen]);

  async function markRead(id: string) {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notification_id: id }),
    });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }

  async function handleSignOut() {
    setSigningOut(true);
    await recordAuthEvent("logout");
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const initial = userEmail.charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-4 border-b border-white/10 bg-ink-900/70 px-4 backdrop-blur-xl sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="rounded-md p-1.5 text-navy-300 transition hover:bg-white/10 hover:text-white lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="hidden min-w-0 flex-1 sm:block">
        <Breadcrumbs />
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* Notification bell */}
        <div className="relative" ref={bellRef}>
          <button
            type="button"
            onClick={() => setBellOpen((o) => !o)}
            className="relative rounded-md p-1.5 text-navy-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold leading-none text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          {bellOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-white/10 bg-ink-900 shadow-2xl">
              {/* Header row */}
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                <span className="text-sm font-semibold text-white">
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="text-xs text-teal-400 hover:text-teal-300"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              {/* List */}
              <div className="max-h-80 overflow-y-auto">
                {loadingNotifs && notifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-navy-400">
                    Loading…
                  </p>
                ) : notifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-navy-400">
                    No notifications yet.
                  </p>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        if (!n.is_read) markRead(n.id);
                      }}
                      className={cn(
                        "w-full border-b border-white/5 px-4 py-3 text-left transition last:border-0 hover:bg-white/5",
                        !n.is_read && "bg-white/[0.03]",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {!n.is_read && (
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" />
                        )}
                        <div className={cn("min-w-0", n.is_read && "pl-3.5")}>
                          <p className="truncate text-sm font-medium text-white">
                            {n.title}
                          </p>
                          {n.message && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-navy-300">
                              {n.message}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-navy-500">
                            {formatRelative(n.created_at)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-white/10 px-4 py-2.5">
                <Link
                  href="/notifications"
                  onClick={() => setBellOpen(false)}
                  className="block text-center text-xs text-teal-400 hover:text-teal-300"
                >
                  View all notifications →
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* User avatar + email */}
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-600 text-sm font-semibold text-white shadow-md shadow-teal-900/40"
            aria-hidden
          >
            {initial}
          </span>
          <span className="hidden max-w-[12rem] truncate text-sm text-navy-200 sm:inline">
            {userEmail}
          </span>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-medium text-navy-100 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">
            {signingOut ? "Signing out..." : "Log out"}
          </span>
        </button>
      </div>
    </header>
  );
}
