"use client";

import { useEffect, useRef } from "react";

const CONFIRM_MSG = "You have unsaved changes. Leave anyway?";

/**
 * Guards against accidental navigation when a form has unsaved changes.
 *
 * - `beforeunload`: browser refresh, tab close, address-bar navigation.
 * - `history.pushState` patch: Next.js App Router in-app navigation
 *   (Link components, router.push). App Router removed router.events, so
 *   patching pushState is the reliable interception point.
 *
 * The patch is installed once on mount and removed on unmount, so modal forms
 * that unmount on close clean up automatically without extra teardown.
 *
 * Returns `markClean()` — call it before any programmatic navigation that
 * follows a successful save so the guard does not fire for that transition.
 */
export function useUnsavedChanges(isDirty: boolean) {
  // Use a ref so effect callbacks always read the latest value without needing
  // to re-register the event listener or re-patch pushState on every change.
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  function markClean() {
    isDirtyRef.current = false;
  }

  // Guard browser-level navigation: reload, close tab, address-bar entry.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Guard Next.js App Router in-app navigation.
  // router.push / Link both call history.pushState under the hood.
  // We only block when the pathname+search actually changes so that hash
  // anchors and same-page replaceState calls (e.g. URL filter updates) are
  // never interrupted.
  useEffect(() => {
    const original = history.pushState.bind(history);

    history.pushState = function (
      ...args: Parameters<typeof history.pushState>
    ) {
      if (isDirtyRef.current) {
        const nextUrl = args[2];
        try {
          const next = new URL(
            String(nextUrl ?? ""),
            window.location.origin,
          );
          const current = window.location.pathname + window.location.search;
          if (next.pathname + next.search !== current) {
            if (!window.confirm(CONFIRM_MSG)) return;
            isDirtyRef.current = false;
          }
        } catch {
          // Malformed URL — let the navigation proceed.
        }
      }
      return original(...args);
    };

    return () => {
      history.pushState = original;
    };
  }, []);

  return { markClean };
}
