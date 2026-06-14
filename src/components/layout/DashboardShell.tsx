"use client";

import { useState, type ReactNode } from "react";

import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { useSectionLocationTracker } from "@/lib/navigation/section-memory";
import type { Enums } from "@/types/database";

type DashboardShellProps = {
  userEmail: string;
  /** Session role - gates role-restricted nav items (e.g. owner-only Billing). */
  role: Enums<"user_role"> | undefined;
  /** Whether onboarding is complete — shows the Onboarding return link in the sidebar. */
  onboardingCompleted: boolean;
  children: ReactNode;
};

/**
 * Client composition shell for the authenticated dashboard.
 * Owns the mobile-drawer open state shared between Header (toggle) and
 * Sidebar (drawer). The server layout passes the session-derived email in.
 */
export function DashboardShell({
  userEmail,
  role,
  onboardingCompleted,
  children,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Record each section's latest URL so the sidebar can restore the filters,
  // search, sort, view toggle, or tab the user left open there.
  useSectionLocationTracker();

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        role={role}
        onboardingCompleted={onboardingCompleted}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          userEmail={userEmail}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
