"use client";

import { useMemo } from "react";
import { AlertTriangle, Save } from "lucide-react";

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

/**
 * Draft editor (BLUEPRINT §4.8 step 5). A plain-text editor over the generated
 * draft — the locked stack ships no rich-text dependency, and drafts are stored
 * and rendered as text (applications.draft_content). It surfaces a live word
 * count and a count of unresolved [NEEDS INPUT] gaps so the writer can resolve
 * every placeholder before submission (BEHAVIORAL_CONTRACTS §9).
 */
export function DraftEditor({
  value,
  onChange,
  onSave,
  saving = false,
  readOnly = false,
  label = "Draft",
}: DraftEditorProps) {
  const { words, gaps } = useMemo(() => {
    const trimmed = value.trim();
    return {
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      gaps: (value.match(/\[NEEDS INPUT/gi) ?? []).length,
    };
  }, [value]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-navy-700">{label}</span>
        <div className="flex items-center gap-3 text-xs text-navy-500">
          <span>{words.toLocaleString()} words</span>
          {gaps > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-yellow-700">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              {gaps} unresolved {gaps === 1 ? "gap" : "gaps"}
            </span>
          )}
        </div>
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        rows={20}
        aria-label={label}
        spellCheck
        className="block w-full rounded-lg border border-navy-300 bg-white px-3 py-2 font-mono text-sm leading-relaxed text-navy-900 shadow-sm transition placeholder:text-navy-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500 read-only:bg-navy-50 read-only:text-navy-600"
        placeholder="The generated draft will appear here. Edit freely before saving."
      />

      {gaps > 0 && (
        <p className="text-xs text-navy-500">
          Replace each{" "}
          <code className="rounded bg-navy-100 px-1 py-0.5 text-navy-600">
            [NEEDS INPUT: …]
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
