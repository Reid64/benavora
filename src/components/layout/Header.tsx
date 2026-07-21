"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";

import { recordAuthEvent } from "@/lib/audit/client";
import { createClient } from "@/lib/supabase/client";
import { NotificationBell } from "@/components/notifications/NotificationBell";

type HeaderProps = {
  /** Authenticated user's email, derived server-side from the session. */
  userEmail: string;
  /** Organization name — drives the avatar initials fallback + menu label. */
  orgName: string;
  /** Organization logo URL — shown in the avatar when present. */
  orgLogoUrl: string | null;
  /** Open the mobile sidebar drawer. */
  onMenuClick: () => void;
};

// PERMANENT do not remove Donor Discovery from header nav — this list keeps
// getting reverted; Donor Discovery is a top-level header tab, not a sidebar
// item. Do not delete or relocate it without explicit user instruction.
/** Primary tab links surfaced in the header. */
const TABS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Research", href: "/research" },
  { label: "Opportunities", href: "/opportunities" },
  { label: "AutoApply", href: "/autoapply" },
  { label: "Draft Generator", href: "/draft-generator" },
  { label: "Donor Discovery", href: "/donor-discovery" },
];

// Draft Generator has no sidebar entry (it's a header tab — see comment on
// nav-items.ts's NAV_ITEMS), so it has no `children` array to attach an
// "AI Drafts Ready" link to the way Sidebar attaches children. Instead this
// renders as a badge on the tab plus a slim sub-link row shown while the
// user is anywhere under /draft-generator, mirroring Sidebar's
// active-parent-reveals-children pattern in the header's own idiom.
const DRAFT_GENERATOR_HREF = "/draft-generator";
const AUTONOMOUS_DRAFTS_HREF = "/draft-generator/autonomous";

/** Avatar-dropdown destinations (Log Out is rendered separately). */
const MENU_LINKS = [
  { label: "Settings", href: "/settings" },
  { label: "Billing", href: "/billing" },
  { label: "Onboarding", href: "/onboarding" },
  { label: "Audit Log", href: "/admin/audit-log" },
  { label: "AutoApply Ops", href: "/admin/autoapply-ops" },
];

const NAV_LINK_ACTIVE =
  "px-4 py-2 text-sm font-semibold text-[#0077B6] border-b-2 border-[#0077B6] rounded-none -mb-px";
const NAV_LINK_INACTIVE =
  "px-4 py-2 text-sm font-semibold text-slate-600 hover:text-[#0077B6] hover:bg-slate-50 rounded-lg transition-colors";

/** Formats a raw count per the nav-badge display rule: 0 hides, 10+ shows "9+". */
function badgeLabel(count: number): string {
  return count >= 10 ? "9+" : String(count);
}

const TAB_BADGE_STYLE: CSSProperties = {
  position: "absolute",
  top: -6,
  right: -8,
  width: 16,
  height: 16,
  borderRadius: "50%",
  backgroundColor: "#EF4444",
  color: "#FFFFFF",
  fontSize: "9px",
  fontWeight: 700,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/** 16px circle badge overlaid top-right of a header tab. Hidden at 0. */
function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span style={TAB_BADGE_STYLE} aria-label={`${count} ${count === 1 ? "item needs" : "items need"} attention`}>
      {badgeLabel(count)}
    </span>
  );
}

/** Up-to-two-letter initials from the org name, falling back to the email. */
function orgInitials(orgName: string, userEmail: string): string {
  const name = orgName.trim();
  if (name) {
    const letters = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p.charAt(0))
      .join("");
    return (letters || name.charAt(0)).toUpperCase();
  }
  return (userEmail.charAt(0) || "?").toUpperCase();
}

