import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Retries AutoApply submissions that were sent to a funder ("status = submitted")
 * but never got a confirmation email back within 6 hours. Runs hourly from
 * /api/cron/autoapply-retry. See confirmation-monitor.ts for the inbound side
 * that flips confirmation_email_received to true.
 */

const MAX_RETRIES = 3;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const RETRY_BACKOFF_MS = 60 * 60 * 1000;
const SOURCE = "autoapply-submission-retry";

interface StaleSubmissionRow {
  id: string;
  organization_id: string;
  funder_id: string | null;
  request_profile_id: string | null;
  retry_count: number;
}

export interface RetrySweepResult {
  retried: string[];
  failed: string[];
}

async function logSystemError(
  supabase: SupabaseClient,
  params: { errorType: string; message: string; severity: "error" | "critical" },
): Promise<void> {
  try {
    await supabase.from("system_errors").insert({
      source: SOURCE,
      error_type: params.errorType,
      message: params.message,
      severity: params.severity,
    });
  } catch (err) {
    console.error(`[${SOURCE}] Failed to write system_errors row:`, err);
  }
}

export async function runRetrySweep(supabase: SupabaseClient): Promise<RetrySweepResult> {
  const now = new Date();
  const nowIso = now.toISOString();
  const staleCutoffIso = new Date(now.getTime() - STALE_AFTER_MS).toISOString();

  const retried: string[] = [];
  const failed: string[] = [];

  // Step 2/3: unconfirmed submissions older than 6h, under the retry cap, and
  // not already scheduled for a future retry.
  const { data: retryCandidates, error: retryError } = await supabase
    .from("autoapply_submissions")
    .select("id, organization_id, funder_id, request_profile_id, retry_count")
    .eq("status", "submitted")
    .eq("confirmation_email_received", false)
    .lt("retry_count", MAX_RETRIES)
    .lt("submitted_at", staleCutoffIso)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`);

  if (retryError) {
    await logSystemError(supabase, {
      errorType: "retry_query_failed",
      message: retryError.message,
      severity: "error",
    });
    return { retried, failed };
  }

  for (const row of (retryCandidates ?? []) as StaleSubmissionRow[]) {
    const nextRetryAt = new Date(now.getTime() + RETRY_BACKOFF_MS).toISOString();

    const { error: updateError } = await supabase
      .from("autoapply_submissions")
      .update({
        retry_count: row.retry_count + 1,
        next_retry_at: nextRetryAt,
      })
      .eq("id", row.id);

    if (updateError) {
      await logSystemError(supabase, {
        errorType: "retry_update_failed",
        message: `submission ${row.id}: ${updateError.message}`,
        severity: "error",
      });
      continue;
    }

    // Trigger resubmit by re-enqueueing for the AutoApply worker's real queue.
    const { error: enqueueError } = await supabase.from("submission_queue").insert({
      organization_id: row.organization_id,
      funder_id: row.funder_id,
      request_profile_id: row.request_profile_id,
      status: "pending",
      scheduled_for: nowIso,
      priority: 50,
    });

    if (enqueueError) {
      await logSystemError(supabase, {
        errorType: "retry_enqueue_failed",
        message: `submission ${row.id}: ${enqueueError.message}`,
        severity: "error",
      });
      continue;
    }

    retried.push(row.id);
  }

  // Step 4: submissions that have exhausted all retries and still have no
  // confirmation get marked failed so they stop being picked up.
  const { data: exhausted, error: exhaustedError } = await supabase
    .from("autoapply_submissions")
    .select("id")
    .eq("status", "submitted")
    .eq("confirmation_email_received", false)
    .gte("retry_count", MAX_RETRIES);

  if (exhaustedError) {
    await logSystemError(supabase, {
      errorType: "exhausted_query_failed",
      message: exhaustedError.message,
      severity: "error",
    });
    return { retried, failed };
  }

  for (const row of (exhausted ?? []) as Array<{ id: string }>) {
    const message = `No confirmation email received after ${MAX_RETRIES} retries.`;

    const { error: failError } = await supabase
      .from("autoapply_submissions")
      .update({
        status: "failed",
        error_message: message,
      })
      .eq("id", row.id);

    if (failError) {
      await logSystemError(supabase, {
        errorType: "retry_fail_update_failed",
        message: `submission ${row.id}: ${failError.message}`,
        severity: "error",
      });
      continue;
    }

    await logSystemError(supabase, {
      errorType: "submission_confirmation_exhausted",
      message: `submission ${row.id}: ${message}`,
      severity: "error",
    });

    failed.push(row.id);
  }

  return { retried, failed };
}
