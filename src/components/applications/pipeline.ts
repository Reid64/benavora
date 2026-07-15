import { differenceInCalendarDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CSSProperties } from "react";

import type { BadgeColor } from "@/components/ui";
import { recordAudit } from "@/lib/audit/client";
import { PIPELINE_STAGES } from "@/lib/utils/constants";
import type { Enums, Tables } from "@/types/database";

/**
 * Shared pipeline logic for the Applications feature (BLUEPRINT §4.5).
 *
 * The single source of truth for stage labels, the allowed stage-transition
 * graph (BEHAVIORAL_CONTRACTS §6), and the data loader the board and list views
 * share. Centralising the transition rules here keeps the board, the detail
 * view, and the StageTransitionModal in agreement, and keeps the guarantee that
 * "every transition creates a pipeline_history record" in one place
 * (executeTransition).
 */

export type PipelineStage = Enums<"pipeline_stage">;

/** Display labels for each stage. */
export const STAGE_LABEL: Record<PipelineStage, string> = {
  discovered: "Discovered",
  eligibility_review: "Eligibility Review",
  qualified: "Qualified",
  drafting: "Drafting",
  awaiting_documents: "Awaiting Documents",
  ready_for_review: "Ready for Review",
  submitted: "Submitted",
  follow_up_due: "Follow-up Due",
  awarded: "Awarded",
  denied: "Denied",
  reporting_required: "Reporting Required",
  renewal_opportunity: "Renewal Opportunity",
};

/** Badge color per stage, grouping by lifecycle phase. */
export const STAGE_COLOR: Record<PipelineStage, BadgeColor> = {
  discovered: "gray",
  eligibility_review: "gray",
  qualified: "indigo",
  drafting: "indigo",
  awaiting_documents: "yellow",
  ready_for_review: "yellow",
  submitted: "blue",
  follow_up_due: "blue",
  awarded: "green",
  denied: "red",
  reporting_required: "indigo",
  renewal_opportunity: "indigo",
};

/**
 * Elevated Slate stage pills for the Applications page. Every stage collapses
 * into one of five lifecycle families (Discovery, Eligibility Review, Applied,
 * Awarded, Rejected) so the pipeline reads as five colors, not twelve — the
 * granular STAGE_LABEL text is still shown, only the color family is coarser.
 */
const STAGE_PILL_CLASSES: Record<PipelineStage, string> = {
  discovered:
    "bg-[#DBEAFE] text-[#1D4ED8] px-3 py-1 rounded-full text-xs font-semibold",
  eligibility_review:
    "bg-[#FEF3C7] text-[#92400E] px-3 py-1 rounded-full text-xs font-semibold",
  qualified:
    "bg-[#EDE9FE] text-[#6D28D9] px-3 py-1 rounded-full text-xs font-semibold",
  drafting:
    "bg-[#EDE9FE] text-[#6D28D9] px-3 py-1 rounded-full text-xs font-semibold",
  awaiting_documents:
    "bg-[#EDE9FE] text-[#6D28D9] px-3 py-1 rounded-full text-xs font-semibold",
  ready_for_review:
    "bg-[#EDE9FE] text-[#6D28D9] px-3 py-1 rounded-full text-xs font-semibold",
  submitted:
    "bg-[#EDE9FE] text-[#6D28D9] px-3 py-1 rounded-full text-xs font-semibold",
  follow_up_due:
    "bg-[#EDE9FE] text-[#6D28D9] px-3 py-1 rounded-full text-xs font-semibold",
  awarded:
    "bg-[#DCFCE7] text-[#15803D] px-3 py-1 rounded-full text-xs font-semibold",
  reporting_required:
    "bg-[#DCFCE7] text-[#15803D] px-3 py-1 rounded-full text-xs font-semibold",
  renewal_opportunity:
    "bg-[#DCFCE7] text-[#15803D] px-3 py-1 rounded-full text-xs font-semibold",
  denied:
    "bg-[#FEE2E2] text-[#B91C1C] px-3 py-1 rounded-full text-xs font-semibold",
};

/** Tailwind classes for a stage's Elevated Slate pill (color only — pair with STAGE_LABEL for text). */
export function stagePillClassName(stage: PipelineStage): string {
  return STAGE_PILL_CLASSES[stage];
}

