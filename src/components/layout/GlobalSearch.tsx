"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import Fuse from "fuse.js";

import { FEATURE_INDEX, type FeatureIndexEntry } from "@/lib/search/feature-index";
import { hasRequiredRole } from "@/lib/utils/constants";
import type { Enums } from "@/types/database";

type GlobalSearchProps = {
  /** Session role — an entry whose requiredRole this role doesn't meet is filtered out entirely. */
  role: Enums<"user_role"> | undefined;
};

const MAX_RESULTS = 8;

/** Mac uses Cmd (⌘), everything else (including this Windows dev machine) uses Ctrl. */
function useShortcutLabel(): string {
  const [label, setLabel] = useState("Ctrl K");
  useEffect(() => {
    const isMac = /Mac|iPhone|iPod|iPad/.test(navigator.platform ?? navigator.userAgent);
    setLabel(isMac ? "⌘K" : "Ctrl K");
  }, []);
  return label;
}

export function GlobalSearch({ role }: GlobalSearchProps) {
  const router = useRouter();
  const shortcutLabel = useShortcutLabel();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const modalInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // requiredRole must genuinely be met — filtered entries never render, not even disabled.
  const allowedEntries = useMemo(
    () => FEATURE_INDEX.filter((entry) => hasRequiredRole(role, entry.requiredRole)),
    [role],
  );

  const fuse = useMemo(
    () =>
      new Fuse(allowedEntries, {
        keys: [
          { name: "label", weight: 0.5 },
          { name: "keywords", weight: 0.3 },
          { name: "description", weight: 0.2 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [allowedEntries],
  );

  const results = useMemo<FeatureIndexEntry[]>(() => {
    const trimmed = query.trim();
    if (!trimmed) return allowedEntries.slice(0, MAX_RESULTS);
    return fuse.search(trimmed, { limit: MAX_RESULTS }).map((r) => r.item);
  }, [query, fuse, allowedEntries]);

  // Clamp selection whenever the result set shrinks (e.g. a keystroke narrows the match list).
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(results.length - 1, 0)));
  }, [results.length]);

  const openPalette = useCallback(() => {
    setOpen(true);
    setActiveIndex(0);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    headerInputRef.current?.blur();
  }, []);

  // Global Ctrl+K / Cmd+K — listens for both regardless of OS, per the label above.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openPalette]);

  // Hand off focus to the modal's own input once it mounts.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => modalInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Lock body scroll while open (matches the shared Modal component's convention).
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const navigateTo = useCallback(
    (route: string) => {
      closePalette();
      router.push(route);
    },
    [closePalette, router],
  );

  function handleModalKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const entry = results[activeIndex];
      if (entry) navigateTo(entry.route);
    }
  }

  return (
    <>
      {/* Persistent header search input */}
      <div className="relative hidden sm:block" style={{ width: "220px" }}>
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2"
          style={{ color: "rgba(248,250,252,0.4)" }}
          aria-hidden
        />
        <input
          ref={headerInputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) openPalette();
          }}
          onFocus={() => {
            if (!open) openPalette();
          }}
          placeholder="Search..."
          aria-label="Search Benavora"
          style={{
            width: "100%",
            height: "34px",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.12)",
            backgroundColor: "rgba(255,255,255,0.06)",
            color: "#F8FAFC",
            fontSize: "13px",
            padding: "0 52px 0 32px",
            outline: "none",
          }}
        />
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: 6,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: "11px",
            fontWeight: 600,
            color: "rgba(248,250,252,0.35)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "4px",
            padding: "1px 5px",
            pointerEvents: "none",
          }}
        >
          {shortcutLabel}
        </span>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          className="fixed inset-0 z-[200] flex justify-center px-4"
          style={{ paddingTop: "12vh" }}
        >
          <div
            onClick={closePalette}
            aria-hidden
            className="absolute inset-0"
            style={{ backgroundColor: "rgba(2,6,23,0.7)", backdropFilter: "blur(2px)" }}
          />
          <div
            ref={overlayRef}
            className="relative w-full overflow-hidden"
            style={{
              maxWidth: "560px",
              maxHeight: "70vh",
              backgroundColor: "#0D1526",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "12px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }}
            >
              <Search className="h-4 w-4" style={{ color: "rgba(248,250,252,0.4)" }} aria-hidden />
              <input
                ref={modalInputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleModalKeyDown}
                placeholder="Search Benavora..."
                aria-label="Search Benavora"
                className="flex-1"
                style={{ background: "none", border: "none", outline: "none", color: "#FFFFFF", fontSize: "14px" }}
              />
              <button
                type="button"
                onClick={closePalette}
                aria-label="Close search"
                style={{
                  background: "none",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "4px",
                  padding: "1px 6px",
                  color: "rgba(248,250,252,0.4)",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                Esc
              </button>
            </div>

            <div style={{ overflowY: "auto" }}>
              {results.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "13px" }}>
                    No matches for &quot;{query}&quot;.
                  </p>
                </div>
              ) : (
                <ul role="listbox" aria-label="Search results">
                  {results.map((entry, i) => (
                    <li key={`${entry.route}-${entry.label}`} role="option" aria-selected={i === activeIndex}>
                      <button
                        type="button"
                        onClick={() => navigateTo(entry.route)}
                        onMouseEnter={() => setActiveIndex(i)}
                        className="block w-full px-4 py-2.5 text-left"
                        style={{
                          backgroundColor: i === activeIndex ? "rgba(0,180,216,0.12)" : "transparent",
                          borderLeft: i === activeIndex ? "2px solid #00B4D8" : "2px solid transparent",
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ display: "block", color: "#FFFFFF", fontSize: "13px", fontWeight: 600 }}>
                          {entry.label}
                        </span>
                        <span
                          style={{
                            display: "block",
                            color: "rgba(255,255,255,0.5)",
                            fontSize: "12px",
                            marginTop: "2px",
                          }}
                        >
                          {entry.description}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div
              className="flex gap-3 px-4 py-2"
              style={{ borderTop: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }}
            >
              <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "11px" }}>↑↓ Navigate</span>
              <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "11px" }}>↵ Open</span>
              <span style={{ color: "rgba(255,255,255,0.35)", fontSize: "11px" }}>Esc Close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
