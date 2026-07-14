"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingSpinner,
  Modal,
  Select,
  Textarea,
} from "@/components/ui";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { cn } from "@/lib/utils/cn";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import { BAND_VARIANT, urgency } from "@/components/deadlines/DeadlinePill";
import type { ComplianceItem } from "@/app/api/compliance/route";

const REQUIREMENT_TYPE_OPTIONS = [
  { value: "reporting", label: "Reporting" },
  { value: "spending_restriction", label: "Spending Restriction" },
  { value: "matching_fund", label: "Matching Fund" },
  { value: "regulatory", label: "Regulatory Filing" },
];

type UrgencyColor = "red" | "amber" | "green";

function urgencyColor(dueDate: string): UrgencyColor {
  const { band } = urgency(dueDate);
  if (band === "overdue") return "red";
  if (band === "green") return "green";
  return "amber";
}

const ITEM_CLASSES: Record<UrgencyColor, string> = {
  red: "bg-[#FEF2F2] border-l-4 border-[#EF4444] rounded-xl p-4",
  amber: "bg-[#FFFBEB] border-l-4 border-[#F59E0B] rounded-xl p-4",
  green: "bg-surface shadow-sm border border-border rounded-xl p-4",
};

const DATE_CLASSES: Record<UrgencyColor, string> = {
  red: "text-[#EF4444] font-bold",
  amber: "text-[#F59E0B] font-bold",
  green: "text-slate-500",
};

/**
 * Compliance calendar: reporting deadlines, renewal compliance reports, and
 * document expirations aggregated with manually tracked obligations
 * (matching funds, regulatory filings) from compliance_requirements.
 */
export default function CompliancePage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [items, setItems] = useState<ComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/compliance");
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { data: ComplianceItem[] };
      setItems(data.data ?? []);
    } catch {
      setError("Could not load compliance obligations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markSubmitted(item: ComplianceItem) {
    if (!editable || submittingId) return;
    setSubmittingId(item.id);
    try {
      const res = await fetch("/api/compliance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.entity_id, status: "submitted" }),
      });
      if (!res.ok) {
        setError("Could not mark the requirement submitted.");
        return;
      }
      await load();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmittingId(null);
    }
  }

  const showEmpty = !loading && !error && items.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Calendar"
        description="Reporting deadlines, matching funds, regulatory filings, and document expirations across all active grants."
        actions={
          editable && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Add Requirement
            </Button>
          )
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading compliance obligations..." />
      ) : showEmpty ? (
        <EmptyState
          icon={ShieldCheck}
          title="No compliance obligations"
          description="Reporting deadlines, renewal compliance reports, document expirations, and manually tracked requirements will appear here."
          action={
            editable ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                Add Requirement
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isSubmitted = item.status === "submitted" || item.status === "completed";
            const color = urgencyColor(item.due_date);
            const { label } = urgency(item.due_date);
            const canMarkSubmitted =
              editable && item.entity_type === "requirement" && !isSubmitted;
            return (
              <div
                key={item.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3",
                  isSubmitted
                    ? "rounded-xl border border-border bg-surface p-4 shadow-sm"
                    : ITEM_CLASSES[color],
                )}
              >
                <div className="min-w-0">
                  <div
                    className={cn(
                      "truncate text-sm font-medium",
                      isSubmitted ? "text-slate-400 line-through" : "text-slate-900",
                    )}
                  >
                    {item.title}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{humanizeEnum(item.type)}</span>
                    <span>·</span>
                    <span className={isSubmitted ? undefined : DATE_CLASSES[color]}>
                      {formatDate(item.due_date)}
                    </span>
                    {item.notes && (
                      <>
                        <span>·</span>
                        <span className="truncate">{item.notes}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {isSubmitted ? (
                    <span className="text-xs text-slate-400">
                      {item.status === "submitted" ? "Submitted" : "Completed"}
                    </span>
                  ) : (
                    <Badge variant={BAND_VARIANT[urgency(item.due_date).band]}>{label}</Badge>
                  )}
                  {canMarkSubmitted && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={submittingId === item.entity_id}
                      isLoading={submittingId === item.entity_id}
                      onClick={() => markSubmitted(item)}
                    >
                      Mark Submitted
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={creating}
        onClose={() => setCreating(false)}
        title="Add Requirement"
      >
        <RequirementForm
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

function RequirementForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [requirementType, setRequirementType] = useState(REQUIREMENT_TYPE_OPTIONS[0]!.value);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim() === "") {
      setError("Title is required.");
      return;
    }
    if (dueDate.trim() === "") {
      setError("Due date is required.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await fetch("/api/compliance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        requirement_type: requirementType,
        due_date: dueDate,
        notes: notes.trim(),
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Could not save the requirement.");
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

      <Input
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Q3 matching fund verification"
        required
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Requirement type"
          value={requirementType}
          options={REQUIREMENT_TYPE_OPTIONS}
          onChange={(e) => setRequirementType(e.target.value)}
          required
        />
        <Input
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          required
        />
      </div>

      <Textarea
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional detail about this obligation"
        rows={3}
      />

      <div className="flex justify-end gap-2 border-t border-navy-200 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" isLoading={saving}>
          Add requirement
        </Button>
      </div>
    </form>
  );
}
