"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

export type InstructionalStep = {
  number: number;
  title: string;
  description: string;
};

export type InstructionalWidgetProps = {
  /** Page this widget is shown on — also the localStorage dismissal key. */
  pageTitle: string;
  /** 3-4 steps shown in order, each with its own numbered gold badge. */
  steps: InstructionalStep[];
  /** Called after the widget is dismissed (in addition to persisting to localStorage). */
  onDismiss?: () => void;
};

function storageKey(pageTitle: string): string {
  return `benavora:instructional-widget-dismissed:${pageTitle}`;
}

/**
 * A dismissible top-right "how this page works" card — gold-accented header,
 * numbered gold step badges, forest-green text. Dismissal is remembered per
 * page (by `pageTitle`) in localStorage, so it only shows again if the user
 * clears their browser storage or the page passes a new `pageTitle`.
 *
 * Starts hidden and only reveals itself after checking localStorage on
 * mount, so server and client markup match (no hydration flash).
 */
export function InstructionalWidget({ pageTitle, steps, onDismiss }: InstructionalWidgetProps) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(storageKey(pageTitle)) === "1");
    } catch {
      // localStorage unavailable (private mode, etc.) — default to showing the widget.
      setDismissed(false);
    }
  }, [pageTitle]);

  function handleDismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(storageKey(pageTitle), "1");
    } catch {
      // Non-fatal — the widget just won't stay dismissed across reloads.
    }
    onDismiss?.();
  }

  if (dismissed || steps.length === 0) return null;

  return (
    <div
      className="fixed right-6 top-20 z-40 w-80 max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border shadow-lg"
      style={{ borderColor: "#C49A4F", backgroundColor: "#F9F6EF" }}
      role="complementary"
      aria-label={`How to use ${pageTitle}`}
    >
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ backgroundColor: "#C49A4F" }}
      >
        <p className="truncate text-sm font-bold text-white">{pageTitle}</p>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <ol className="flex flex-col gap-3 px-4 py-4">
        {steps.map((step) => (
          <li key={step.number} className="flex gap-3">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: "#C49A4F" }}
              aria-hidden
            >
              {step.number}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold" style={{ color: "#3D6B50" }}>
                {step.title}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
