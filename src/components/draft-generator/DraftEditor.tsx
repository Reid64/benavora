"use client";

import { useEffect, useMemo, useRef, useState, useCallback, type ReactElement } from "react";
import { AlertTriangle, RefreshCw, Save } from "lucide-react";

import { Button } from "@/components/ui";

export type DraftEditorProps = {
  /** Current draft text (controlled). */
  value: string;
  /** Called on every edit. */
  onChange: (value: string) => void;
  /** Optional save handler. When provided, a Save button is shown. */
  onSave?: () => void;
  /** Save in progress. */
  saving?: boolean;
  /** Read-only / non-editable (e.g. for viewers). */
  readOnly?: boolean;
  /** Label shown above the editor. */
  label?: string;
  /** True when content has been manually edited since the last rescore. */
  isDirty?: boolean;
  /** Called when the user clicks Rescore. Visible only when isDirty is true. */
  onRescore?: () => void;
  /** Rescore in progress. */
  rescoring?: boolean;
  /** Style the label + word/gap count row for a dark card background (draft generator page). Defaults to light. */
  dark?: boolean;
};

type Gap = { description: string; index: number; length: number };

const GAP_PATTERN = String.raw`\[NEEDS INPUT(?::([^\]]*))?\]`;

function extractGaps(text: string): Gap[] {
  const gaps: Gap[] = [];
  const re = new RegExp(GAP_PATTERN, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    gaps.push({
      description: m[1]?.trim() || "Unspecified input needed",
      index: m.index,
      length: m[0].length,
    });
  }
  return gaps;
}

// Every unresolved gap gets a persistent highlight so the operator can see
// all of them at a glance; the active/current gap gets a stronger highlight
// (solid fill + ring) so it reads as the focused one among the set.
const GAP_HIGHLIGHT_BG = "rgba(245, 158, 11, 0.22)";
const GAP_ACTIVE_BG = "rgba(245, 158, 11, 0.55)";
const GAP_ACTIVE_RING = "0 0 0 2px rgba(180, 83, 9, 0.9)";

/**
 * Read-only view: render each [NEEDS INPUT] marker as clickable, colored,
 * underlined text with a persistent highlight — with a sequential DOM id
 * (gap-0, gap-1, …) so the badge and Next Gap button can scroll to them.
 * Clicking a gap also makes it the active gap.
 *
 * Edit mode does NOT use this: see buildBackdropNodes below, which paints the
 * same highlights behind the textarea instead.
 */
