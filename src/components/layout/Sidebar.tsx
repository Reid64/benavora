"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Telescope, X } from "lucide-react";

import {
  DONOR_DISCOVERY_DRILLDOWN,
  navItemsForRole,
  PLATFORM_NAV_ITEMS,
  SETTINGS_NAV_ITEM,
} from "@/components/layout/nav-items";
import { Logo } from "@/components/layout/Logo";
import { rememberedHref } from "@/lib/navigation/section-memory";
import type { Enums } from "@/types/database";

type NavCounts = {
  alerts: number;
  applications: number;
  documents: number;
  deadlines: number;
};

type SidebarProps = {
  /** Whether the mobile drawer is open. Ignored at lg+ where the sidebar is static. */
  open: boolean;
  /** Close the mobile drawer (backdrop tap, link click, or close button). */
  onClose: () => void;
  /** Caller's role — gates role-restricted items and the platform section. */
  role: Enums<"user_role"> | undefined;
  /** Whether onboarding is complete. */
  onboardingCompleted: boolean;
};

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-auto inline-flex min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-semibold leading-none text-white"
      aria-label={`${count} ${count === 1 ? "item needs" : "items need"} attention`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * Dashboard sidebar navigation — dark navy brand rail.
 * - Static rail on lg+ screens.
 * - Slide-in drawer with backdrop on mobile, controlled by `open`.
 * - The nav item whose route matches the current path is highlighted in teal.
 */
export function Sidebar({ open, onClose, role, onboardingCompleted }: SidebarProps) {
  const pathname = usePathname();
  const navItems = navItemsForRole(role, { onboardingCompleted });
  const isPlatformAdmin = role === "owner" || role === "admin";

  // Lightweight badge counts from a single API call.
  const [navCounts, setNavCounts] = useState<NavCounts>({
    alerts: 0,
    applications: 0,
    documents: 0,
    deadlines: 0,
  });

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/nav-counts", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as NavCounts;
        setNavCounts(data);
      }
    } catch {
      // Non-fatal — badges simply stay at zero.
    }
  }, []);

  useEffect(() => {
    void fetchCounts();
  }, [fetchCounts]);

  // Re-fetch on navigation so badges update after the user acts on items.
  useEffect(() => {
    void fetchCounts();
  }, [pathname, fetchCounts]);

  // Resolve each item's href to the section's remembered location (restoring
  // saved filters/search/sort/view). Computed after mount — sessionStorage is
  // unavailable during SSR, so the first render uses the plain hrefs to keep
  // server and client markup identical (no hydration mismatch).
  const [hrefs, setHrefs] = useState<Record<string, string>>({});
  useEffect(() => {
    const resolved: Record<string, string> = {};
    for (const item of navItemsForRole(role, { onboardingCompleted })) {
      resolved[item.href] = rememberedHref(item.href);
    }
    resolved[SETTINGS_NAV_ITEM.href] = rememberedHref(SETTINGS_NAV_ITEM.href);
    setHrefs(resolved);
  }, [pathname, role, onboardingCompleted]);

  const badgeByHref: Record<string, number> = {
    "/alerts": navCounts.alerts,
    "/applications": navCounts.applications,
    "/documents": navCounts.documents,
    "/deadlines": navCounts.deadlines,
  };

  function isActive(href: string): boolean {
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
        className={`scrollbar-dark fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/10 bg-sidebar text-slate-400 transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Primary navigation"
      >
        {/* Brand + mobile close */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <Link href="/dashboard" aria-label="Benavora - go to dashboard">
            {/* Desktop: full wordmark + tagline */}
            <div className="hidden flex-col lg:flex">
              <Logo />
              <span className="mt-1 text-[10px] leading-tight tracking-wide text-slate-400">
                Fund More. Do More. Change More.
              </span>
            </div>
            {/* Mobile drawer: icon only, no tagline */}
            <Logo size={32} showWordmark={false} className="lg:hidden" />
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main nav links */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
          {pathname.startsWith("/donor-discovery") && (
            <div className="mb-2 border-b border-white/10 pb-2">
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Donor Discovery
              </p>
              <Link
                href={DONOR_DISCOVERY_DRILLDOWN.href}
                onClick={onClose}
                aria-current={isActive(DONOR_DISCOVERY_DRILLDOWN.href) ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive(DONOR_DISCOVERY_DRILLDOWN.href)
                    ? "bg-sidebar-active text-accent"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Telescope className="h-5 w-5 shrink-0" aria-hidden />
                <span className="truncate">{DONOR_DISCOVERY_DRILLDOWN.label}</span>
              </Link>
            </div>
          )}
          {navItems.map(({ label, href, icon: Icon, children }) => {
            const active = isActive(href);
            const badge = badgeByHref[href] ?? 0;
            return (
              <div key={href}>
                <Link
                  href={hrefs[href] ?? href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-sidebar-active text-accent"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {active && (
                    <span
                      className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-accent"
                      aria-hidden
                    />
                  )}
                  <Icon
                    className={`h-5 w-5 shrink-0 transition ${
                      active ? "text-accent" : "text-slate-400 group-hover:text-white"
                    }`}
                    aria-hidden
                  />
                  <span className="truncate">{label}</span>
                  <NavBadge count={badge} />
                </Link>
                {active && children && children.length > 0 && (
                  <div className="ml-9 mt-0.5 space-y-0.5">
                    {children.map((child) => {
                      const childActive = pathname === child.href;
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onClose}
                          aria-current={childActive ? "page" : undefined}
                          className={`flex items-center rounded-md px-3 py-1.5 text-xs font-medium transition ${
                            childActive ? "text-accent" : "text-slate-400 hover:text-white"
                          }`}
                        >
                          {childActive && (
                            <span
                              className="mr-2 inline-block h-1 w-1 rounded-full bg-accent"
                              aria-hidden
                            />
                          )}
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Platform admin section */}
        {isPlatformAdmin && (
          <div className="border-t border-white/10 px-3 py-3">
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Platform
            </p>
            {PLATFORM_NAV_ITEMS.map(({ label, href, icon: Icon }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-sidebar-active text-accent"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {active && (
                    <span
                      className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-accent"
                      aria-hidden
                    />
                  )}
                  <Icon
                    className={`h-5 w-5 shrink-0 transition ${
                      active ? "text-accent" : "text-slate-400 group-hover:text-white"
                    }`}
                    aria-hidden
                  />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </div>
        )}

        {/* Settings — bottom, separated */}
        <div className="border-t border-white/10 px-3 py-3">
          {(() => {
            const { label, href, icon: Icon } = SETTINGS_NAV_ITEM;
            const active = isActive(href);
            return (
              <Link
                href={hrefs[href] ?? href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-sidebar-active text-accent"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {active && (
                  <span
                    className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-accent"
                    aria-hidden
                  />
                )}
                <Icon
                  className={`h-5 w-5 shrink-0 transition ${
                    active ? "text-accent" : "text-slate-400 group-hover:text-white"
                  }`}
                  aria-hidden
                />
                <span className="truncate">{label}</span>
              </Link>
            );
          })()}
          <p className="mt-3 px-3 text-xs text-slate-500">Nonprofit funding automation</p>
        </div>
      </aside>
    </>
  );
}
