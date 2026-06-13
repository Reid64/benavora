"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Loader2,
  Lock,
  XCircle,
} from "lucide-react";

import { Badge, Button, Modal, Select, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database";
import {
  STAGE_COLOR,
  STAGE_LABEL,
  allowedTargets,
  canMoveToStage,
  evaluateCondition,
  executeTransition,
  getTransitionRule,
  isRecurring,
  type EnrichedApplication,
  type PipelineStage,
} from "@/components/applications/pipeline";

export type StageTransitionModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** The application being moved (enriched with the data the gates need). */
  application: EnrichedApplication | null;
  /** Pre-selected destination (e.g. from a board drag). Null lets the user choose. */
  initialTargetStage?: PipelineStage | null;
  /** Acting user's role - gates the "submitted" stage. */
  role: Tables<"profiles">["role"] | undefined;
  /** Acting user's profile id, recorded as pipeline_history.changed_by. */
  changedBy: string | null;
  /** Called after a successful transition so the caller can refresh. */
  onComplete: () => void;
};

/**
 * Drives a single stage transition, enforcing the rules in BEHAVIORAL_CONTRACTS
 * §6: the allowed-transition graph, per-edge conditions, the owner/admin gate on
 * "submitted", and mandatory notes on backward moves. On confirm it delegates to
 * executeTransition, which writes the stage change and the pipeline_history row.
 */
