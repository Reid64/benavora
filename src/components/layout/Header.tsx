"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, LogOut, Menu } from "lucide-react";

import { recordAuthEvent } from "@/lib/audit/client";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

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

/** Primary tab links surfaced in the header. */
const TABS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Research", href: "/research" },
  { label: "Opportunities", href: "/opportunities" },
  { label: "Draft Generator", href: "/draft-generator" },
];

/** Avatar-dropdown destinations (Log Out is rendered separately). */
const MENU_LINKS = [
  { label: "Settings", href: "/settings" },
  { label: "Billing", href: "/billing" },
  { label: "Onboarding", href: "/onboarding" },
  { label: "Audit Log", href: "/admin/audit-log" },
];

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
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-4 border-b border-white/10 bg-ink-900/70 px-4 backdrop-blur-xl sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="rounded-md p-1.5 text-navy-300 transition hover:bg-white/10 hover:text-white lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Header tab links */}
      <nav className="hidden items-center gap-1 md:flex" aria-label="Primary sections">
        {TABS.map((tab) => {
          const active = isActiveTab(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                active
                  ? "bg-white/10 text-white"
                  : "text-navy-300 hover:bg-white/5 hover:text-white",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* Org avatar + dropdown */}
      <div className="relative ml-auto" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Organization menu"
        >
          {orgLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={orgLogoUrl}
              alt={orgName || "Organization"}
              className="h-9 w-9 rounded-full object-cover"
            />
          ) : (
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-600 text-sm font-semibold text-white shadow-md shadow-teal-900/40"
              aria-hidden
            >
              {initials}
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-navy-300" aria-hidden />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-ink-900 shadow-2xl"
          >
            <div className="border-b border-white/10 px-4 py-3">
              <p className="truncate text-sm font-semibold text-white">
                {orgName || "Your organization"}
              </p>
              <p className="truncate text-xs text-navy-400">{userEmail}</p>
            </div>
            <div className="py-1">
              {MENU_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                  role="menuitem"
                  className="block px-4 py-2 text-sm text-navy-200 transition hover:bg-white/5 hover:text-white"
                >
                  {l.label}
                </Link>
              ))}
            </div>
            <div className="border-t border-white/10 py-1">
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                role="menuitem"
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-navy-200 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                {signingOut ? "Signing out..." : "Log Out"}
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
