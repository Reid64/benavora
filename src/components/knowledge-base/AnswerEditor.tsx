"use client";

import { useState, type FormEvent } from "react";

import { Button, Input, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { STANDARD_ANSWER_CATEGORY } from "@/lib/utils/constants";
import { isNonEmpty } from "@/lib/utils/validators";
import type { Tables } from "@/types/database";

export type AnswerEditorProps = {
  /** Existing answer when editing; omit to create. */
  answer?: Tables<"knowledge_base">;
  /** organization_id from the session profile (Behavioral Contracts §2). */
  organizationId: string | null;
  /** author id from the session profile, stored as created_by. */
  authorId: string | null;
  onSaved: (answer: Tables<"knowledge_base">) => void;
  onCancel: () => void;
};

/**
 * Create/edit a standard answer (BLUEPRINT §4.7): a FAQ-style entry where the
 * title is the question pattern and the content is the approved answer. Standard
 * answers require a title and content (Behavioral Contracts §8). They are stored
 * in knowledge_base under the reserved "custom" category so the AI never invents
 * responses to recurring grant questions.
 *
 * The version increments on every edit (optimistic concurrency). is_proven and
 * proven_count are agent-owned and never written here.
 */
export function AnswerEditor({
  answer,
  organizationId,
  authorId,
  onSaved,
  onCancel,
}: AnswerEditorProps) {
  const isEdit = Boolean(answer);

  const [question, setQuestion] = useState(answer?.title ?? "");
  const [content, setContent] = useState(answer?.content ?? "");

  const [fieldError, setFieldError] = useState<{
    question?: string;
    content?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function validate(): boolean {
    const errors: typeof fieldError = {};
    if (!isNonEmpty(question)) errors.question = "A question is required.";
    if (!isNonEmpty(content)) errors.content = "An approved answer is required.";
    setFieldError(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setSaving(true);
    const supabase = createClient();

    const base = {
      category: STANDARD_ANSWER_CATEGORY,
      title: question.trim(),
      content: content.trim(),
    };

    if (isEdit && answer) {
      const { data, error } = await supabase
        .from("knowledge_base")
        .update({
          ...base,
          version: (answer.version ?? 1) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", answer.id)
        .select()
        .single();

      setSaving(false);
      if (error || !data) {
        setFormError(error?.message ?? "Could not save the answer.");
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
      setFormError(error?.message ?? "Could not create the answer.");
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

      <Input
        label="Question pattern"
        required
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        error={fieldError.question}
        placeholder="e.g. Describe your organization's experience with this population."
        helperText="The recurring grant question this answer responds to."
      />

      <Textarea
        label="Approved answer"
        required
        value={content}
        onChange={(e) => setContent(e.target.value)}
        error={fieldError.content}
        rows={8}
        placeholder="The vetted answer the AI should reuse verbatim for this question."
      />

      <div className="flex items-center justify-end gap-3 border-t border-navy-200 pt-5">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isLoading={saving}>
          {isEdit ? "Save changes" : "Create answer"}
        </Button>
      </div>
    </form>
  );
}
