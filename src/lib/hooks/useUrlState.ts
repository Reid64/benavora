"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** A batch of search-param changes. "" / null / undefined removes the key. */
export type UrlStateUpdates = Record<string, string | null | undefined>;

/**
 * Read and write navigation state in the URL's search params, so filters,
 * searches, sorts, and view toggles survive sidebar navigation, refresh, and
 * the back button (and become shareable links).
 *
 * Returns the live `searchParams` plus a `setParams` setter that merges updates
 * into the current query and performs a shallow URL change - no scroll reset and
 * no server round-trip, since every consumer here is a client component reading
 * its own state from the URL. Keys whose value is "" / null / undefined are
 * removed so the URL only ever carries non-default state.
 *
 * Defaults to `router.replace` so rapidly-changing inputs (typing in a search
 * box) don't flood the back-button history; pass `{ history: "push" }` for
 * discrete actions where a distinct history entry is wanted.
 */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParams = useCallback(
    (updates: UrlStateUpdates, options?: { history?: "push" | "replace" }) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value == null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (options?.history === "push") {
        router.push(url, { scroll: false });
      } else {
        router.replace(url, { scroll: false });
      }
    },
    [router, pathname, searchParams],
  );

  return { searchParams, setParams };
}
