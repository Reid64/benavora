// Shared logic for the Alerts feature (daily action list + sidebar badges).
//
// Pure, dependency-light helpers used by BOTH the generation route
// (src/app/api/alerts/route.ts) and the client UI (Alerts page, Sidebar
// badges). Anything that touches the database lives in the route; this module
// is the vocabulary they agree on: the dedup-key scheme, the pipeline stages
// that count as "needs action", severity/urgency rules, and the mapping from an
// alert type to the nav destination its badge sits on.

import type { Enums } from "@/types/database";

export type AlertType = Enums<"alert_type">;
export type AlertSeverity = Enums<"alert_severity">;
export type PipelineStage = Enums<"pipeline_stage">;

// Number of days ahead a deadline must fall within to raise an alert
// (the task's "deadlines within 7 days"). Overdue deadlines also qualify.
export const DEADLINE_WINDOW_DAYS = 7;

// Pipeline stages where the application is waiting on the organization to do
// something - these drive the "Applications needing action" badge. Kept
// deliberately narrow: in-progress stages (drafting, submitted, awarded...) are
// not "needs action". `ready_for_review` is excluded here because it is its own
// category (drafts pending review → DRAFT_REVIEW_STAGE below).
export const ACTION_STAGES: readonly PipelineStage[] = [
  "awaiting_documents",
  "follow_up_due",
  "reporting_required",
];

// The stage that means "a generated draft is ready for a human to review".
export const DRAFT_REVIEW_STAGE: PipelineStage = "ready_for_review";

// ---------------------------------------------------------------------------
// Dedup keys - stable identity for a candidate alert so regeneration upserts
// instead of duplicating, preserving the user's read/dismiss/snooze state.
// ---------------------------------------------------------------------------
export const dedupKeys = {
  deadline: (deadlineId: string) => `deadline:${deadlineId}`,
  newOpportunity: (opportunityId: string) => `opportunity:${opportunityId}`,
  // Stage is part of the key so that when an application moves on, the old
  // action alert is pruned and (if still actionable) a fresh one is created.
  applicationAction: (applicationId: string, stage: string) =>
    `application_action:${applicationId}:${stage}`,
  draftReview: (applicationId: string) => `draft_review:${applicationId}`,
  // Orchestration events (migration 188/189, AR-6.1). Deliberately NO random
  // component - two calls describing the same event must produce the same
  // key so uq_alerts_org_dedup actually dedups. Several existing agents
  // (base-agent.ts, autonomous-base.ts, deadline-prediction-agent.ts) append
  // crypto.randomUUID() to their dedup keys, which defeats the unique index
  // entirely; that is a pre-existing bug, not a pattern to repeat here.
  orchestrationTaskFailed: (orchestrationId: string, agentType: string) =>
    `orchestration:task_failed:${orchestrationId}:${agentType}`,
  orchestrationCostOverage: (orchestrationId: string) =>
    `orchestration:cost_overage:${orchestrationId}`,
  orchestrationSchemaMismatch: (orchestrationId: string, agentType: string) =>
    `orchestration:schema_mismatch:${orchestrationId}:${agentType}`,
  orchestrationStateDrift: (orchestrationId: string) =>
    `orchestration:state_drift:${orchestrationId}`,
  orchestrationRateLimit: (orchestrationId: string, agentType: string) =>
    `orchestration:rate_limit:${orchestrationId}:${agentType}`,
  orchestrationTimeout: (orchestrationId: string, agentType: string) =>
    `orchestration:timeout:${orchestrationId}:${agentType}`,
  orchestrationRollback: (orchestrationId: string) =>
    `orchestration:rollback:${orchestrationId}`,
  orchestrationManualReviewRequired: (orchestrationId: string) =>
    `orchestration:manual_review_required:${orchestrationId}`,
};

// ---------------------------------------------------------------------------
// Severity for a deadline, by whole days until due (negative = overdue).
// Mirrors the Deadlines page urgency bands (BLUEPRINT §4.9).
// ---------------------------------------------------------------------------
export function deadlineSeverity(daysUntilDue: number): AlertSeverity {
  if (daysUntilDue <= 3) return "critical"; // overdue or ≤ 3 days
  return "warning"; // 4-7 days
}

// ---------------------------------------------------------------------------
// Badge categories - one per actionable alert type, each pinned to the nav
// item it annotates. The Alerts item itself shows the total of all active
// alerts. Order matches how the four counts are described in the task.
// ---------------------------------------------------------------------------
export type BadgeCategory =
  | "deadline_due"
  | "new_opportunity"
  | "application_action"
  | "draft_review";

export type AlertCounts = Record<BadgeCategory, number> & { total: number };

export const EMPTY_COUNTS: AlertCounts = {
  deadline_due: 0,
  new_opportunity: 0,
  application_action: 0,
  draft_review: 0,
  total: 0,
};

// Human label per type, for the Alerts page grouping/legend.
export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  deadline_due: "Deadlines",
  new_opportunity: "New opportunities",
  application_action: "Applications needing action",
  draft_review: "Drafts pending review",
  system: "Notices",
  // Orchestration event types (migration 188, AR-6.1). Not added to
  // BadgeCategory/AlertCounts below - those drive the sidebar nav badges,
  // which are a per-org user worklist (deadlines/opportunities/applications/
  // drafts). Orchestration failures are an operator/platform-admin concern,
  // not a nonprofit user's action list, so they intentionally do not bump
  // nav counts. Surfacing them is separate follow-up work if a build/ops
  // alert view is added.
  task_failed: "Task failed",
  cost_overage: "Cost overage",
  schema_mismatch: "Schema mismatch",
  state_drift: "State drift",
  rate_limit: "Rate limit",
  timeout: "Timeout",
  rollback: "Rollback",
  manual_review_required: "Manual review required",
};
