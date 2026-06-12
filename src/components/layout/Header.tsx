"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu } from "lucide-react";

import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { recordAuthEvent } from "@/lib/audit/client";
import { createClient } from "@/lib/supabase/client";

type HeaderProps = {
  /** Authenticated user's email, derived server-side from the session. */
  userEmail: string;
  /** Open the mobile sidebar drawer. */
  onMenuClick: () => void;
};

/**
 * Top bar — dark navy brand surface: mobile menu toggle, breadcrumbs,
 * user avatar/email, and logout.
 */
export function Header({ userEmail, onMenuClick }: HeaderProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    // Audit the logout while the session is still valid (Contracts §24), then
    // sign out.
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
            {signingOut ? "Signing out…" : "Log out"}
          </span>
        </button>
      </div>
    </header>
  );
}
