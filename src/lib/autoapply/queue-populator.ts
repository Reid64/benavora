/* eslint-disable @typescript-eslint/no-explicit-any */

import { AgentRunner, type AgentResult } from "@/lib/pil/agent-runner";
import { getFeatureVariant, type LDContext } from "@/lib/feature-flags/ld-client";
import { getPilClient } from "@/lib/pil/db";
import { autoapplySourceRun, autoapplySourceRunDuration } from "@/lib/observability/flag-metrics";
import type { SubmissionOrchestratorReport } from "@/lib/pil/agents/app/BEN-APP-03";

import { populateQueue, type PopulateResult } from "./auto-queue-populator";

// AutoApply queue source switch (queue-feature-flags-pil-rollout-REAL.yaml,
// id: autoapply-source-switch) -- gates which pipeline feeds the real
// `submission_queue` table (the one FormFillerAgent/the AutoApply worker
// actually consumes) behind the `pil-autoapply-source` LaunchDarkly flag, so
// PIL's dossier-driven queueing can roll out per-org without an all-or-nothing
// cutover.
//
// Deviations from the task's own illustrative sketch, and why:
//
// 1. Parameter/column name: the sketch takes `tenantId` and filters
//    `.eq('tenant_id', tenantId)`. No table in this schema has a tenant_id
//    column -- every pil_* and legacy table uses `organization_id` (see
//    migration 163's header, which flagged this exact spec-vs-schema gap for
//    pil_prospect_dossiers). Renamed to `organizationId` throughout; filtering
//    on tenant_id here would have silently matched zero rows on every call.
//
// 2. Destination table: the sketch inserts into `autoapply_submission_queue`,
//    which doesn't exist. The real, already-wired table the AutoApply worker
//    reads is `submission_queue` (migration 045) -- migration 169's own header
//    documents this identical spec/reality mismatch for BEN-APP-03. Both
//    branches below end up writing there (or leave it alone, for the old
//    path's existing dedup logic).
//
// 3. Dossier filtering: the sketch reads `app_priority_score` /
//    `app_priority_recommendation` / `dossier_complete` directly off
//    pil_prospect_dossiers. That table (migration 163) only carries a
//    generated narrative (`dossier` jsonb + `narrative_text`) -- prioritization
//    lives on pil_priority_scores (BEN-APP-02, migration 168) and the
//    can-submit/should-submit decision lives on pil_application_profiles
//    (BEN-APP-01, migration 167). BEN-APP-03 (Submission Orchestrator,
//    migration 169) already joins all three, runs the exact can/should-submit
//    checklist, calls its own amount/pitch helpers, and inserts eligible rows
//    into `submission_queue` -- so the "dossiers" branch here invokes that
//    agent through the governed AgentRunner path (policy + budget checks,
//    pil_agent_runs audit row) rather than re-deriving ~700 lines of already-
//    correct, already-tested decisioning against a schema the sketch got
//    wrong. See BEN-APP-03.ts's own header for the full can-submit/should-
//    submit spec.
//
// 4. LDContext shape: the sketch calls `getFeatureVariant(key, { key: user })`
//    per-request-context. `pil-autoapply-source` is an org-scoped rollout flag
//    exactly like `pil-enabled` (src/lib/feature-flags/pil.ts) -- every
//    teammate at an org must see the same source, so this reuses that file's
//    `{ kind: "organization", key: organizationId }` shape instead of a
//    per-user one.

export const AUTOAPPLY_SOURCE_FLAG_KEY = "pil-autoapply-source";

function autoapplySourceContext(organizationId: string): LDContext {
  return { kind: "organization", key: organizationId };
}

export type ProspectPopulateResult = PopulateResult & { source: "prospects" };

export type DossierPopulateResult = {
  source: "dossiers";
  queued: number;
  reviewed: number;
  submitNow: number;
  submitScheduled: number;
  needsMoreResearch: number;
  blocked: number;
  reviewsCreated: number;
  /** Set when BEN-APP-03 didn't run at all (nothing to review yet, or the run was denied/held by policy). */
  skippedReason: "no_research_runs_yet" | "no_priority_scores_yet" | "blocked_by_policy" | null;
};

export type SubmissionQueuePopulateResult = ProspectPopulateResult | DossierPopulateResult;

