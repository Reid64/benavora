"use client";

import {
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Bold,
  Italic,
  Heading,
  List,
  Quote,
  X,
} from "lucide-react";

import { Badge, Button, Input, Select } from "@/components/ui";
import { ProvenBadge } from "@/components/knowledge-base/ProvenBadge";
import { createClient } from "@/lib/supabase/client";
import {
  FUNDER_CATEGORIES,
  NARRATIVE_CATEGORIES,
  NARRATIVE_MIN_CONTENT_LENGTH,
} from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import { isNonEmpty } from "@/lib/utils/validators";
import { cn } from "@/lib/utils/cn";
import type { Enums, Tables } from "@/types/database";

type NarrativeCategory = Enums<"knowledge_base_category">;
type FunderCategory = Enums<"funder_category">;

const CATEGORY_OPTIONS = NARRATIVE_CATEGORIES.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

export type NarrativeEditorProps = {
  /** Existing narrative when editing; omit to create. */
  narrative?: Tables<"knowledge_base">;
  /** organization_id from the session profile (Behavioral Contracts §2). */
  organizationId: string | null;
  /** author id from the session profile, stored as created_by. */
  authorId: string | null;
  onSaved: (narrative: Tables<"knowledge_base">) => void;
  onCancel: () => void;
};

/**
 * Create/edit a reusable narrative block (BLUEPRINT §4.7). Narratives require a
 * title, category, and content of at least 50 characters (Behavioral Contracts
 * §8). The version number increments on every edit (optimistic concurrency).
 *
 * is_proven and proven_count are READ-ONLY here - they are set exclusively by
 * the Recursive Learning Agent (Contracts §8) and surfaced via ProvenBadge.
 */
