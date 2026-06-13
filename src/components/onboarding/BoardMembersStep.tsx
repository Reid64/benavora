"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";

import { Button, Input, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { isNonEmpty } from "@/lib/utils/validators";
import type { TablesInsert } from "@/types/database";

export type BoardMembersStepProps = {
  organizationId: string;
  /** Whether the org already has at least one board member (returning user). */
  alreadyAdded: boolean;
  /** Called after members are saved so the wizard can mark the step done. */
  onSaved: () => void;
};

type BoardRow = {
  /** Stable key for React; not persisted. */
  key: string;
  name: string;
  title: string;
  bio: string;
};

let rowCounter = 0;
function emptyRow(): BoardRow {
  rowCounter += 1;
  return { key: `board-${rowCounter}`, name: "", title: "", bio: "" };
}

/**
 * Step 4 - board members (BLUEPRINT §4.7, SCHEMA board_members table). Grant
 * applications routinely ask for governing-board composition, so we capture it
 * up front. Each named row becomes a board_members record (is_active defaults
 * true at the DB). organization_id is derived from the session, never the form
 * (Behavioral Contracts §2). Optional - skippable.
 */
export function BoardMembersStep({
  organizationId,
  alreadyAdded,
  onSaved,
}: BoardMembersStepProps) {
  const [rows, setRows] = useState<BoardRow[]>(() => [emptyRow()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(alreadyAdded);

  function updateRow(key: string, patch: Partial<BoardRow>) {
    setRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(key: string) {
    setRows((prev) =>
      prev.length === 1 ? prev : prev.filter((row) => row.key !== key),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const named = rows.filter((row) => isNonEmpty(row.name));
    if (named.length === 0) {
      setFormError("Add at least one member name, or skip this step.");
      return;
    }

    const records: TablesInsert<"board_members">[] = named.map((row) => ({
      organization_id: organizationId,
      name: row.name.trim(),
      title: isNonEmpty(row.title) ? row.title.trim() : null,
      bio: isNonEmpty(row.bio) ? row.bio.trim() : null,
    }));

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("board_members").insert(records);

    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setDone(true);
    onSaved();
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-5 py-4 text-sm text-teal-800">
        <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
        <span>
          Your board roster is saved. Manage it anytime under Knowledge Base.
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {formError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {formError}
        </div>
      )}

      <div className="space-y-5">
        {rows.map((row, index) => (
          <fieldset
            key={row.key}
            className="rounded-xl border border-navy-100 bg-navy-50/40 p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <legend className="text-sm font-semibold text-navy-700">
                Member {index + 1}
              </legend>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-navy-500 transition hover:bg-red-50 hover:text-red-600"
                  aria-label={`Remove member ${index + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Remove
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Full name"
                  value={row.name}
                  onChange={(e) => updateRow(row.key, { name: e.target.value })}
                  placeholder="e.g. Maria Gonzalez"
                />
                <Input
                  label="Board title"
                  value={row.title}
                  onChange={(e) => updateRow(row.key, { title: e.target.value })}
                  placeholder="e.g. Board Chair"
                />
              </div>
              <Textarea
                label="Short bio"
                value={row.bio}
                onChange={(e) => updateRow(row.key, { bio: e.target.value })}
                placeholder="Background and relevant experience."
                rows={3}
              />
            </div>
          </fieldset>
        ))}
      </div>

      <Button type="button" variant="secondary" onClick={addRow}>
        <Plus className="h-4 w-4" aria-hidden />
        Add another member
      </Button>

      <div className="flex justify-end">
        <Button type="submit" isLoading={saving}>
          Save board members
        </Button>
      </div>
    </form>
  );
}