function buildInteractiveNodes(
  text: string,
  gaps: Gap[],
  activeIndex: number,
  onSelectGap: (index: number) => void,
) {
  if (gaps.length === 0) return [text];
  const nodes: (string | ReactElement)[] = [];
  let cursor = 0;
  gaps.forEach((gap, i) => {
    if (gap.index > cursor) nodes.push(text.slice(cursor, gap.index));
    const isActive = i === activeIndex;
    nodes.push(
      <span
        key={gap.index}
        id={`gap-${i}`}
        tabIndex={-1}
        className={`cursor-pointer font-semibold underline decoration-amber-500 ${isActive ? "text-amber-900" : "text-amber-700"}`}
        style={{
          backgroundColor: isActive ? GAP_ACTIVE_BG : GAP_HIGHLIGHT_BG,
          borderRadius: "3px",
          boxShadow: isActive ? GAP_ACTIVE_RING : undefined,
        }}
        onClick={() => onSelectGap(i)}
        title="Click to jump to this gap"
      >
        {text.slice(gap.index, gap.index + gap.length)}
      </span>,
    );
    cursor = gap.index + gap.length;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/**
 * Edit-mode backdrop: same highlight treatment as buildInteractiveNodes, but
 * text stays transparent (the real, editable text is the textarea layer on
 * top) — only each gap's highlight background is visible, showing through
 * the textarea's transparent background.
 */
function buildBackdropNodes(text: string, gaps: Gap[], activeIndex: number) {
  if (gaps.length === 0) return [text];
  const nodes: (string | ReactElement)[] = [];
  let cursor = 0;
  gaps.forEach((gap, i) => {
    if (gap.index > cursor) nodes.push(text.slice(cursor, gap.index));
    const isActive = i === activeIndex;
    nodes.push(
      <span
        key={gap.index}
        style={{
          backgroundColor: isActive ? GAP_ACTIVE_BG : GAP_HIGHLIGHT_BG,
          borderRadius: "3px",
          boxShadow: isActive ? GAP_ACTIVE_RING : undefined,
          color: "transparent",
        }}
      >
        {text.slice(gap.index, gap.index + gap.length)}
      </span>,
    );
    cursor = gap.index + gap.length;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/**
 * Pixel offset of a character index within a textarea's scrollable content,
 * measured with a hidden mirror element that mimics the textarea's box and font.
 * Counting "\n" alone undercounts wrapped lines (a long paragraph is one logical
 * line but many visual rows), which made gap navigation under-scroll badly.
 *
 * The mirror's content width is derived from `clientWidth` (which already
 * excludes border and any scrollbar gutter) minus padding, rather than
 * copying the computed `width` onto a `content-box` mirror directly — under
 * this app's global `box-sizing: border-box` reset, computed `width` is the
 * border-box width, so a content-box mirror set to that value renders wider
 * than the real textarea, wraps fewer lines, and under-estimates the caret's
 * vertical offset (gap navigation would center on the wrong line).
 */
function measureCaretTop(ta: HTMLTextAreaElement, index: number): number {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement("div");
  const m = mirror.style as unknown as Record<string, string>;
  const r = cs as unknown as Record<string, string>;
  const props = [
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
    "lineHeight", "textTransform",
  ];
  for (const p of props) m[p] = r[p] ?? "";
  const paddingLeft = parseFloat(cs.paddingLeft) || 0;
  const paddingRight = parseFloat(cs.paddingRight) || 0;
  m.width = `${Math.max(0, ta.clientWidth - paddingLeft - paddingRight)}px`;
  m.boxSizing = "content-box";
  m.position = "absolute";
  m.top = "0";
  m.left = "-9999px";
  m.visibility = "hidden";
  m.height = "auto";
  m.whiteSpace = "pre-wrap";
  m.wordBreak = "break-word";
  m.overflowWrap = "break-word";
  mirror.textContent = ta.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  document.body.removeChild(mirror);
  return top;
}

/**
 * Draft editor (BLUEPRINT §4.8 step 5). A plain-text editor over the generated
 * draft — the locked stack ships no rich-text dependency, and drafts are stored
 * and rendered as text (applications.draft_content). Surfaces a live word count
 * and a clickable gap list for every [NEEDS INPUT] placeholder
 * (BEHAVIORAL_CONTRACTS §9). Highlights are rendered via a positioned backdrop
 * in edit mode and via inline clickable amber spans in read-only mode.
 */
export function DraftEditor({
  value,
  onChange,
  onSave,
  saving = false,
  readOnly = false,
  label = "Draft",
  isDirty = false,
  onRescore,
  rescoring = false,
  dark = false,
}: DraftEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropInnerRef = useRef<HTMLDivElement>(null);
  const [currentGapIndex, setCurrentGapIndex] = useState(0);

  const { words, gaps } = useMemo(() => {
    const trimmed = value.trim();
    return {
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      gaps: extractGaps(value),
    };
  }, [value]);

  // Clamp the active gap index when the gap list shrinks (a gap was resolved)
  // or the draft was reloaded, so it never points past the end of the array.
  useEffect(() => {
    if (currentGapIndex >= gaps.length && gaps.length > 0) {
      setCurrentGapIndex(0);
    }
  }, [gaps.length, currentGapIndex]);

  const selectReadOnlyGap = useCallback((index: number) => {
    setCurrentGapIndex(index);
    const el = document.getElementById(`gap-${index}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    }
  }, []);

  // Nodes for read-only view: clickable, persistently-highlighted spans with
  // DOM ids; the active gap gets a stronger highlight.
  const readOnlyNodes = useMemo(
    () => buildInteractiveNodes(value, gaps, currentGapIndex, selectReadOnlyGap),
    [value, gaps, currentGapIndex, selectReadOnlyGap],
  );

  // Nodes for the edit-mode backdrop: same highlights, invisible text.
  const backdropNodes = useMemo(
    () => buildBackdropNodes(value, gaps, currentGapIndex),
    [value, gaps, currentGapIndex],
  );

  // Keep backdrop scroll in sync with the textarea via CSS transform.
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const bd = backdropInnerRef.current;
    if (ta && bd) {
      bd.style.transform = `translateY(-${ta.scrollTop}px)`;
    }
  }, []);

  // In edit mode: focus the textarea, select the gap text, and scroll it into
  // view. setSelectionRange alone doesn't reliably move the viewport, so we
  // approximate the gap's line and center it (keeps the backdrop in sync).
  const scrollToGapInTextarea = useCallback(
    (gap: Gap) => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(gap.index, gap.index + gap.length);
      const top = measureCaretTop(ta, gap.index);
      ta.scrollTop = Math.max(0, top - ta.clientHeight / 2);
      syncScroll();
    },
    [syncScroll],
  );

  // Badge click: jump focus to the first gap and smooth-scroll it into view.
  const handleGapBadgeClick = useCallback(() => {
    setCurrentGapIndex(0);
    if (readOnly) {
      selectReadOnlyGap(0);
    } else {
      const firstGap = gaps[0];
      if (firstGap) scrollToGapInTextarea(firstGap);
    }
  }, [readOnly, gaps, scrollToGapInTextarea, selectReadOnlyGap]);

  // Next Gap button: advance to the next gap (wrapping) and auto-scroll it in.
  const handleNextGap = useCallback(() => {
    const nextIdx = (currentGapIndex + 1) % Math.max(1, gaps.length);
    setCurrentGapIndex(nextIdx);
    if (readOnly) {
      selectReadOnlyGap(nextIdx);
    } else {
      const gap = gaps[nextIdx];
      if (gap) scrollToGapInTextarea(gap);
    }
  }, [currentGapIndex, readOnly, gaps, scrollToGapInTextarea, selectReadOnlyGap]);

  // Previous Gap button: same as Next, in reverse (wrapping).
  const handlePrevGap = useCallback(() => {
    const prevIdx = (currentGapIndex - 1 + Math.max(1, gaps.length)) % Math.max(1, gaps.length);
    setCurrentGapIndex(prevIdx);
    if (readOnly) {
      selectReadOnlyGap(prevIdx);
    } else {
      const gap = gaps[prevIdx];
      if (gap) scrollToGapInTextarea(gap);
    }
  }, [currentGapIndex, readOnly, gaps, scrollToGapInTextarea, selectReadOnlyGap]);

  return (
    <div className="flex h-full flex-col space-y-3">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={dark ? undefined : "text-sm font-medium text-navy-700"}
          style={
            dark
              ? {
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "rgba(248,250,252,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: "8px",
                }
              : undefined
          }
        >
          {label}
        </span>

        <div
          className={dark ? undefined : "flex items-center gap-3 text-xs text-navy-500"}
          style={
            dark
              ? { display: "flex", alignItems: "center", gap: "12px", fontSize: "12px", color: "rgba(248,250,252,0.4)" }
              : undefined
          }
        >
          <span>{words.toLocaleString()} words</span>

          {isDirty && onRescore && (
            <button
              type="button"
              onClick={onRescore}
              disabled={rescoring}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs transition disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: "#f59e0b", color: "#000000", border: "1px solid #d97706", fontWeight: "500" }}
              title="Recalculate the confidence score from the current draft text"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${rescoring ? "animate-spin" : ""}`}
                aria-hidden
              />
              {rescoring ? "Rescoring…" : "Rescore"}
            </button>
          )}

          {gaps.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleGapBadgeClick}
                className="inline-flex items-center gap-1 font-medium text-primary transition-colors hover:text-primary/80"
                title="Jump to first gap"
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                {gaps.length} unresolved {gaps.length === 1 ? "gap" : "gaps"}
              </button>

              {gaps.length > 1 && (
                <button
                  type="button"
                  onClick={handlePrevGap}
                  className="inline-flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-0.5 font-medium text-amber-700 transition-colors hover:bg-amber-100"
                  title="Scroll to previous gap"
                >
                  ← Prev
                </button>
              )}

              <button
                type="button"
                onClick={handleNextGap}
                className="inline-flex items-center gap-1 rounded border border-amber-400 bg-amber-50 px-2 py-0.5 font-medium text-amber-700 transition-colors hover:bg-amber-100"
                title="Scroll to next gap"
              >
                Next gap →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Draft display ── */}
      {readOnly ? (
        // Read-only: plain div with inline clickable amber spans.
        <div
          className={dark ? "block w-full flex-1 overflow-y-auto" : "block min-h-[55vh] w-full flex-1 overflow-y-auto rounded-xl border border-slate-300 bg-transparent p-6 font-mono text-sm text-slate-700 leading-relaxed"}
          style={
            dark
              ? {
                  whiteSpace: "pre-wrap",
                  backgroundColor: "rgba(0,0,0,0.2)",
                  borderRadius: "10px",
                  padding: "16px",
                  border: "1px solid rgba(255,255,255,0.06)",
                  flex: "1",
                  minHeight: "400px",
                  color: "rgba(248,250,252,0.85)",
                  fontSize: "14px",
                  lineHeight: "1.7",
                }
              : { whiteSpace: "pre-wrap" }
          }
        >
          {readOnlyNodes}
        </div>
      ) : (
        // Edit mode: textarea floated over a highlight backdrop. min-h-[55vh]
        // + flex-1 so the editor fills the available height instead of the
        // old fixed `rows={20}` (which the global `textarea{max-height:120px}`
        // base style clamped down to a few visible lines regardless).
        <div
          className={dark ? "relative flex flex-1 flex-col transition" : "relative flex min-h-[55vh] flex-1 flex-col rounded-xl border border-slate-300 bg-transparent transition focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500"}
          style={
            dark
              ? {
                  backgroundColor: "rgba(0,0,0,0.2)",
                  borderRadius: "10px",
                  padding: "16px",
                  border: "1px solid rgba(255,255,255,0.06)",
                  flex: "1",
                  minHeight: "400px",
                }
              : undefined
          }
        >
          {/* Backdrop — transparent text with visible highlight spans behind
              each unresolved gap (shows through the textarea's transparent
              background); the active gap gets a stronger highlight. */}
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl"
            aria-hidden
          >
            <div
              ref={backdropInnerRef}
              className={dark ? "font-mono leading-relaxed" : "p-6 font-mono text-sm leading-relaxed"}
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "transparent",
                ...(dark ? { fontSize: "14px", lineHeight: "1.7" } : {}),
              }}
            >
              {backdropNodes}
            </div>
          </div>

          {/* Textarea — single text layer; gap markers read as literal text */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
            aria-label={label}
            spellCheck
            className={dark ? "relative block h-full max-h-none w-full flex-1 resize-none bg-transparent font-mono placeholder:text-slate-500 focus:outline-none" : "relative block h-full max-h-none w-full flex-1 resize-none rounded-xl bg-transparent p-6 font-mono text-sm leading-relaxed text-slate-700 placeholder:text-slate-400 focus:outline-none"}
            style={dark ? { color: "rgba(248,250,252,0.85)", fontSize: "14px", lineHeight: "1.7" } : undefined}
            placeholder="The generated draft will appear here. Edit freely before saving."
          />
        </div>
      )}

      {gaps.length > 0 && (
        <p
          className={dark ? undefined : "text-xs text-navy-500"}
          style={dark ? { fontSize: "12px", color: "rgba(248,250,252,0.4)" } : undefined}
        >
          Replace each{" "}
          <code
            className={dark ? "rounded px-1 py-0.5" : "rounded bg-navy-100 px-1 py-0.5 text-navy-600"}
            style={dark ? { backgroundColor: "rgba(255,255,255,0.08)", color: "rgba(248,250,252,0.7)" } : undefined}
          >
            [NEEDS INPUT: ...]
          </code>{" "}
          marker with verified information before submitting.
        </p>
      )}

      {onSave && !readOnly && (
        <div className="flex justify-end">
          <Button onClick={onSave} isLoading={saving} disabled={!value.trim()}>
            <Save className="h-4 w-4" aria-hidden />
            Save draft
          </Button>
        </div>
      )}
    </div>
  );
}
