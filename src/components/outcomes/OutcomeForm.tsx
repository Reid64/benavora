"use client";

import { useMemo, useState, type FormEvent } from "react";

import { Badge, Button, Input, Select, Textarea } from "@/components/ui";
import type { SelectOption } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import { OUTCOME_RESULTS } from "@/lib/utils/constants";
import { formatCurrency, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

type OutcomeResult = Enums<"outcome_result">;
type FunderCategory = Enums<"funder_category">;

/** Everything the form needs about the application an outcome is recorded for. */
export type OutcomeApplicationContext = {
  id: string;
  /** Display label — the opportunity name. */
  label: string;
  /** requested_amount snapshot for the outcome (Contracts §10). */
  requestedAmount: number | null;
  /** Frozen at record time into outcomes.narrative_snapshot. */
  draftContent: string | null;
  /** Snapshotted onto the outcome for category-independent analytics. */
  funderCategory: FunderCategory | null;
  opportunityCategory: FunderCategory | null;
  /** Opportunity keywords, snapshotted for learning. */
  keywords: string[];
};

const RESULT_OPTIONS: SelectOption[] = OUTCOME_RESULTS.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

export type OutcomeFormProps = {
  application: OutcomeApplicationContext;
  /** Called after the outcome is saved (and learning is triggered). */
  onSaved?: () => void;
  onCancel?: () => void;
};

/**
 * Record an application outcome — awarded, denied, or partial — with optional
 * funder feedback (BLUEPRINT §4.10, Behavioral Contracts §10).
 *
 * organization_id and recorded_by come from the session profile, never the form
 * (Contracts §2). The submitted draft is frozen into narrative_snapshot, and
 * funder/opportunity categories plus keywords are snapshotted so analytics stay
 * independent of later edits to the source records. On a successful save it
 * triggers the Recursive Learning Agent (Agent 10), which extracts proven
 * narratives from awarded drafts and recalculates effectiveness.
 */
export function OutcomeForm({ application, onSaved, onCancel }: OutcomeFormProps) {
  const { profile, loading: profileLoading } = useProfile();

  const [result, setResult] = useState<OutcomeResult>("awarded");
  const [awardedAmount, setAwardedAmount] = useState(
    application.requestedAmount != null
      ? String(application.requestedAmount)
      : "",
  );
  const [funderFeedback, setFunderFeedback] = useState("");
  const [denialReason, setDenialReason] = useState("");

  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ awardedAmount?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [learningNote, setLearningNote] = useState<string | null>(null);

  const showAmount = result === "awarded" || result === "partial";
  const showDenialReason = result === "denied";

  const hasSnapshot = useMemo(
    () => (application.draftContent ?? "").trim() !== "",
    [application.draftContent],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldError({});
    setLearningNote(null);

    if (!profile) {
      setFormError("Your session could not be verified. Please sign in again.");
      return;
    }

    let awarded: number | null = null;
    if (showAmount) {
      const trimmed = awardedAmount.trim();
      const n = Number(trimmed);
      if (trimmed === "" || Number.isNaN(n) || n < 0) {
        setFieldError({
          awardedAmount: "Enter the awarded amount (a non-negative number).",
        });
        return;
      }
      awarded = n;
    }

    setSubmitting(true);
    const supabase = createClient();

    // One outcome per application (UNIQUE constraint). organization_id and
    // recorded_by from the session. The draft is frozen into narrative_snapshot.
    const { data, error } = await supabase
      .from("outcomes")
      .insert({
        organization_id: profile.organization_id,
        application_id: application.id,
        result,
        awarded_amount: awarded,
        requested_amount: application.requestedAmount,
        funder_feedback: funderFeedback.trim() || null,
        denial_reason: showDenialReason ? denialReason.trim() || null : null,
        narrative_snapshot: hasSnapshot ? application.draftContent : null,
        funder_category: application.funderCategory,
        opportunity_category: application.opportunityCategory,
        keywords_used:
          application.keywords.length > 0 ? application.keywords : null,
        recorded_by: profile.id,
      })
      .select("id")
      .single();

    if (error || !data) {
      setSubmitting(false);
      // 23505 = unique_violation: an outcome already exists for this application.
      setFormError(
        error?.code === "23505"
          ? "An outcome has already been recorded for this application."
          : (error?.message ?? "Could not record the outcome."),
      );
      return;
    }

    // Trigger the Recursive Learning Agent (Agent 10). Best-effort: the outcome
    // is already saved, so a learning failure must not block the user.
    try {
      const res = await fetch("/api/agents/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcomeId: data.id }),
      });
      if (!res.ok) {
        setLearningNote(
          "Outcome saved. The learning step could not run automatically — it can be retried later.",
        );
      }
    } catch {
      setLearningNote(
        "Outcome saved. The learning step could not run automatically — it can be retried later.",
      );
    }

    setSubmitting(false);
    onSaved?.();
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

      <div className="rounded-lg border border-navy-200 bg-navy-50 px-4 py-3 text-sm">
        <div className="font-medium text-navy-900">{application.label}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-navy-500">
          <span>Requested: {formatCurrency(application.requestedAmount)}</span>
          {application.funderCategory && (
            <span>Funder: {humanizeEnum(application.funderCategory)}</span>
          )}
          <Badge color={hasSnapshot ? "green" : "gray"}>
            {hasSnapshot ? "Draft will be snapshotted" : "No draft to snapshot"}
          </Badge>
        </div>
      </div>

      <Select
        label="Outcome"
        required
        options={RESULT_OPTIONS}
        value={result}
        onChange={(e) => setResult(e.target.value as OutcomeResult)}
        helperText="Awarded and partial outcomes feed the learning system."
      />

      {showAmount && (
        <Input
          label={result === "partial" ? "Amount awarded (partial)" : "Amount awarded"}
          type="number"
          min={0}
          step="100"
          required
          value={awardedAmount}
          onChange={(e) => setAwardedAmount(e.target.value)}
          error={fieldError.awardedAmount}
          helperText={
            result === "partial"
              ? "Less than the requested amount."
              : undefined
          }
        />
      )}

      {showDenialReason && (
        <Input
          label="Denial reason"
          value={denialReason}
          onChange={(e) => setDenialReason(e.target.value)}
          placeholder="e.g. Out of geographic scope, budget exhausted"
          helperText="Categorized reason — surfaced in denial-pattern analytics."
        />
      )}

      <Textarea
        label="Funder feedback"
        value={funderFeedback}
        onChange={(e) => setFunderFeedback(e.target.value)}
        placeholder="Any feedback the funder provided (optional)."
        rows={3}
      />

      {learningNote && (
        <p className="text-sm text-amber-600">{learningNote}</p>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-navy-200 pt-5">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          isLoading={submitting || profileLoading}
          disabled={profileLoading}
        >
          Record outcome
        </Button>
      </div>
    </form>
  );
}
