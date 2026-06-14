"use client";

import { useMemo, useRef, useState, useCallback, type ReactElement } from "react";
import { AlertTriangle, ChevronDown, Save } from "lucide-react";

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
 * Splits text around [NEEDS INPUT] markers and wraps them in highlighted <mark>
 * elements. withTextColor=true for read-only display; false for the edit
 * backdrop (where the parent sets color:transparent so only the bg shows).
 */
function buildNodes(text: string, gaps: Gap[], withTextColor: boolean) {
  if (gaps.length === 0) return [text];
  const nodes: (string | ReactElement)[] = [];
  let cursor = 0;
  for (const gap of gaps) {
    if (gap.index > cursor) nodes.push(text.slice(cursor, gap.index));
    const markStyle: { background: string; color?: string } = {
      background: "rgba(147,51,234,0.20)",
    };
    if (withTextColor) markStyle.color = "#9333ea";
    nodes.push(
      <mark
        key={gap.index}
        className="animate-pulse rounded px-0.5 font-bold"
        style={markStyle}
      >
        {text.slice(gap.index, gap.index + gap.length)}
      </mark>,
    );
    cursor = gap.index + gap.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/**
 * Draft editor (BLUEPRINT §4.8 step 5). A plain-text editor over the generated
 * draft — the locked stack ships no rich-text dependency, and drafts are stored
 * and rendered as text (applications.draft_content). Surfaces a live word count
 * and a clickable gap list for every [NEEDS INPUT] placeholder
 * (BEHAVIORAL_CONTRACTS §9). Highlights are rendered via a positioned backdrop
 * in edit mode and via inline <mark> elements in read-only mode.
 */
export function DraftEditor({
  value,
  onChange,
  onSave,
  saving = false,
  readOnly = false,
  label = "Draft",
}: DraftEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropInnerRef = useRef<HTMLDivElement>(null);
  const [gapsOpen, setGapsOpen] = useState(false);

  const { words, gaps } = useMemo(() => {
    const trimmed = value.trim();
    return {
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      gaps: extractGaps(value),
    };
  }, [value]);

  // Nodes for read-only view (purple text + background on marks).
  const readOnlyNodes = useMemo(() => buildNodes(value, gaps, true), [value, gaps]);

  // Nodes for the edit-mode backdrop (background only; text stays transparent).
  const backdropNodes = useMemo(() => buildNodes(value, gaps, false), [value, gaps]);

  // Keep backdrop scroll in sync with the textarea via CSS transform.
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const bd = backdropInnerRef.current;
    if (ta && bd) {
      bd.style.transform = `translateY(-${ta.scrollTop}px)`;
    }
  }, []);

  const scrollToGap = useCallback((gap: Gap) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(gap.index, gap.index + gap.length);
    setGapsOpen(false);
  }, []);

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-navy-700">{label}</span>

        <div className="flex items-center gap-3 text-xs text-navy-500">
          <span>{words.toLocaleString()} words</span>

          {gaps.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setGapsOpen((o) => !o)}
                className="inline-flex items-center gap-1 font-medium text-purple-500 transition-colors hover:text-purple-400"
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                {gaps.length} unresolved {gaps.length === 1 ? "gap" : "gaps"}
                <ChevronDown
                  className={`h-3 w-3 transition-transform duration-150 ${gapsOpen ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>

              {gapsOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-purple-800/40 bg-[#0f0f1f] shadow-xl ring-1 ring-black/20">
                  <p className="border-b border-purple-800/30 px-3 py-2 text-xs font-semibold text-purple-400">
                    Unresolved gaps — click to jump
                  </p>
                  <ul className="max-h-56 overflow-y-auto py-1">
                    {gaps.map((gap, i) => (
                      <li key={gap.index}>
                        <button
                          type="button"
                          onClick={() => scrollToGap(gap)}
                          className="w-full px-3 py-1.5 text-left text-xs text-purple-300 transition-colors hover:bg-purple-900/30"
                        >
                          <span className="mr-2 text-purple-500">#{i + 1}</span>
                          {gap.description}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Draft display ── */}
      {readOnly ? (
        // Read-only: plain div with inline <mark> highlights.
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
              {backdropNodes}
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
