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
  // key so uq_alerts_org_dedup actually dedups. AR-11.3 closed the six sites
  // elsewhere that appended crypto.randomUUID() to their dedup keys (see the
  // block below).
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

  // AR-11.3 - the six call sites that used to append crypto.randomUUID() to
  // their dedup_key, defeating uq_alerts_org_dedup entirely (every key was
  // unique, so the index never fired and these alerts never deduped). Each
  // key below is built only from the facts that make two occurrences the
  // same real-world event, per call site:

  // base-agent.ts's checkSilentFailure() and autonomous-base.ts's
  // createNotification("silent_failure", ...) are the same bug pattern
  // (found items, processed none) on two different agent base classes. Same
  // agent + same org (organization_id is already in the unique index) + same
  // UTC day is one event; dateKey is a caller-supplied `YYYY-MM-DD` (e.g.
  // `new Date().toISOString().slice(0, 10)`) so the alert recurs the next day
  // if the agent is still broken, instead of being silenced forever by one
  // old row.
  agentSilentFailure: (agentIdentifier: string, dateKey: string) =>
    `agent-silent-failure:${agentIdentifier}:${dateKey}`,

  // deadline-prediction-agent.ts's red/amber tier alerts. Same opportunity +
  // same tier is one event; the tier itself already changes the key as a
  // deadline moves between windows, so no extra period component is needed -
  // an opportunity that stays "red" for a week should not re-alert daily.
  deadlinePredictionTier: (tier: "red" | "amber", opportunityId: string) =>
    `deadline-prediction:${tier}:${opportunityId}`,

  // autonomous-base.ts's createNotification() - a generic notice sink shared
  // by ~15 different notification types (document_expiring, donor_intent_high,
  // introduction_path, digests...) with no entity-id parameter of its own.
  // contentKey is the caller's contentFingerprint() of the type-specific
  // title+message, so two different entities (two different expiring
  // documents, two different funders...) notified the same day never
  // collide, while a byte-identical repeat does. dateKey gives every notice a
  // daily cadence so an old row never blocks a legitimate later
  // re-notification (e.g. once document-expiry-agent.ts's own
  // RENOTIFY_SUPPRESSION_DAYS window allows one again).
  autonomousNotification: (agentId: string, type: string, dateKey: string, contentKey: string) =>
    `autonomous:${agentId}:${type}:${dateKey}:${contentKey}`,

  // notify.ts's per-user notification dispatch. Same reasoning as
  // autonomousNotification above: eventType + userId alone is not a stable
  // identity (the same eventType fires for many different entities), so a
  // content fingerprint plus a daily cadence stands in for the entity id the
  // dispatcher doesn't receive.
  userNotification: (eventType: string, userId: string, dateKey: string, contentKey: string) =>
    `notify:${eventType}:${userId}:${dateKey}:${contentKey}`,

  // worker/autonomous-orchestrator.ts's insertAlert(). Used when the alert
  // already names a real entity (draft_review's applicationId, or its
  // opportunityId when no application exists yet) - same type + same entity
  // is one event, stable with no period (mirrors deadlinePredictionTier).
  autonomousOrchestratorEntityAlert: (type: string, entityId: string) =>
    `autonomous-orchestrator:${type}:${entityId}`,

  // Same insertAlert(), for the alert types that name no entity at all (e.g.
  // the reputation-risk system alert, which only names a funder inside its
  // message text) - falls back to a content fingerprint + daily cadence, same
  // shape as autonomousNotification/userNotification above.
  autonomousOrchestratorContentAlert: (type: string, dateKey: string, contentKey: string) =>
    `autonomous-orchestrator:${type}:${dateKey}:${contentKey}`,
};

// ---------------------------------------------------------------------------
// Content fingerprint - a short, stable, non-cryptographic hash used by the
// dedup keys above that stand in for a missing entity id (autonomousNotification,
// userNotification, autonomousOrchestratorContentAlert). Deliberately not
// node:crypto: this module is shared with the client UI (see file header), so
// it must stay usable in a browser bundle. Collisions are an acceptable
// tradeoff here - worst case, two distinct alerts sharing a dedup key on the
// same day merge into one, not a correctness or security property.
// ---------------------------------------------------------------------------
export function contentFingerprint(input: string): string {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

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