export function Header({ userEmail, orgName, orgLogoUrl, onMenuClick }: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [autonomousDraftsCount, setAutonomousDraftsCount] = useState(0);
  const [opportunitiesCount, setOpportunitiesCount] = useState(0);
  const [autoapplyQueuedCount, setAutoapplyQueuedCount] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the avatar dropdown on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [menuOpen]);

  const fetchNavCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/nav-counts", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          autonomousDrafts?: number;
          opportunities?: number;
          autoapplyQueued?: number;
        };
        setAutonomousDraftsCount(data.autonomousDrafts ?? 0);
        setOpportunitiesCount(data.opportunities ?? 0);
        setAutoapplyQueuedCount(data.autoapplyQueued ?? 0);
      }
    } catch {
      // Non-fatal — badges simply stay at zero.
    }
  }, []);

  useEffect(() => {
    void fetchNavCounts();
  }, [fetchNavCounts, pathname]);

  useEffect(() => {
    const interval = setInterval(() => void fetchNavCounts(), 60_000);
    return () => clearInterval(interval);
  }, [fetchNavCounts]);

  async function handleSignOut() {
    setSigningOut(true);
    await recordAuthEvent("logout");
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function isActiveTab(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const initials = orgInitials(orgName, userEmail);

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-border shadow-sm">
      <div className="flex items-center h-16 px-6">
        <div className="mr-4">
          <button
            type="button"
            onClick={onMenuClick}
            className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        {/* Header tab links */}
        <div className="flex flex-col">
          <nav className="flex items-center gap-1" aria-label="Primary sections">
            {TABS.map((tab) => {
              const active = isActiveTab(tab.href);
              const tabBadge =
                tab.href === DRAFT_GENERATOR_HREF
                  ? autonomousDraftsCount
                  : tab.href === "/opportunities"
                    ? opportunitiesCount
                    : tab.href === "/autoapply"
                      ? autoapplyQueuedCount
                      : 0;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={active ? NAV_LINK_ACTIVE : NAV_LINK_INACTIVE}
                  style={{ position: "relative" }}
                >
                  {tab.label}
                  <TabBadge count={tabBadge} />
                </Link>
              );
            })}
          </nav>
          {pathname.startsWith(DRAFT_GENERATOR_HREF) && (
            <div className="pl-4">
              <Link
                href={AUTONOMOUS_DRAFTS_HREF}
                className="inline-flex items-center gap-1.5 text-xs font-medium"
                style={{
                  color: pathname === AUTONOMOUS_DRAFTS_HREF ? "#0077B6" : "#64748B",
                }}
              >
                AI Drafts Ready
                {autonomousDraftsCount > 0 && (
                  <span
                    className="inline-flex min-w-[1.1rem] items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ backgroundColor: "#EF4444", color: "#FFFFFF", padding: "1px 5px" }}
                  >
                    {autonomousDraftsCount > 99 ? "99+" : autonomousDraftsCount}
                  </span>
                )}
              </Link>
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-4">
          {/* Notification bell */}
          <NotificationBell />

          {/* Org avatar + dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0077B6]"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Organization menu"
            >
              <span className="hidden text-sm font-medium text-slate-700 sm:inline">
                {orgName || "Your organization"}
              </span>
              {orgLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={orgLogoUrl}
                  alt={orgName || "Organization"}
                  className="w-9 h-9 rounded-full object-cover ring-2 ring-[#00B4D8] ring-offset-2"
                />
              ) : (
                <span
                  className="w-9 h-9 rounded-full bg-[#0077B6] text-white flex items-center justify-center text-sm font-bold ring-2 ring-[#00B4D8] ring-offset-2"
                  aria-hidden
                >
                  {initials}
                </span>
              )}
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
              >
                <div className="border-b border-slate-200 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {orgName || "Your organization"}
                  </p>
                  <p className="truncate text-xs text-slate-500">{userEmail}</p>
                </div>
                <div className="py-1">
                  {MENU_LINKS.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setMenuOpen(false)}
                      role="menuitem"
                      className="block px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
                <div className="border-t border-slate-200 py-1">
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={signingOut}
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                    {signingOut ? "Signing out..." : "Log Out"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
