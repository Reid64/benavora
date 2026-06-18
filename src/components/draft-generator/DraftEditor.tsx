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
  // eslint-disable-next-line no-console
  console.log("BUILDING GAP NODES", { gapsCount: gaps.length, firstGapId: gaps[0] ? "gap-0" : "none" });
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
    // eslint-disable-next-line no-console
    console.log("GAP BADGE CLICKED", { gapsLength: gaps.length, readOnly, gap0: document.getElementById("gap-0") });
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
    // eslint-disable-next-line no-console
    console.log("NEXT GAP CLICKED", { currentGapIndex, gapsLength: gaps.length, element: document.getElementById(`gap-${currentGapIndex}`) });
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
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-navy-700">{label}</span>

        <div className="flex items-center gap-3 text-xs text-navy-500">
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
                className="inline-flex items-center gap-1 font-medium text-purple-500 transition-colors hover:text-purple-400"
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
          className="block w-full rounded-lg border border-navy-300 bg-navy-50 px-3 py-2 font-mono text-sm leading-relaxed text-navy-600 shadow-sm"
          style={{ whiteSpace: "pre-wrap", minHeight: "20rem" }}
        >
          {readOnlyNodes}
        </div>
      ) : (
        // Edit mode: textarea floated over a highlight backdrop.
        <div className="relative rounded-lg border border-navy-300 bg-white shadow-sm transition focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500">
          {/* Backdrop — plain transparent text, no gap highlighting. Gaps are
              visible as literal "[NEEDS INPUT: …]" text in the textarea layer. */}
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"
            aria-hidden
          >
            <div
              ref={backdropInnerRef}
              className="px-3 py-2 font-mono text-sm leading-relaxed"
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                color: "transparent",
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
            rows={20}
            aria-label={label}
            spellCheck
            className="relative block w-full rounded-lg bg-transparent px-3 py-2 font-mono text-sm leading-relaxed text-navy-900 placeholder:text-navy-400 focus:outline-none"
            placeholder="The generated draft will appear here. Edit freely before saving."
          />
        </div>
      )}

      {gaps.length > 0 && (
        <p className="text-xs text-navy-500">
          Replace each{" "}
          <code className="rounded bg-navy-100 px-1 py-0.5 text-navy-600">
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
