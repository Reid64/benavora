"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type UseAutoSaveOptions = {
  /** Timer auto-save cadence in ms, fires even without new keystrokes. Default 30s. */
  interval?: number;
  /** Debounce delay after the last keystroke before saving. Default 1s. */
  debounce?: number;
  /** Set false to pause all auto-saving (e.g. read-only mode, validation failing). */
  enabled?: boolean;
};

export type UseAutoSaveResult = {
  isSaving: boolean;
  lastSaved: Date | null;
  error: Error | null;
  /** Call on every content edit to schedule a debounced save. */
  handleChange: (newContent: unknown) => void;
  /** Save immediately, bypassing the debounce/interval timers. */
  saveNow: () => Promise<void>;
};

/**
 * Debounced-keystroke + periodic-timer auto-save. Fixes the original hook,
 * which had two bugs that made auto-save effectively dead:
 *
 * 1. `handleChange` (the keystroke-debounce path) was built but never
 *    returned, so no caller could ever trigger it — only the 30s timer ran.
 * 2. The 30s timer effect depended on `content`, so it was torn down and
 *    rebuilt on every keystroke. Typing continuously reset the interval
 *    before it ever elapsed, so the "save every 30s regardless of typing"
 *    guarantee never held in practice.
 *
 * Both save paths now read the latest content/onSave via refs, so neither
 * timer restarts on every render, and an in-flight guard + last-saved-value
 * check stop the debounce and interval paths from racing each other or
 * writing unchanged content.
 */
export function useAutoSave(
  content: unknown,
  onSave: (draft: unknown) => Promise<void>,
  options?: UseAutoSaveOptions,
): UseAutoSaveResult {
  const interval = options?.interval ?? 30000;
  const debounce = options?.debounce ?? 1000;
  const enabled = options?.enabled ?? true;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const contentRef = useRef(content);
  const onSaveRef = useRef(onSave);
  const savedContentRef = useRef(content);
  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const runSave = useCallback(async (draft: unknown) => {
    // Overlapping calls (interval firing mid-debounce-save, etc.) skip
    // rather than queue - the next tick will pick up the latest content.
    if (inFlightRef.current) return;
    if (draft === savedContentRef.current) return;

    inFlightRef.current = true;
    if (isMountedRef.current) {
      setIsSaving(true);
      setError(null);
    }
    try {
      await onSaveRef.current(draft);
      savedContentRef.current = draft;
      if (isMountedRef.current) setLastSaved(new Date());
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err));
      console.error("Auto-save failed:", normalized);
      if (isMountedRef.current) setError(normalized);
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current) setIsSaving(false);
    }
  }, []);

  const handleChange = useCallback(
    (newContent: unknown) => {
      contentRef.current = newContent;
      if (!enabled) return;

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        void runSave(contentRef.current);
      }, debounce);
    },
    [enabled, debounce, runSave],
  );

  // Timer auto-save: fires every `interval` ms regardless of keystrokes.
  // Reads content via contentRef so this effect only needs to run once per
  // interval/enabled change, not on every content change (the original bug).
  useEffect(() => {
    if (!enabled) return;

    intervalTimerRef.current = setInterval(() => {
      void runSave(contentRef.current);
    }, interval);

    return () => {
      if (intervalTimerRef.current) {
        clearInterval(intervalTimerRef.current);
        intervalTimerRef.current = null;
      }
    };
  }, [enabled, interval, runSave]);

  // Flush a pending debounced edit on unmount so navigating away right after
  // typing doesn't silently drop the last few keystrokes. Fire-and-forget:
  // the component is gone, so this bypasses state updates entirely.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        if (!inFlightRef.current && contentRef.current !== savedContentRef.current) {
          void onSaveRef.current(contentRef.current).catch((err) => {
            console.error("Auto-save flush on unmount failed:", err);
          });
        }
      }
    };
  }, []);

  const saveNow = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    await runSave(contentRef.current);
  }, [runSave]);

  return { isSaving, lastSaved, error, handleChange, saveNow };
}
