"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CircleCheck,
  ExternalLink,
  RotateCw,
  TriangleAlert,
  XCircle,
} from "lucide-react";

import { Badge, Button, Card, LoadingSpinner } from "@/components/ui";
import { ApprovalWorkflow } from "@/components/automation/ApprovalWorkflow";
import type { ApprovalPhase } from "@/components/automation/ApprovalWorkflow";
import { FieldReport } from "@/components/automation/FieldReport";
import { ScreenshotViewer } from "@/components/automation/ScreenshotViewer";
import {
  STATUS_COLOR,
  STATUS_LABEL,
  STEP_STATUS_COLOR,
  STEP_STATUS_LABEL,
  buildFieldReport,
  isAwaitingApproval,
  type SessionDetailResponse,
} from "@/components/automation/automation";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { formatRelative, humanizeEnum } from "@/lib/utils/formatters";

/** Poll while the session is still mid-run so steps/screenshots stream in. */
const POLL_INTERVAL_MS = 4000;

/**
 * Automation session detail (BLUEPRINT §Phase 3). Shows the step-by-step
 * timeline, the screenshot gallery, the form-field report (with editable inputs
 * for unmapped fields), and — while the session awaits approval — the human
 * approval workflow that gates submission (BEHAVIORAL_CONTRACTS §18). After
 * submission it shows the confirmation number and screenshots.
 *
 * All reads/writes go through the org-scoped API routes; this client never
 * sends an organization id. Approving requires owner/admin (Contracts §6, §18).
 */