/** Inline-style equivalent of STAGE_PILL_CLASSES, guaranteed to render regardless of utility-class overrides. */
const STAGE_PILL_STYLE: Record<PipelineStage, CSSProperties> = {
  discovered: { backgroundColor: "#DBEAFE", color: "#1D4ED8" },
  eligibility_review: { backgroundColor: "#FEF3C7", color: "#92400E" },
  qualified: { backgroundColor: "#EDE9FE", color: "#6D28D9" },
  drafting: { backgroundColor: "#EDE9FE", color: "#6D28D9" },
  awaiting_documents: { backgroundColor: "#EDE9FE", color: "#6D28D9" },
  ready_for_review: { backgroundColor: "#EDE9FE", color: "#6D28D9" },
  submitted: { backgroundColor: "#EDE9FE", color: "#6D28D9" },
  follow_up_due: { backgroundColor: "#EDE9FE", color: "#6D28D9" },
  awarded: { backgroundColor: "#DCFCE7", color: "#15803D" },
  reporting_required: { backgroundColor: "#DCFCE7", color: "#15803D" },
  renewal_opportunity: { backgroundColor: "#DCFCE7", color: "#15803D" },
  denied: { backgroundColor: "#FEE2E2", color: "#B91C1C" },
};

/** Inline style for a stage's pill background/text color (see STAGE_PILL_STYLE). */
export function stagePillStyle(stage: PipelineStage): CSSProperties {
  return STAGE_PILL_STYLE[stage];
}

/**
 * Premium-UI badge class per stage, matching the four named lifecycle families
 * (Discovery/Applied/Awarded/Rejected). "Eligibility Review" has no requested
 * color, so it gets none rather than an invented one.
 */
const STAGE_PILL_BADGE_CLASS: Partial<Record<PipelineStage, string>> = {
  discovered: "badge-blue",
  qualified: "badge-violet",
  drafting: "badge-violet",
  awaiting_documents: "badge-violet",
  ready_for_review: "badge-violet",
  submitted: "badge-violet",
  follow_up_due: "badge-violet",
  awarded: "badge-green",
  reporting_required: "badge-green",
  renewal_opportunity: "badge-green",
  denied: "badge-red",
};

/** Premium-UI badge class for a stage's pill, or undefined if none is defined. */
export function stagePillBadgeClass(stage: PipelineStage): string | undefined {
  return STAGE_PILL_BADGE_CLASS[stage];
}

/** True when a deadline is within a week (or past) — the "urgent" threshold for Elevated Slate deadline styling. */
export function isUrgentDeadline(deadline: string): boolean {
  return differenceInCalendarDays(new Date(deadline), new Date()) < 7;
}

/**
 * Conditions gating a forward transition (BEHAVIORAL_CONTRACTS §6). "manual"
 * conditions (compliance_check, report_submitted) have no stored field in the
 * MVP schema, so the modal requires an explicit confirmation instead of
 * fabricating a result.
 */
export type TransitionCondition =
  | "none"
  | "eligibility_score_exists"
  | "draft_not_empty"
  | "documents_attached"
  | "compliance_check"
  | "opportunity_recurring"
  | "report_submitted"
  | "creates_new_application";

type ForwardEdge = { to: PipelineStage; condition: TransitionCondition };

/**
 * The forward transition graph, transcribed directly from the stage-transition
 * table in BEHAVIORAL_CONTRACTS §6. Any forward move not listed here is a
 * stage-skip and is rejected.
 */
const FORWARD: Record<PipelineStage, ForwardEdge[]> = {
  discovered: [{ to: "eligibility_review", condition: "none" }],
  eligibility_review: [
    { to: "qualified", condition: "eligibility_score_exists" },
    { to: "denied", condition: "eligibility_score_exists" },
  ],
  qualified: [{ to: "drafting", condition: "none" }],
  drafting: [{ to: "awaiting_documents", condition: "draft_not_empty" }],
  awaiting_documents: [
    { to: "ready_for_review", condition: "documents_attached" },
  ],
  ready_for_review: [{ to: "submitted", condition: "compliance_check" }],
  submitted: [
    { to: "follow_up_due", condition: "none" },
    { to: "awarded", condition: "none" },
    { to: "denied", condition: "none" },
  ],
  follow_up_due: [
    { to: "awarded", condition: "none" },
    { to: "denied", condition: "none" },
  ],
  awarded: [{ to: "reporting_required", condition: "none" }],
  // Reapply: moves the existing application back to discovered, recurring only.
  denied: [{ to: "discovered", condition: "opportunity_recurring" }],
  reporting_required: [
    { to: "renewal_opportunity", condition: "report_submitted" },
  ],
  // New cycle: spawns a fresh application rather than moving this one.
  renewal_opportunity: [{ to: "discovered", condition: "creates_new_application" }],
};

