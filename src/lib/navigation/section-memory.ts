"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Remembers the last location (path + query) the user visited within each
 * top-level sidebar section, so returning to a section via the sidebar restores
 * exactly where they left off - the filters, search, sort, view toggle, or tab
 * they had open, all of which live in the URL. Backed by sessionStorage so it
 * persists across refreshes within the tab but resets when the session ends.
 */

const STORAGE_KEY = "benavora:section-locations";

/** Top-level section for a path, e.g. "/funders/123" -> "/funders". */
function sectionKey(pathname: string): string {
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment ? `/${segment}` : "/";
}

function readStore(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, string>): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // sessionStorage may be unavailable (private mode, quota) - degrade silently.
  }
}

/** Record the current location (path, optionally with query) for its section. */
export function rememberLocation(url: string): void {
  const path = url.split("?")[0] ?? url;
  const store = readStore();
  store[sectionKey(path)] = url;
  writeStore(store);
}

/**
 * The remembered location for a nav item, or its plain href when nothing has
 * been recorded yet - or when the recorded entry belongs to a different
 * sub-section (guards multi-segment items such as /admin/audit-log from
 * restoring a sibling under /admin).
 */
export function rememberedHref(navHref: string): string {
  const remembered = readStore()[sectionKey(navHref)];
  if (!remembered) return navHref;
  const rememberedPath = remembered.split("?")[0] ?? remembered;
  if (rememberedPath === navHref || rememberedPath.startsWith(`${navHref}/`)) {
    return remembered;
  }
  return navHref;
}

/**
 * Tracks navigation and records the latest location per section. Mounted once in
 * the dashboard shell; pairs with {@link rememberedHref} in the sidebar.
 */
export function useSectionLocationTracker(): void {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const qs = searchParams.toString();
    rememberLocation(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, searchParams]);
}
