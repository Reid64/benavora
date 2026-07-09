"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { Badge } from "@/components/ui";

const DISMISS_KEY = "benavora:onboarding-banner-dismissed";

export type OnboardingProgressSummary = {
  completedSteps: number;
  totalSteps: number;
  lastStep: number;
};

/**
 * Shown on every dashboard page (except the wizard itself) while onboarding
 * is incomplete. Dismissal is per-session (sessionStorage), not permanent -
 * it reappears next session as a nudge to finish setup.
 */
export function OnboardingBanner({ completedSteps, totalSteps, lastStep }: OnboardingProgressSummary) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private mode / quota - the banner just reappears on next render.
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-warning-border bg-warning-bg px-4 py-2.5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="warning">
          {completedSteps} of {totalSteps}
        </Badge>
        <span className="text-warning-text">
          Organization setup is {completedSteps} of {totalSteps} steps complete.{" "}
          <Link
            href={`/onboarding?step=${lastStep}`}
            className="font-medium underline underline-offset-2 hover:no-underline"
          >
            Resume setup
          </Link>
        </span>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss setup reminder"
        className="shrink-0 text-warning-text hover:opacity-70"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
