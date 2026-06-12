"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

import { navItemsForRole } from "@/components/layout/nav-items";
import { Logo } from "@/components/layout/Logo";
import { rememberedHref } from "@/lib/navigation/section-memory";
import { useAlerts } from "@/lib/hooks/useAlerts";
import type { Enums } from "@/types/database";

type SidebarProps = {
  /** Whether the mobile drawer is open. Ignored at lg+ where the sidebar is static. */
  open: boolean;
  /** Close the mobile drawer (backdrop tap, link click, or close button). */
  onClose: () => void;
  /** Caller's role — gates role-restricted items (e.g. Billing is owner-only). */
  role: Enums<"user_role"> | undefined;
};

/**
 * Dashboard sidebar navigation — dark navy brand rail.
 * - Static rail on lg+ screens.
 * - Slide-in drawer with backdrop on mobile, controlled by `open`.
 * - The nav item whose route matches the current path is highlighted in teal.
 */
export function Sidebar({ open, onClose, role }: SidebarProps) {
  const pathname = usePathname();
  const navItems = navItemsForRole(role);

  // Live red badge counts (deadlines ≤7 days, new opportunities since last
  // login, applications needing action, drafts pending review). Refresh on
  // every navigation so acting on items elsewhere clears the badges.
  const { counts, refresh } = useAlerts();
  const firstRun = useRef(true);
  useEffect(() => {
    // useAlerts already loads on mount; only re-fetch on later navigations.
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    void refresh();
  }, [pathname, refresh]);

  const badgeByHref: Record<string, number> = {
    "/alerts": counts.total,
    "/deadlines": counts.deadline_due,
    "/opportunities": counts.new_opportunity,
    "/applications": counts.application_action,
    "/draft-generator": counts.draft_review,
  };

  // Resolve each item's href to the section's remembered location (restoring
  // saved filters/search/sort/view). Computed after mount — sessionStorage is
  // unavailable during SSR, so the first render uses the plain hrefs to keep
  // server and client markup identical (no hydration mismatch). Recomputed on
  // navigation, by which point the section the user is leaving is recorded.
  const [hrefs, setHrefs] = useState<Record<string, string>>({});
  useEffect(() => {
    const resolved: Record<string, string> = {};
    for (const item of navItemsForRole(role)) {
      resolved[item.href] = rememberedHref(item.href);
    }
    setHrefs(resolved);
  }, [pathname, role]);

  function isActive(href: string): boolean {
    // Highlight on exact match or when inside a section (e.g. /funders/new).
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-navy-950/60 backdrop-blur-sm lg:hidden"
          aria-hidden
          onClick={onClose}
        />
      )}

      <aside
        className={`scrollbar-dark fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/10 bg-ink-900/80 text-navy-100 backdrop-blur-xl transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Primary navigation"
      >
        {/* Brand + mobile close */}
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
          <Link href="/dashboard" aria-label="Benavora — go to dashboard">
            <Logo size={32} />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-navy-300 transition hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map(({ label, href, icon: Icon }) => {
            const active = isActive(href);
            const badge = badgeByHref[href] ?? 0;
            return (
              <Link
                key={href}
                href={hrefs[href] ?? href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-navy-200 hover:bg-white/5 hover:text-white"
                }`}
              >
                {active && (
                  <span
                    className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-teal-400"
                    aria-hidden
                  />
                )}
                <Icon
                  className={`h-5 w-5 shrink-0 transition ${
                    active
                      ? "text-teal-400"
                      : "text-navy-400 group-hover:text-teal-300"
                  }`}
                  aria-hidden
                />
                <span className="truncate">{label}</span>
                {badge > 0 && (
                  <span
                    className="ml-auto inline-flex min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-semibold leading-none text-white"
                    aria-label={`${badge} ${badge === 1 ? "item needs" : "items need"} attention`}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-sm font-semibold leading-tight text-white">
            Fund More.
            <br />
            Do More. Change More.
          </p>
          <p className="mt-1.5 text-xs text-navy-400">
            Nonprofit funding automation
          </p>
        </div>
      </aside>
    </>
  );
}
