"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";

import { Button, Input, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { isNonEmpty } from "@/lib/utils/validators";
import type { TablesInsert } from "@/types/database";

export type ProgramsStepProps = {
  organizationId: string;
  /** Whether the org already has at least one program (returning user). */
  alreadyAdded: boolean;
  /** Called after programs are saved so the wizard can mark the step done. */
  onSaved: () => void;
};

type ProgramRow = {
  /** Stable key for React; not persisted. */
  key: string;
  name: string;
  description: string;
  budget: string;
  beneficiaries: string;
};

let rowCounter = 0;
function emptyRow(): ProgramRow {
  rowCounter += 1;
  return {
    key: `program-${rowCounter}`,
    name: "",
    description: "",
    budget: "",
    beneficiaries: "",
  };
}

/**
 * Step 3 - programs (BLUEPRINT §4.7 "Knowledge Base → programs", SCHEMA
 * programs table). The user adds one or more initiatives with a budget and
 * beneficiary count; each becomes a programs row the AI drafting agents pull
 * from. organization_id is derived from the session, never the form
 * (Behavioral Contracts §2). Optional - skippable like the other later steps.
 */
export function ProgramsStep({
  organizationId,
  alreadyAdded,
  onSaved,
}: ProgramsStepProps) {
  const [rows, setRows] = useState<ProgramRow[]>(() => [emptyRow()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(alreadyAdded);

  function updateRow(key: string, patch: Partial<ProgramRow>) {
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

    // Only rows with a name are persisted; blank trailing rows are ignored.
    const named = rows.filter((row) => isNonEmpty(row.name));
    if (named.length === 0) {
      setFormError("Add at least one program name, or skip this step.");
      return;
    }

    const records: TablesInsert<"programs">[] = named.map((row) => {
      const budget = Number.parseFloat(row.budget);
      const beneficiaries = Number.parseInt(row.beneficiaries, 10);
      return {
        organization_id: organizationId,
        name: row.name.trim(),
        description: isNonEmpty(row.description) ? row.description.trim() : null,
        budget: Number.isFinite(budget) ? budget : null,
        beneficiaries_served: Number.isFinite(beneficiaries)
          ? beneficiaries
          : null,
      };
    });

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("programs").insert(records);

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
          Your programs are saved. Add or edit them anytime under Knowledge
          Base.
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
                Program {index + 1}
              </legend>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-navy-500 transition hover:bg-red-50 hover:text-red-600"
                  aria-label={`Remove program ${index + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Remove
                </button>
              )}
            </div>

            <div className="space-y-4">
              <Input
                label="Program name"
                value={row.name}
                onChange={(e) => updateRow(row.key, { name: e.target.value })}
                placeholder="e.g. Emergency Family Housing"
              />
              <Textarea
                label="Description"
                value={row.description}
                onChange={(e) =>
                  updateRow(row.key, { description: e.target.value })
                }
                placeholder="What the program does and who it serves."
                rows={3}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Annual budget (USD)"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={row.budget}
                  onChange={(e) =>
                    updateRow(row.key, { budget: e.target.value })
                  }
                  placeholder="50000"
                />
                <Input
                  label="Beneficiaries served / year"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={row.beneficiaries}
                  onChange={(e) =>
                    updateRow(row.key, { beneficiaries: e.target.value })
                  }
                  placeholder="120"
                />
              </div>
            </div>
          </fieldset>
        ))}
      </div>

      <Button type="button" variant="secondary" onClick={addRow}>
        <Plus className="h-4 w-4" aria-hidden />
        Add another program
      </Button>

      <div className="flex justify-end">
        <Button type="submit" isLoading={saving}>
          Save programs
        </Button>
      </div>
    </form>
  );
}