/** Position of a stage in the canonical linear order. */
export function stageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

export type TransitionRule = {
  allowed: boolean;
  direction: "forward" | "backward";
  condition: TransitionCondition;
  /** Backward moves always require an explanatory note (BEHAVIORAL_CONTRACTS §6). */
  requiresNote: boolean;
  /** Populated when allowed is false. */
  reason?: string;
};

/**
 * Resolves the rule for moving `from` -> `to`.
 *
 * Forward edges come from the explicit graph (with their condition). Any move
 * to an earlier stage in the linear order is treated as a backward transition,
 * which is allowed but requires a mandatory note. Everything else (a forward
 * jump that skips stages) is rejected.
 */
export function getTransitionRule(
  from: PipelineStage,
  to: PipelineStage,
): TransitionRule {
  if (from === to) {
    return {
      allowed: false,
      direction: "forward",
      condition: "none",
      requiresNote: false,
      reason: "The application is already in this stage.",
    };
  }

  const forward = FORWARD[from].find((edge) => edge.to === to);
  if (forward) {
    return {
      allowed: true,
      direction: "forward",
      condition: forward.condition,
      requiresNote: false,
    };
  }

  if (stageIndex(to) < stageIndex(from)) {
    return {
      allowed: true,
      direction: "backward",
      condition: "none",
      requiresNote: true,
    };
  }

  return {
    allowed: false,
    direction: "forward",
    condition: "none",
    requiresNote: false,
    reason: `Applications can't skip stages. From “${STAGE_LABEL[from]}” you can only advance to ${FORWARD[
      from
    ]
      .map((edge) => `“${STAGE_LABEL[edge.to]}”`)
      .join(", ")}.`,
  };
}

/** Every stage reachable from `from` (forward edges plus any backward move). */
export function allowedTargets(
  from: PipelineStage,
): { stage: PipelineStage; rule: TransitionRule }[] {
  return PIPELINE_STAGES.map((stage) => ({
    stage,
    rule: getTransitionRule(from, stage),
  })).filter((entry) => entry.rule.allowed);
}

/** Only owner/admin may move an application to "submitted" (BEHAVIORAL_CONTRACTS §6). */
export function canMoveToStage(
  target: PipelineStage,
  role: Tables<"profiles">["role"] | undefined,
): boolean {
  if (target === "submitted") {
    return role === "owner" || role === "admin";
  }
  return true;
}

/** Recurrence values that make an opportunity eligible for reapply/renewal. */
export function isRecurring(recurrence: string | null): boolean {
  return (
    recurrence === "annual" ||
    recurrence === "quarterly" ||
    recurrence === "rolling"
  );
}

export type TransitionContext = {
  eligibilityScore: number | null;
  draftContent: string | null;
  requiredDocumentCount: number;
  attachedDocumentCount: number;
  opportunityRecurring: boolean;
};

export type ConditionResult = {
  /** Whether the condition is satisfied by the current data. */
  met: boolean;
  /** True when satisfaction must be confirmed by the user (no stored field). */
  manual: boolean;
  /** Short label describing the gate. */
  label: string;
  /** Why the condition is not met (for the data-backed gates). */
  unmetMessage?: string;
};

