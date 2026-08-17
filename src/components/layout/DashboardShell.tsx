"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { OnboardingBanner, type OnboardingProgressSummary } from "@/components/layout/OnboardingBanner";
import { PlatformTour } from "@/components/onboarding/PlatformTour";
import { useSectionLocationTracker } from "@/lib/navigation/section-memory";
import type { Enums } from "@/types/database";

type DashboardShellProps = {
  userEmail: string;
  /** Session role - gates role-restricted nav items (e.g. owner-only Billing). */
  role: Enums<"user_role"> | undefined;
  /** Whether onboarding is complete — shows the Onboarding return link in the sidebar. */
  onboardingCompleted: boolean;
  /** Onboarding step-completion summary, or null when complete/not applicable. */
  onboardingProgress: OnboardingProgressSummary | null;
  /** Organization name — drives the header avatar initials fallback. */
  orgName: string;
  /** Organization logo URL — shown in the header avatar when present. */
  orgLogoUrl: string | null;
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
  onboardingProgress,
  orgName,
  orgLogoUrl,
  children,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // Record each section's latest URL so the sidebar can restore the filters,
  // search, sort, view toggle, or tab the user left open there.
  useSectionLocationTracker();

  // The wizard itself already shows its own progress bar - don't stack a
  // second one on top of it.
  const onboardingBanner =
    !onboardingCompleted && !pathname.startsWith("/onboarding") ? onboardingProgress : null;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", backgroundColor: "#1C1C1C", color: "#F8F5EE" }}>
      <PlatformTour />
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        role={role}
        onboardingCompleted={onboardingCompleted}
        orgName={orgName}
      />

      <div style={{ display: "flex", minWidth: "0", flex: "1", flexDirection: "column" }}>
        <Header
          userEmail={userEmail}
          role={role}
          orgName={orgName}
          orgLogoUrl={orgLogoUrl}
          onMenuClick={() => setSidebarOpen(true)}
        />
        {onboardingBanner && (
          <OnboardingBanner
            completedSteps={onboardingBanner.completedSteps}
            totalSteps={onboardingBanner.totalSteps}
            lastStep={onboardingBanner.lastStep}
          />
        )}
        <main style={{ flex: "1", overflowY: "auto", backgroundColor: "#1C1C1C", color: "#F8F5EE", padding: "0" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
