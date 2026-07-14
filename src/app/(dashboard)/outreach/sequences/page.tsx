"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ListChecks, Plus, Trash2 } from "lucide-react";

import { Badge, Button, Card, EmptyState, Input, Select, Modal } from "@/components/ui";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { formatRelative } from "@/lib/utils/formatters";
import type { Tables } from "@/types/database";

type Sequence = Tables<"followup_sequences">;

const TRIGGER_STAGE_OPTIONS = [
  { value: "submitted", label: "Submitted" },
  { value: "follow_up_due", label: "Follow-up due" },
  { value: "awarded", label: "Awarded" },
  { value: "denied", label: "Denied" },
  { value: "renewal_opportunity", label: "Renewal opportunity" },
];

interface StepDraft {
  offset_days: string;
  channel: string;
  note: string;
}

const CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "phone", label: "Phone" },
  { value: "mail", label: "Physical Mail" },
];

/**
 * Follow-up sequence library. Multi-step, trigger-based post-submission
 * sequences (check-in, thank-you, renewal, etc.) applications enroll into.
 */
export default function OutreachSequencesPage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/outreach/sequences");
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { sequences: Sequence[] };
      setSequences(data.sequences ?? []);
    } catch {
      setError("Could not load follow-up sequences.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const showEmpty = !loading && !error && sequences.length === 0;

  return (
    <div className="space-y-6">
      <Link
        href="/outreach"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to outreach
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Follow-Up Sequences
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Multi-step sequences applications enroll into on stage changes like submission, award, or denial.
          </p>
        </div>
        {editable && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            New Sequence
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {showEmpty ? (
        <EmptyState
          icon={ListChecks}
          title="No sequences yet"
          description="Create a follow-up sequence to auto-schedule check-ins, thank-yous, and renewal prep."
          action={
            editable ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                New Sequence
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sequences.map((s) => {
            const steps = Array.isArray(s.steps) ? (s.steps as unknown[]) : [];
            const triggerLabel =
              TRIGGER_STAGE_OPTIONS.find((o) => o.value === s.trigger_stage)?.label ??
              s.trigger_stage;
            return (
              <Card key={s.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-navy-900">{s.name}</p>
                      <Badge color="blue" withDot>
                        Trigger: {triggerLabel}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-navy-500">
                      {steps.length} step{steps.length === 1 ? "" : "s"}
                    </p>
                    <p className="mt-2 text-xs text-navy-400">
                      Created {formatRelative(s.created_at)}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={creating}
        onClose={() => setCreating(false)}
        title="New Sequence"
        size="lg"
      >
        <SequenceForm
          onCancel={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      </Modal>
    </div>
  );
}

function SequenceForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [triggerStage, setTriggerStage] = useState(TRIGGER_STAGE_OPTIONS[0]!.value);
  const [steps, setSteps] = useState<StepDraft[]>([
    { offset_days: "14", channel: "email", note: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function addStep() {
    setSteps((prev) => [...prev, { offset_days: "0", channel: "email", note: "" }]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === "") {
      setError("Name is required.");
      return;
    }
    if (steps.length === 0) {
      setError("At least one step is required.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await fetch("/api/outreach/sequences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        trigger_stage: triggerStage,
        steps: steps.map((step) => ({
          offset_days: Number(step.offset_days) || 0,
          channel: step.channel,
          note: step.note.trim(),
        })),
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not save the sequence.");
      setSaving(false);
      return;
    }

    setSaving(false);
    await onSaved();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Sequence name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Post-award renewal prep"
          required
        />
        <Select
          label="Trigger stage"
          value={triggerStage}
          options={TRIGGER_STAGE_OPTIONS}
          onChange={(e) => setTriggerStage(e.target.value)}
          required
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-navy-700">Steps</p>
          <Button type="button" variant="secondary" onClick={addStep}>
            <Plus className="h-4 w-4" aria-hidden />
            Add step
          </Button>
        </div>

        {steps.map((step, index) => (
          <div
            key={index}
            className="grid grid-cols-1 gap-3 rounded-lg border border-navy-200 p-3 sm:grid-cols-[100px_140px_1fr_auto]"
          >
            <Input
              label="Days after"
              type="number"
              value={step.offset_days}
              onChange={(e) => updateStep(index, { offset_days: e.target.value })}
            />
            <Select
              label="Channel"
              value={step.channel}
              options={CHANNEL_OPTIONS}
              onChange={(e) => updateStep(index, { channel: e.target.value })}
            />
            <Input
              label="Note"
              value={step.note}
              onChange={(e) => updateStep(index, { note: e.target.value })}
              placeholder="Check-in email referencing the original ask"
            />
            <div className="flex items-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => removeStep(index)}
                disabled={steps.length === 1}
                aria-label="Remove step"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 border-t border-navy-200 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" isLoading={saving}>
          Create sequence
        </Button>
      </div>
    </form>
  );
}