/** Evaluates a forward transition's condition against the application context. */
export function evaluateCondition(
  condition: TransitionCondition,
  ctx: TransitionContext,
): ConditionResult {
  switch (condition) {
    case "none":
      return { met: true, manual: false, label: "" };
    case "eligibility_score_exists":
      return {
        met: ctx.eligibilityScore != null,
        manual: false,
        label: "Eligibility score must exist",
        unmetMessage:
          "This opportunity has no eligibility score yet. The Eligibility Scoring Agent must score it before it can be qualified or denied.",
      };
    case "draft_not_empty":
      return {
        met: !!ctx.draftContent && ctx.draftContent.trim().length > 0,
        manual: false,
        label: "Draft content must not be empty",
        unmetMessage:
          "Add draft content to the application before moving it to Awaiting Documents.",
      };
    case "documents_attached":
      return {
        met:
          ctx.requiredDocumentCount === 0 ||
          ctx.attachedDocumentCount >= ctx.requiredDocumentCount,
        manual: false,
        label: "All required documents attached",
        unmetMessage: `Attach all required documents first (${ctx.attachedDocumentCount}/${ctx.requiredDocumentCount} attached).`,
      };
    case "opportunity_recurring":
      return {
        met: ctx.opportunityRecurring,
        manual: false,
        label: "Opportunity must be recurring",
        unmetMessage:
          "Only recurring opportunities can be reapplied. This opportunity is one-time.",
      };
    case "compliance_check":
      return {
        met: false,
        manual: true,
        label: "Compliance check must pass",
      };
    case "report_submitted":
      return {
        met: false,
        manual: true,
        label: "Report must be submitted",
      };
    case "creates_new_application":
      return {
        met: true,
        manual: false,
        label: "Starts a new application for the next funding cycle",
      };
  }
}

/** An application enriched with the joined data the board, list, and modal need. */
export type EnrichedApplication = Tables<"applications"> & {
  opportunityName: string | null;
  funderName: string | null;
  deadline: string | null;
  eligibilityScore: number | null;
  recurrence: string | null;
  requiredDocumentCount: number;
  attachedDocumentCount: number;
  /** When the application entered its current stage (last history row, else created_at). */
  stageEnteredAt: string;
  /** Latest success probability score from Agent 22, or null if not yet calculated. */
  probabilityScore: number | null;
};

/**
 * Loads all applications for the organization, enriched with opportunity, funder,
 * required/attached document counts, and the timestamp the application entered
 * its current stage. Reads are RLS-scoped to the organization, so no
 * organization_id filter is needed client-side. Throws on the primary query
 * failure so callers can surface an error.
 */