export async function populateSubmissionQueue(
  organizationId: string,
  supabase: any,
): Promise<SubmissionQueuePopulateResult> {
  const source = await getFeatureVariant(
    AUTOAPPLY_SOURCE_FLAG_KEY,
    autoapplySourceContext(organizationId),
    "prospects", // Safe fallback -- an LD outage or unset flag keeps orgs on the old, already-proven path.
  );

  const startTime = Date.now();
  try {
    const result =
      source === "dossiers"
        ? await populateFromDossiers(organizationId)
        : await populateFromProspects(organizationId, supabase);

    // A dossiers run that short-circuited on skippedReason (no PIL data yet,
    // or held by policy) didn't fail -- it's not a signal for the
    // DossierSourceErrorRateHigh alert, just an org that isn't ready yet.
    const outcome = "skippedReason" in result && result.skippedReason ? "skipped" : "success";
    autoapplySourceRun.labels(source, outcome).inc();
    return result;
  } catch (error) {
    autoapplySourceRun.labels(source, "error").inc();
    throw error;
  } finally {
    autoapplySourceRunDuration.labels(source).observe(Date.now() - startTime);
  }
}

async function populateFromProspects(organizationId: string, supabase: any): Promise<ProspectPopulateResult> {
  const result = await populateQueue({ organizationId, supabase, dry_run: false });
  return { source: "prospects", ...result };
}

const DOSSIER_SKIP_RESULT: Omit<DossierPopulateResult, "skippedReason"> = {
  source: "dossiers",
  queued: 0,
  reviewed: 0,
  submitNow: 0,
  submitScheduled: 0,
  needsMoreResearch: 0,
  blocked: 0,
  reviewsCreated: 0,
};

async function populateFromDossiers(organizationId: string): Promise<DossierPopulateResult> {
  // BEN-APP-03 reads each prospect's latest pil_priority_scores row regardless
  // of which research run produced it (org-wide sweep, not per-run) -- there
  // is no single "the" research run to attach this trigger to. pil_agent_runs
  // still requires a real research_run_id FK for its own audit trail, so this
  // attaches to the org's most recent run purely for traceability; if the org
  // has never had PIL research run at all, there's nothing for BEN-APP-03 to
  // act on either, so this short-circuits before touching AgentRunner.
  const { data: latestRun, error: runLookupError } = await getPilClient()
    .from("pil_research_runs")
    .select("id")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runLookupError) throw runLookupError;
  if (!latestRun) {
    return { ...DOSSIER_SKIP_RESULT, skippedReason: "no_research_runs_yet" };
  }

  const runner = new AgentRunner();
  const result: AgentResult = await runner.run({
    agentCode: "BEN-APP-03",
    orgId: organizationId,
    prospectId: null,
    runId: latestRun.id,
    goal: "Populate the AutoApply submission queue from Prospect Intelligence Layer priority scores and dossiers.",
    plan: {},
    tools: [], // No model calls of its own -- BEN-APP-03 only re-applies already-computed upstream scores/profiles.
    budget: 0,
    depth: 1, // Allows exactly one hop of delegation to BEN-SUP-06 for unresolvable prospects; see BEN-APP-03's header.
  });

  if (result.status === "failed") {
    throw new Error(result.error ?? "BEN-APP-03 submission orchestration failed.");
  }
  if (result.status === "blocked" || result.status === "escalated") {
    return { ...DOSSIER_SKIP_RESULT, skippedReason: "blocked_by_policy" };
  }

  if (result.conclusions.skipped === true) {
    // BEN-APP-03's own early-exit: no pil_priority_scores rows for this org yet.
    return { ...DOSSIER_SKIP_RESULT, skippedReason: "no_priority_scores_yet" };
  }

  const { report, legacyQueueItemsCreated, reviewsCreated } = result.conclusions as {
    report: SubmissionOrchestratorReport;
    legacyQueueItemsCreated: number;
    reviewsCreated: number;
  };

  return {
    source: "dossiers",
    queued: legacyQueueItemsCreated,
    reviewed: report.submissionSummary.totalProspectsReviewed,
    submitNow: report.submissionSummary.submitNow,
    submitScheduled: report.submissionSummary.submitNext30Days + report.submissionSummary.submitQ2,
    needsMoreResearch: report.submissionSummary.needsMoreResearch,
    blocked: report.submissionSummary.blockersPreventSubmission,
    reviewsCreated,
    skippedReason: null,
  };
}
