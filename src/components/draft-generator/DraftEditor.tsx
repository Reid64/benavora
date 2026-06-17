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
 * Read-only variant: renders each [NEEDS INPUT] marker as a clickable amber
 * span with a sequential DOM id (gap-0, gap-1, …) so the badge and Next Gap
 * button can scroll to them via scrollIntoView.
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
        className="bg-amber-100 border border-amber-400 text-amber-800 rounded px-1 py-0.5 cursor-pointer font-medium text-sm inline-block my-0.5"
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

  // Nodes for read-only view: clickable amber spans with sequential DOM ids.
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

  // In edit mode: focus the textarea and select the gap text.
  const scrollToGapInTextarea = useCallback((gap: Gap) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(gap.index, gap.index + gap.length);
  }, []);

  // Badge click: jump to the first gap.
  const handleGapBadgeClick = useCallback(() => {
    if (readOnly) {
      document
        .getElementById("gap-0")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      const firstGap = gaps[0];
      if (firstGap) scrollToGapInTextarea(firstGap);
    }
    setCurrentGapIndex(0);
  }, [readOnly, gaps, scrollToGapInTextarea]);

  // Next Gap button: cycle through each gap in order.
  const handleNextGap = useCallback(() => {
    const idx = currentGapIndex % Math.max(1, gaps.length);
    if (readOnly) {
      document
        .getElementById(`gap-${idx}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      const gap = gaps[idx];
      if (gap) scrollToGapInTextarea(gap);
    }
    setCurrentGapIndex((i) => (i + 1) % Math.max(1, gaps.length));
  }, [currentGapIndex, readOnly, gaps, scrollToGapInTextarea]);

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-navy-700">{label}</span>

        <div className="flex items-center gap-3 text-xs text-navy-500">
          <span>{words.toLocaleString()} words</span>

          {isDirty && onRescore && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onRescore}
              isLoading={rescoring}
              disabled={rescoring}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Rescore
            </Button>
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
          {/* Backdrop — clipped, pointer-events off, scrolled via transform */}
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
              {readOnlyNodes}
            </div>
          </div>

          {/* Textarea — transparent bg so backdrop highlights show through */}
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