export async function loadPipelineApplications(
  supabase: SupabaseClient,
): Promise<EnrichedApplication[]> {
  const [appsRes, oppsRes, fundersRes, historyRes, appDocsRes, probRes] =
    await Promise.all([
      supabase
        .from("applications")
        .select("*")
        .order("updated_at", { ascending: false }),
      supabase
        .from("opportunities")
        .select(
          "id, name, funder_id, deadline, eligibility_score, recurrence, required_documents",
        ),
      supabase.from("funders").select("id, name"),
      // Descending so the first row seen per application is its latest transition.
      supabase
        .from("pipeline_history")
        .select("application_id, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("application_documents").select("application_id"),
      supabase
        .from("success_probability_scores")
        .select("application_id, probability_score"),
    ]);

  if (appsRes.error) {
    throw new Error(appsRes.error.message);
  }

  type OppLite = {
    id: string;
    name: string;
    funder_id: string | null;
    deadline: string | null;
    eligibility_score: number | null;
    recurrence: string | null;
    required_documents: string[] | null;
  };

  const opps = new Map<string, OppLite>();
  for (const opp of (oppsRes.data ?? []) as OppLite[]) {
    opps.set(opp.id, opp);
  }

  const funderNames = new Map<string, string>();
  for (const funder of (fundersRes.data ?? []) as {
    id: string;
    name: string;
  }[]) {
    funderNames.set(funder.id, funder.name);
  }

  const stageEnteredAt = new Map<string, string>();
  for (const row of (historyRes.data ?? []) as {
    application_id: string;
    created_at: string;
  }[]) {
    // First seen wins because the query is ordered created_at DESC.
    if (!stageEnteredAt.has(row.application_id)) {
      stageEnteredAt.set(row.application_id, row.created_at);
    }
  }

  const attachedCounts = new Map<string, number>();
  for (const row of (appDocsRes.data ?? []) as { application_id: string }[]) {
    attachedCounts.set(
      row.application_id,
      (attachedCounts.get(row.application_id) ?? 0) + 1,
    );
  }

  const probabilityScores = new Map<string, number>();
  for (const row of (probRes.data ?? []) as {
    application_id: string;
    probability_score: number;
  }[]) {
    probabilityScores.set(row.application_id, row.probability_score);
  }

  return ((appsRes.data ?? []) as Tables<"applications">[]).map((app) => {
    const opp = app.opportunity_id ? opps.get(app.opportunity_id) : undefined;
    return {
      ...app,
      opportunityName: opp?.name ?? null,
      funderName: opp?.funder_id
        ? (funderNames.get(opp.funder_id) ?? null)
        : null,
      deadline: opp?.deadline ?? null,
      eligibilityScore: opp?.eligibility_score ?? null,
      recurrence: opp?.recurrence ?? null,
      requiredDocumentCount: opp?.required_documents?.length ?? 0,
      attachedDocumentCount: attachedCounts.get(app.id) ?? 0,
      stageEnteredAt: stageEnteredAt.get(app.id) ?? app.created_at,
      probabilityScore: probabilityScores.get(app.id) ?? null,
    };
  });
}

/** Whole-day count an application has spent in its current stage. */
export function daysInStage(stageEnteredAt: string): number {
  const entered = new Date(stageEnteredAt);
  if (Number.isNaN(entered.getTime())) return 0;
  return Math.max(0, differenceInCalendarDays(new Date(), entered));
}

export type ExecuteTransitionArgs = {
  supabase: SupabaseClient;
  application: Pick<
    Tables<"applications">,
    "id" | "stage" | "organization_id" | "opportunity_id" | "requested_amount"
  >;
  target: PipelineStage;
  condition: TransitionCondition;
  changedBy: string | null;
  note: string | null;
};

/**
 * Performs a stage transition and records it in pipeline_history.
 *
 * The "renewal_opportunity -> discovered (new cycle)" edge is special: per
 * BEHAVIORAL_CONTRACTS §6 it creates a NEW application in `discovered` for the
 * same opportunity and leaves the current one untouched. Every other transition
 * updates the current application's stage. In both cases exactly one
 * pipeline_history row is written. Throws on any failure.
 */
export async function executeTransition({
  supabase,
  application,
  target,
  condition,
  changedBy,
  note,
}: ExecuteTransitionArgs): Promise<void> {
  const trimmedNote = note?.trim() ? note.trim() : null;

  if (condition === "creates_new_application") {
    const { data: created, error: insertError } = await supabase
      .from("applications")
      .insert({
        organization_id: application.organization_id,
        opportunity_id: application.opportunity_id,
        stage: "discovered",
        requested_amount: application.requested_amount,
      })
      .select("id")
      .single();

    if (insertError || !created) {
      throw new Error(
        insertError?.message ?? "Could not start the new application cycle.",
      );
    }

    const { error: historyError } = await supabase
      .from("pipeline_history")
      .insert({
        organization_id: application.organization_id,
        application_id: created.id,
        from_stage: null,
        to_stage: "discovered",
        changed_by: changedBy,
        notes: trimmedNote,
      });

    if (historyError) {
      throw new Error(historyError.message);
    }

    // Audit the renewal-cycle transition (Behavioral Contracts §24).
    void recordAudit({
      action: "update",
      entityType: "application",
      entityId: created.id as string,
      details: {
        from: application.stage,
        to: "discovered",
        renewed_from_application_id: application.id,
      },
    });
    return;
  }

  const updates: Record<string, unknown> = {
    stage: target,
    updated_at: new Date().toISOString(),
  };
  // Stamp the submission time when an application is submitted.
  if (target === "submitted") {
    updates.submitted_at = new Date().toISOString();
  }

  const { error: updateError } = await supabase
    .from("applications")
    .update(updates)
    .eq("id", application.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const { error: historyError } = await supabase
    .from("pipeline_history")
    .insert({
      organization_id: application.organization_id,
      application_id: application.id,
      from_stage: application.stage,
      to_stage: target,
      changed_by: changedBy,
      notes: trimmedNote,
    });

  if (historyError) {
    throw new Error(historyError.message);
  }

  // Audit the stage transition (Behavioral Contracts §24).
  void recordAudit({
    action: target === "submitted" ? "submission" : "update",
    entityType: "application",
    entityId: application.id,
    details: { from: application.stage, to: target },
  });

  // Trigger Agent 23 (Funder Relationship) on submission. Best-effort.
  if (target === "submitted") {
    void (async () => {
      const { data: opp } = await supabase
        .from("opportunities")
        .select("funder_id")
        .eq("id", application.opportunity_id)
        .maybeSingle();
      if (opp?.funder_id) {
        void fetch("/api/agents/funder-relationship", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            funderId: opp.funder_id,
            event: "application_submitted",
          }),
        }).catch(() => undefined);
      }
    })();
  }
}