export function StageTransitionModal({
  isOpen,
  onClose,
  application,
  initialTargetStage = null,
  role,
  changedBy,
  onComplete,
}: StageTransitionModalProps) {
  const [target, setTarget] = useState<PipelineStage | "">("");
  const [note, setNote] = useState("");
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compliance check state - populated when target === "submitted".
  const [complianceReport, setComplianceReport] = useState<{
    passed: boolean;
    blocking_issues: string[];
    warnings: string[];
  } | null>(null);
  const [complianceChecking, setComplianceChecking] = useState(false);
  const [complianceCheckError, setComplianceCheckError] = useState<
    string | null
  >(null);

  // Reset transient state whenever the modal opens or its subject changes.
  useEffect(() => {
    if (isOpen) {
      setTarget(initialTargetStage ?? "");
      setNote("");
      setManualConfirmed(false);
      setError(null);
      setSubmitting(false);
      setComplianceReport(null);
      setComplianceChecking(false);
      setComplianceCheckError(null);
    }
  }, [isOpen, initialTargetStage, application?.id]);

  // Auto-run compliance check when target becomes "submitted".
  // The compliance_check condition is always set on the ready_for_review ->
  // submitted edge, so checking target === "submitted" is sufficient.
  useEffect(() => {
    setComplianceReport(null);
    setComplianceCheckError(null);

    if (!isOpen || target !== "submitted" || !application) {
      setComplianceChecking(false);
      return;
    }

    setComplianceChecking(true);
    fetch("/api/compliance/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application_id: application.id }),
    })
      .then((res) => res.json())
      .then(
        (json: {
          data?: { passed: boolean; blocking_issues: string[]; warnings: string[] };
          error?: string;
        }) => {
          setComplianceReport(json.data ?? null);
          if (!json.data) {
            setComplianceCheckError(
              json.error ?? "Compliance check failed.",
            );
          }
        },
      )
      .catch(() =>
        setComplianceCheckError("Could not run compliance check."),
      )
      .finally(() => setComplianceChecking(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, target, application?.id]);

  const from = application?.stage ?? null;

  const targetOptions = useMemo(() => {
    if (!from) return [];
    return allowedTargets(from).map(({ stage }) => ({
      value: stage,
      label: STAGE_LABEL[stage],
    }));
  }, [from]);

  if (!application || !from) return null;

  const rule = target ? getTransitionRule(from, target) : null;
  const condition = rule?.condition ?? "none";

  const conditionResult =
    target && rule?.allowed
      ? evaluateCondition(condition, {
          eligibilityScore: application.eligibilityScore,
          draftContent: application.draft_content,
          requiredDocumentCount: application.requiredDocumentCount,
          attachedDocumentCount: application.attachedDocumentCount,
          opportunityRecurring: isRecurring(application.recurrence),
        })
      : null;

  const roleAllowed = target ? canMoveToStage(target, role) : true;
  const requiresNote = rule?.requiresNote ?? false;
  const noteOk = !requiresNote || note.trim().length > 0;

  // compliance_check is enforced by the real API result; all other conditions
  // use the local evaluateCondition result (data-backed or manual checkbox).
  const conditionOk =
    condition === "compliance_check"
      ? complianceReport?.passed === true
      : conditionResult
        ? conditionResult.manual
          ? manualConfirmed
          : conditionResult.met
        : true;

  const canConfirm =
    !!target &&
    !!rule?.allowed &&
    roleAllowed &&
    conditionOk &&
    noteOk &&
    !submitting &&
    !complianceChecking;

  async function handleConfirm() {
    if (!target || !rule?.allowed || !application) return;
    setSubmitting(true);
    setError(null);
    try {
      await executeTransition({
        supabase: createClient(),
        application,
        target,
        condition,
        changedBy,
        note: note,
      });
      setSubmitting(false);
      onComplete();
      onClose();
    } catch (err) {
      setSubmitting(false);
      setError(
        err instanceof Error ? err.message : "Could not move the application.",
      );
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Move application"
      description={application.opportunityName ?? undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            isLoading={submitting}
            disabled={!canConfirm}
          >
            Confirm move
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* From -> To summary */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge color={STAGE_COLOR[from]}>{STAGE_LABEL[from]}</Badge>
          <ArrowRight className="h-4 w-4 text-navy-400" aria-hidden />
          {target ? (
            <Badge color={STAGE_COLOR[target]}>{STAGE_LABEL[target]}</Badge>
          ) : (
            <span className="text-navy-400">Select a destination</span>
          )}
        </div>

        <Select
          label="Move to stage"
          placeholder="Select a stage..."
          value={target}
          onChange={(e) => setTarget(e.target.value as PipelineStage)}
          options={targetOptions}
          helperText="Only valid destinations for the current stage are listed."
        />

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {/* Rule violation: forward jump that skips stages. */}
        {target && rule && !rule.allowed && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{rule.reason}</span>
          </div>
        )}

        {/* Role gate on submitted. */}
        {target && rule?.allowed && !roleAllowed && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Only an owner or admin can move an application to{" "}
              <span className="font-medium">{STAGE_LABEL.submitted}</span>.
            </span>
          </div>
        )}

        {/* Backward move notice. */}
        {target && rule?.allowed && rule.direction === "backward" && (
          <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2.5 text-sm text-yellow-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              This moves the application backward. A note explaining why is
              required.
            </span>
          </div>
        )}

        {/* Data-backed condition not met. */}
        {target &&
          rule?.allowed &&
          roleAllowed &&
          conditionResult &&
          !conditionResult.manual &&
          !conditionResult.met && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2.5 text-sm text-yellow-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{conditionResult.unmetMessage}</span>
            </div>
          )}

        {/* Compliance check gate - real API result, not a manual checkbox. */}
        {target === "submitted" &&
          rule?.allowed &&
          roleAllowed &&
          condition === "compliance_check" && (
            <div className="space-y-2 rounded-lg border border-navy-200 bg-navy-50 px-3 py-3">
              {complianceChecking && (
                <div className="flex items-center gap-2 text-sm text-navy-600">
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden
                  />
                  Running compliance check...
                </div>
              )}
              {complianceCheckError && !complianceChecking && (
                <p className="text-sm text-red-600">{complianceCheckError}</p>
              )}
              {complianceReport && !complianceChecking && (
                <>
                  <div
                    className={
                      "flex items-center gap-2 text-sm font-medium " +
                      (complianceReport.passed
                        ? "text-green-700"
                        : "text-red-700")
                    }
                  >
                    {complianceReport.passed ? (
                      <CheckCircle className="h-4 w-4 shrink-0" aria-hidden />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                    {complianceReport.passed
                      ? "Compliance check passed."
                      : "Compliance check failed - resolve issues before submitting."}
                  </div>
                  {complianceReport.blocking_issues.length > 0 && (
                    <ul className="space-y-0.5 pl-6 text-sm text-red-700 list-disc">
                      {complianceReport.blocking_issues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  )}
                  {complianceReport.warnings.length > 0 && (
                    <ul className="space-y-0.5 pl-6 text-sm text-yellow-700 list-disc">
                      {complianceReport.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

        {/* Manual condition: explicit confirmation (report_submitted etc.). */}
        {target &&
          rule?.allowed &&
          roleAllowed &&
          conditionResult?.manual &&
          condition !== "compliance_check" && (
            <label className="flex items-start gap-2.5 rounded-lg border border-navy-200 bg-navy-50 px-3 py-2.5 text-sm text-navy-700">
              <input
                type="checkbox"
                checked={manualConfirmed}
                onChange={(e) => setManualConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
              />
              <span>
                I confirm: {conditionResult.label.toLowerCase()}.
              </span>
            </label>
          )}

        {/* Informational note for the new-cycle edge. */}
        {target &&
          rule?.allowed &&
          condition === "creates_new_application" && (
            <p className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2.5 text-sm text-teal-800">
              This starts a new application in “{STAGE_LABEL.discovered}” for the
              same opportunity. The current application stays in “
              {STAGE_LABEL.renewal_opportunity}”.
            </p>
          )}

        <Textarea
          label={requiresNote ? "Reason for this move" : "Note (optional)"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder={
            requiresNote
              ? "Explain why this application is moving backward."
              : "Add context for this transition. Recorded in the application history."
          }
          required={requiresNote}
        />
      </div>
    </Modal>
  );
}