export function NarrativeEditor({
  narrative,
  organizationId,
  authorId,
  onSaved,
  onCancel,
}: NarrativeEditorProps) {
  const isEdit = Boolean(narrative);

  const [title, setTitle] = useState(narrative?.title ?? "");
  const [category, setCategory] = useState<NarrativeCategory | "">(
    narrative?.category ?? "",
  );
  const [content, setContent] = useState(narrative?.content ?? "");
  const [keywords, setKeywords] = useState<string[]>(
    narrative?.keywords ?? [],
  );
  const [funderCategories, setFunderCategories] = useState<FunderCategory[]>(
    narrative?.funder_categories ?? [],
  );

  const [fieldError, setFieldError] = useState<{
    title?: string;
    category?: string;
    content?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleFunderCategory(value: FunderCategory) {
    setFunderCategories((prev) =>
      prev.includes(value)
        ? prev.filter((c) => c !== value)
        : [...prev, value],
    );
  }

  function validate(): boolean {
    const errors: typeof fieldError = {};
    if (!isNonEmpty(title)) errors.title = "Title is required.";
    if (!category) errors.category = "Select a category.";
    if (content.trim().length < NARRATIVE_MIN_CONTENT_LENGTH) {
      errors.content = `Content must be at least ${NARRATIVE_MIN_CONTENT_LENGTH} characters.`;
    }
    setFieldError(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setSaving(true);
    const supabase = createClient();

    // is_proven / proven_count are intentionally omitted - agent-owned fields.
    const base = {
      category: category as NarrativeCategory,
      title: title.trim(),
      content: content.trim(),
      keywords: keywords.length ? keywords : null,
      funder_categories: funderCategories.length ? funderCategories : null,
    };

    if (isEdit && narrative) {
      const { data, error } = await supabase
        .from("knowledge_base")
        .update({
          ...base,
          version: (narrative.version ?? 1) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", narrative.id)
        .select()
        .single();

      setSaving(false);
      if (error || !data) {
        setFormError(error?.message ?? "Could not save the narrative.");
        return;
      }
      onSaved(data);
      return;
    }

    if (!organizationId) {
      setSaving(false);
      setFormError("Your session could not be verified. Please sign in again.");
      return;
    }

    const { data, error } = await supabase
      .from("knowledge_base")
      .insert({
        ...base,
        organization_id: organizationId,
        created_by: authorId,
        version: 1,
      })
      .select()
      .single();

    setSaving(false);
    if (error || !data) {
      setFormError(error?.message ?? "Could not create the narrative.");
      return;
    }
    onSaved(data);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {formError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {formError}
        </div>
      )}

      {isEdit && narrative?.is_proven && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm text-green-800">
            This narrative has been flagged as proven by the learning system.
            Edits create a new version; its proven status is managed
            automatically.
          </p>
          <ProvenBadge
            isProven={narrative.is_proven}
            provenCount={narrative.proven_count}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={fieldError.title}
          placeholder="e.g. Rural housing need statement"
        />
        <Select
          label="Category"
          required
          placeholder="Select a category…"
          options={CATEGORY_OPTIONS}
          value={category}
          onChange={(e) => setCategory(e.target.value as NarrativeCategory)}
          error={fieldError.category}
        />
      </div>

      <RichTextArea
        label="Narrative"
        required
        value={content}
        onChange={setContent}
        error={fieldError.content}
        minLength={NARRATIVE_MIN_CONTENT_LENGTH}
        placeholder="Write the narrative block. Supports Markdown for emphasis, lists, and headings."
      />

      <KeywordInput keywords={keywords} onChange={setKeywords} />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-navy-700">
          Effective for funder types
        </span>
        <p className="mb-2 text-xs text-navy-500">
          Tag the funder categories this narrative is written for - drafting
          weights matching narratives more heavily.
        </p>
        <div className="flex flex-wrap gap-2">
          {FUNDER_CATEGORIES.map((value) => {
            const active = funderCategories.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() => toggleFunderCategory(value)}
                aria-pressed={active}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  active
                    ? "border-teal-600 bg-teal-600 text-white"
                    : "border-navy-300 bg-white text-navy-600 hover:bg-navy-50",
                )}
              >
                {humanizeEnum(value)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-navy-200 pt-5">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isLoading={saving}>
          {isEdit ? "Save changes" : "Create narrative"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Lightweight Markdown-formatting textarea ("rich text" without a heavy editor
// dependency). The toolbar wraps or prefixes the current selection.
// ---------------------------------------------------------------------------

type RichTextAreaProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string;
  minLength?: number;
  placeholder?: string;
};

function RichTextArea({
  label,
  value,
  onChange,
  required,
  error,
  minLength,
  placeholder,
}: RichTextAreaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function applyWrap(prefix: string, suffix: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || "text";
    const next =
      value.slice(0, start) + prefix + selected + suffix + value.slice(end);
    onChange(next);
    // Restore a sensible selection on the wrapped text after React re-renders.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  }

  function applyLinePrefix(prefix: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + prefix.length;
      el.setSelectionRange(caret, caret);
    });
  }

  const tools: { label: string; icon: ReactNode; action: () => void }[] = [
    { label: "Bold", icon: <Bold className="h-4 w-4" />, action: () => applyWrap("**", "**") },
    { label: "Italic", icon: <Italic className="h-4 w-4" />, action: () => applyWrap("_", "_") },
    { label: "Heading", icon: <Heading className="h-4 w-4" />, action: () => applyLinePrefix("## ") },
    { label: "Bulleted list", icon: <List className="h-4 w-4" />, action: () => applyLinePrefix("- ") },
    { label: "Quote", icon: <Quote className="h-4 w-4" />, action: () => applyLinePrefix("> ") },
  ];

  const count = value.trim().length;
  const belowMin = minLength != null && count > 0 && count < minLength;

  return (
    <div className="w-full">
      <label className="mb-1.5 block text-sm font-medium text-navy-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <div
        className={cn(
          "overflow-hidden rounded-lg border bg-white shadow-sm focus-within:ring-2",
          error
            ? "border-red-300 focus-within:border-red-500 focus-within:ring-red-500"
            : "border-navy-300 focus-within:border-teal-500 focus-within:ring-teal-500",
        )}
      >
        <div className="flex items-center gap-1 border-b border-navy-200 bg-navy-50 px-2 py-1.5">
          {tools.map((tool) => (
            <button
              key={tool.label}
              type="button"
              onClick={tool.action}
              title={tool.label}
              aria-label={tool.label}
              className="rounded p-1.5 text-navy-500 transition hover:bg-navy-200 hover:text-navy-700"
            >
              {tool.icon}
            </button>
          ))}
          <span className="ml-auto pr-1 text-xs text-navy-400">Markdown</span>
        </div>
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={10}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          className="block w-full resize-y border-0 px-3 py-2 text-sm text-navy-900 placeholder:text-navy-400 focus:outline-none focus:ring-0"
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : (
          <span aria-hidden />
        )}
        <span
          className={cn(
            "text-xs",
            belowMin ? "text-red-500" : "text-navy-400",
          )}
        >
          {count}
          {minLength != null && ` / ${minLength} min`}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyword tag input (text[] column).
// ---------------------------------------------------------------------------

function KeywordInput({
  keywords,
  onChange,
}: {
  keywords: string[];
  onChange: (keywords: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function addKeyword(raw: string) {
    const value = raw.trim().toLowerCase();
    if (!value) return;
    if (keywords.includes(value)) {
      setDraft("");
      return;
    }
    onChange([...keywords, value]);
    setDraft("");
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-navy-700">
        Keywords
      </span>
      {keywords.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {keywords.map((keyword) => (
            <Badge key={keyword} color="blue">
              {keyword}
              <button
                type="button"
                onClick={() => onChange(keywords.filter((k) => k !== keyword))}
                aria-label={`Remove ${keyword}`}
                className="ml-0.5 rounded-full text-blue-500 hover:text-blue-700"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addKeyword(draft);
          } else if (e.key === "Backspace" && !draft && keywords.length) {
            onChange(keywords.slice(0, -1));
          }
        }}
        onBlur={() => addKeyword(draft)}
        placeholder="Type a keyword and press Enter"
        helperText="Used to match this narrative to opportunities."
      />
    </div>
  );
}
