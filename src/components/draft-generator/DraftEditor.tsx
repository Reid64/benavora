"use client";

import { useMemo, useRef, useState, useCallback, type ReactElement } from "react";
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

/**
 * Read-only view: render each [NEEDS INPUT] marker as clickable, colored,
 * underlined text — no background, no border — with a sequential DOM id
 * (gap-0, gap-1, …) so the badge and Next Gap button can scroll to them.
 *
 * Edit mode does NOT use this: the textarea is a single text layer, so gaps are
 * simply visible as their literal "[NEEDS INPUT: …]" text and navigated via
 * textarea selection (the backdrop renders plain, un-highlighted text).
 */
function buildInteractiveNodes(text: string, gaps: Gap[]) {
  if (gaps.length === 0) return [text];
  const nodes: (string | ReactElement)[] = [];
  let cursor = 0;
  gaps.forEach((gap, seqIndex) => {
    if (gap.index > cursor) nodes.push(text.slice(cursor, gap.index));
    const i = seqIndex;
    nodes.push(
      <span
        key={gap.index}
        id={`gap-${i}`}
        className="text-amber-400 font-semibold cursor-pointer underline decoration-amber-400"
        onClick={() =>
          document
            .getElementById(`gap-${i}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" })
        }
        title="Click to highlight — fill in this section"
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
 */
function measureCaretTop(ta: HTMLTextAreaElement, index: number): number {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement("div");
  const m = mirror.style as unknown as Record<string, string>;
  const r = cs as unknown as Record<string, string>;
  const props = [
    "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
    "lineHeight", "textTransform",
  ];
  for (const p of props) m[p] = r[p] ?? "";
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

  // Nodes for read-only view: clickable colored-underline spans with DOM ids.
  const readOnlyNodes = useMemo(
    () => buildInteractiveNodes(value, gaps),
    [value, gaps],
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

  // Read-only mode: the draft box is full-height and the page scrolls, so we
  // scroll the window to the gap's on-page position rather than relying on
  // scrollIntoView (which targets the wrong scroll context here).
  const scrollWindowToGap = useCallback((idx: number) => {
    const el = document.getElementById(`gap-${idx}`);
    if (el) {
      const rect = el.getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + rect.top - 150, behavior: "smooth" });
    }
  }, []);

  // Badge click: jump to the first gap.
  const handleGapBadgeClick = useCallback(() => {
    if (readOnly) {
      scrollWindowToGap(0);
    } else {
      const firstGap = gaps[0];
      if (firstGap) scrollToGapInTextarea(firstGap);
    }
    setCurrentGapIndex(0);
  }, [readOnly, gaps, scrollToGapInTextarea, scrollWindowToGap]);

  // Next Gap button: cycle through each gap in order.
  const handleNextGap = useCallback(() => {
    const idx = currentGapIndex % Math.max(1, gaps.length);
    if (readOnly) {
      scrollWindowToGap(idx);
    } else {
      const gap = gaps[idx];
      if (gap) scrollToGapInTextarea(gap);
    }
    setCurrentGapIndex((i) => (i + 1) % Math.max(1, gaps.length));
  }, [currentGapIndex, readOnly, gaps, scrollToGapInTextarea, scrollWindowToGap]);

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
          {/* Backdrop — plain transparent text, no gap highlighting. Gaps are
              visible as literal "[NEEDS INPUT: …]" text in the textarea layer. */}
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
              {value}
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