export default function AutomationSessionPage({
  params,
}: {
  params: { sessionId: string };
}) {
  const router = useRouter();
  const sessionId = params.sessionId;

  const { profile } = useProfile();
  const editable = canEdit(profile?.role);
  const canApprove = profile?.role === "owner" || profile?.role === "admin";

  const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
  const [funderName, setFunderName] = useState<string | null>(null);
  const [opportunityName, setOpportunityName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [savingFields, setSavingFields] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadNames = useCallback(
    async (funderId: string | null, opportunityId: string | null) => {
      const supabase = createClient();
      const [funderRes, oppRes] = await Promise.all([
        funderId
          ? supabase.from("funders").select("name").eq("id", funderId).maybeSingle()
          : Promise.resolve({ data: null }),
        opportunityId
          ? supabase
              .from("opportunities")
              .select("name")
              .eq("id", opportunityId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      setFunderName((funderRes.data?.name as string | undefined) ?? null);
      setOpportunityName((oppRes.data?.name as string | undefined) ?? null);
    },
    [],
  );

  const load = useCallback(
    async (initial: boolean) => {
      if (initial) setLoading(true);
      try {
        const res = await fetch(`/api/agents/automation/${sessionId}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          setError("Could not load this automation session.");
          return;
        }
        const data = (await res.json()) as SessionDetailResponse;
        setDetail(data);
        setError(null);
        await loadNames(data.session.funder_id, data.session.opportunity_id);
      } catch {
        setError("Could not reach the server. Please try again.");
      } finally {
        if (initial) setLoading(false);
      }
    },
    [sessionId, loadNames],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const session = detail?.session ?? null;
  const status = session?.status;
  const isLive = status === "pending" || status === "in_progress";

  useEffect(() => {
    if (!isLive) return;
    const timer = setInterval(() => void load(false), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isLive, load]);

  const fieldRows = useMemo(
    () => (session ? buildFieldReport(session) : []),
    [session],
  );

  const fieldsEditable =
    editable && session !== null && isAwaitingApproval(session.status);

  /** Save any human-entered values to the session (PUT update_fields). */
  const saveFields = useCallback(async (): Promise<boolean> => {
    const fieldValues = Object.entries(manualValues)
      .filter(([, value]) => value.trim() !== "")
      .map(([selector, value]) => ({ selector, value }));
    if (fieldValues.length === 0) return true;

    setSavingFields(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/agents/automation/${sessionId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update_fields", fieldValues }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setSaveError(payload.error ?? "Could not save the entered values.");
        return false;
      }
      setManualValues({});
      await load(false);
      return true;
    } catch {
      setSaveError("Could not save the entered values. Please try again.");
      return false;
    } finally {
      setSavingFields(false);
    }
  }, [manualValues, sessionId, load]);

  async function handleApprove() {
    setSubmitError(null);
    // Flush any entered field values before submitting so they get typed in.
    const saved = await saveFields();
    if (!saved) {
      setSubmitError("Resolve the field errors above before approving.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/agents/automation/${sessionId}/approve`,
        { method: "POST" },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setSubmitError(payload.error ?? "Submission failed. Please try again.");
        return;
      }
      await load(false);
    } catch {
      setSubmitError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    setActionError(null);
    setRejecting(true);
    try {
      const res = await fetch(`/api/agents/automation/${sessionId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "reject",
          notes: "Rejected by reviewer.",
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setActionError(payload.error ?? "Could not cancel the session.");
        return;
      }
      await load(false);
    } catch {
      setActionError("Could not reach the server. Please try again.");
    } finally {
      setRejecting(false);
    }
  }

  async function handleRerun() {
    if (!session?.application_id) {
      setActionError("This session is not linked to an application to re-run.");
      return;
    }
    setActionError(null);
    setRerunning(true);
    try {
      const res = await fetch("/api/agents/automation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ applicationId: session.application_id }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        sessionId?: string;
        error?: string;
      };
      if (!res.ok) {
        setActionError(payload.error ?? "Could not start a new session.");
        return;
      }
      if (payload.sessionId) router.push(`/automation/${payload.sessionId}`);
    } catch {
      setActionError("Could not reach the automation agent. Please try again.");
    } finally {
      setRerunning(false);
    }
  }

  if (loading) {
    return (
      <div className="py-20">
        <LoadingSpinner center label="Loading session…" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6">
        <BackLink onClick={() => router.push("/automation")} />
        <Card>
          <p className="text-sm text-navy-600">
            This automation session could not be found, or it belongs to another
            organization.
          </p>
        </Card>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="space-y-6">
        <BackLink onClick={() => router.push("/automation")} />
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error ?? "This automation session is unavailable."}
        </div>
      </div>
    );
  }

  const phase = resolvePhase(session.status, submitting);
  const isSubmitted = session.status === "submitted";
  const awaiting = isAwaitingApproval(session.status);

  return (
    <div className="space-y-6">
      <BackLink onClick={() => router.push("/automation")} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-navy-900">
              {opportunityName ?? "Automation session"}
            </h1>
            <Badge color={STATUS_COLOR[session.status]} withDot>
              {STATUS_LABEL[session.status]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-navy-500">
            {funderName ? `${funderName} · ` : ""}
            Started {formatRelative(session.started_at ?? session.created_at)}
          </p>
          {session.target_url && (
            <a
              href={session.target_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm text-teal-600 hover:text-teal-700"
            >
              {session.target_url}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {editable && session.application_id && (
            <Button
              variant="secondary"
              onClick={handleRerun}
              isLoading={rerunning}
            >
              <RotateCw className="h-4 w-4" aria-hidden />
              Re-run
            </Button>
          )}
          {editable && awaiting && (
            <Button variant="danger" onClick={handleReject} isLoading={rejecting}>
              <XCircle className="h-4 w-4" aria-hidden />
              Reject &amp; Cancel
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {actionError}
        </div>
      )}

      {session.error_message && session.status === "failed" && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span className="font-medium">Automation failed:</span>{" "}
          {session.error_message}
        </div>
      )}

      {awaiting && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>
            Review all filled fields carefully before approving submission. The
            automation will not submit until you approve.
          </span>
        </div>
      )}

      {/* Confirmation after submission */}
      {isSubmitted && (
        <Card>
          <div className="flex items-start gap-3">
            <CircleCheck
              className="mt-0.5 h-6 w-6 shrink-0 text-green-500"
              aria-hidden
            />
            <div>
              <h2 className="text-sm font-semibold text-navy-900">
                Submitted successfully
              </h2>
              <p className="mt-0.5 text-sm text-navy-600">
                Confirmation number:{" "}
                <span className="font-mono font-medium text-navy-900">
                  {session.confirmation_number ?? "—"}
                </span>
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Approval workflow (only while awaiting approval / submitting / done) */}
      {(awaiting || session.status === "approved" || isSubmitted) && (
        <Card title="Approval">
          <ApprovalWorkflow
            phase={phase}
            canApprove={canApprove}
            onApprove={handleApprove}
            submitting={submitting}
            error={submitError}
          />
        </Card>
      )}

      {/* Field report */}
      <Card
        title="Form fields"
        description="What the automation filled, and what needs your input."
      >
        <FieldReport
          rows={fieldRows}
          editable={fieldsEditable}
          manualValues={manualValues}
          onManualValueChange={(selector, value) =>
            setManualValues((prev) => ({ ...prev, [selector]: value }))
          }
          onSave={saveFields}
          saving={savingFields}
          saveError={saveError}
        />
      </Card>

      {/* Screenshots */}
      <Card title="Screenshots">
        <ScreenshotViewer
          screenshots={detail?.screenshots ?? []}
          organizationId={session.organization_id}
        />
      </Card>

      {/* Step timeline */}
      <Card title="Timeline">
        <Timeline steps={detail?.steps ?? []} />
      </Card>
    </div>
  );
}

/** Derive the approval step indicator phase from session status. */
function resolvePhase(
  status: SessionDetailResponse["session"]["status"],
  submitting: boolean,
): ApprovalPhase {
  if (status === "submitted") return "confirmed";
  if (submitting || status === "approved") return "submitting";
  return "review";
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-500 transition hover:text-navy-800 focus:outline-none focus-visible:text-navy-800"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back to automation
    </button>
  );
}

/** Vertical step-by-step timeline of the session's automation_steps. */
function Timeline({
  steps,
}: {
  steps: SessionDetailResponse["steps"];
}) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-navy-500">No steps recorded for this session.</p>
    );
  }
  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li key={step.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-600">
              {step.step_number || i + 1}
            </span>
            {i < steps.length - 1 && (
              <span className="mt-1 w-px flex-1 bg-navy-200" aria-hidden />
            )}
          </div>
          <div className="flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-navy-900">
                {humanizeEnum(step.action)}
              </span>
              <Badge color={STEP_STATUS_COLOR[step.status]}>
                {STEP_STATUS_LABEL[step.status]}
              </Badge>
              {step.duration_ms != null && (
                <span className="text-xs text-navy-400">
                  {step.duration_ms} ms
                </span>
              )}
            </div>
            {step.description && (
              <p className="mt-0.5 text-sm text-navy-600">{step.description}</p>
            )}
            {step.error_message && (
              <p className="mt-0.5 text-sm text-red-600">{step.error_message}</p>
            )}
            <p className="mt-0.5 text-xs text-navy-400">
              {formatRelative(step.created_at)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
