import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FollowUpGeneratorAgent,
  type FollowUpStep,
  type FollowUpStepType,
} from "@/lib/agents/follow-up-generator";

/**
 * `process_followups` worker job (migration 081_application_followups.sql).
 *
 * Advances every `application_followups` row that is `scheduled` and due:
 * for each one, runs `FollowUpGeneratorAgent` (AGENTS.md Agent 28,
 * BEHAVIORAL_CONTRACTS §28, src/lib/agents/follow-up-generator.ts) against
 * the row's application, stores the generated email body as the row's
 * `content`, and marks it `sent`. Rows the agent fails on are left
 * `scheduled` so the next nightly run retries them. Wired into
 * worker/scheduler.ts's existing 2AM nightly job.
 *
 * Deviation note: `FollowUpGeneratorAgent` always produces a fixed 3-step
 * sequence for an application (thank_you day 1, check_in day 14,
 * status_request day 30, see follow-up-generator.ts's own header) - it has no
 * notion of `application_followups.follow_up_type` ('check_in' | 'thank_you'
 * | 'feedback_request' | 'renewal_prep') and does not write to this table
 * itself. This job bridges the two: it runs the full generator once per due
 * row, then picks whichever generated step best matches the row's
 * follow_up_type (direct match for thank_you/check_in). There is no
 * generator step for feedback_request or renewal_prep, so those fall back to
 * the status_request step (closest in intent - both are "checking in on
 * where things stand"), with a marker prefixed onto the stored content so a
 * human reviewing the row can see a fallback was used.
 */

type AppFollowUpType =
  | "check_in"
  | "thank_you"
  | "feedback_request"
  | "renewal_prep";

interface DueFollowUpRow {
  id: string;
  organization_id: string;
  application_id: string;
  follow_up_type: AppFollowUpType;
}

interface RowFailure {
  id: string;
  applicationId: string;
  reason: string;
}

interface RowSuccess {
  id: string;
  applicationId: string;
  followUpType: AppFollowUpType;
  usedFallback: boolean;
}

/** agent_type used for both the per-row agent runs and this batch's own summary row. */
const AGENT_TYPE = "follow_up_generator";

/**
 * Preference order of generator step types that satisfy each table
 * follow_up_type. The first entry is the "real" match; anything after it is
 * a documented fallback (see file header).
 */
const STEP_PREFERENCE: Record<AppFollowUpType, FollowUpStepType[]> = {
  thank_you: ["thank_you", "check_in", "status_request"],
  check_in: ["check_in", "thank_you", "status_request"],
  feedback_request: ["status_request", "check_in", "thank_you"],
  renewal_prep: ["status_request", "check_in", "thank_you"],
};

/**
 * Picks the generated step whose type best matches `followUpType`, returning
 * its email body as the row's `content`. Falls back through
 * `STEP_PREFERENCE`, and finally to the first available step, so a row
 * always gets real content rather than being left empty. Throws only if the
 * generator returned zero steps at all (should not happen -
 * FollowUpGeneratorAgent always returns 3, but this job must not assume it).
 */
function pickStepContent(
  followUpType: AppFollowUpType,
  steps: FollowUpStep[],
): { content: string; usedFallback: boolean } {
  const preference = STEP_PREFERENCE[followUpType];

  for (const wantedType of preference) {
    const step = steps.find((s) => s.type === wantedType);
    if (!step) continue;

    const usedFallback = wantedType !== preference[0];
    return {
      content: usedFallback
        ? `[No "${followUpType}" step in generator output; using closest match "${step.type}"]\n\n${step.body}`
        : step.body,
      usedFallback,
    };
  }

  const first = steps[0];
  if (!first) {
    throw new Error("Follow-up generator returned no usable steps.");
  }
  return {
    content: `[No matching step in generator output; using "${first.type}"]\n\n${first.body}`,
    usedFallback: true,
  };
}

/**
 * Processes every due `application_followups` row. Designed to never throw:
 * a failure loading rows, running the agent for one row, or writing the
 * batch summary is caught and logged so the worker's scheduler loop keeps
 * running regardless of what happens here.
 */
export async function processFollowups(
  supabase: SupabaseClient,
): Promise<void> {
  const startedAt = Date.now();
  const todayIso = new Date().toISOString().slice(0, 10);

  const successes: RowSuccess[] = [];
  const failures: RowFailure[] = [];

  try {
    const { data, error } = await supabase
      .from("application_followups")
      .select("id, organization_id, application_id, follow_up_type")
      .eq("status", "scheduled")
      .lte("scheduled_date", todayIso);

    if (error) {
      const reason = `Failed to load due application_followups rows: ${error.message}`;
      console.error(`[process-followups] ${reason}`);
      await logBatchRun(supabase, startedAt, 0, 0, "failed", reason);
      return;
    }

    const dueRows = (data ?? []) as DueFollowUpRow[];
    console.log(
      `[process-followups] ${dueRows.length} due follow-up(s) found for ${todayIso}.`,
    );

    for (const row of dueRows) {
      try {
        const agent = new FollowUpGeneratorAgent({
          client: supabase,
          organizationId: row.organization_id,
          triggeredBy: null,
        });

        const outcome = await agent.run({
          applicationId: row.application_id,
        });

        const { content, usedFallback } = pickStepContent(
          row.follow_up_type,
          outcome.data.steps,
        );

        const { error: updateError } = await supabase
          .from("application_followups")
          .update({ status: "sent", content })
          .eq("id", row.id);

        if (updateError) {
          throw new Error(
            `Generated content but failed to mark row sent: ${updateError.message}`,
          );
        }

        successes.push({
          id: row.id,
          applicationId: row.application_id,
          followUpType: row.follow_up_type,
          usedFallback,
        });
      } catch (err) {
        // Row is left `status='scheduled'` (no update issued) so the next
        // nightly run retries it.
        const reason = err instanceof Error ? err.message : String(err);
        console.error(
          `[process-followups] Row ${row.id} (application ${row.application_id}, ` +
            `type ${row.follow_up_type}) failed, left scheduled for retry: ${reason}`,
        );
        failures.push({ id: row.id, applicationId: row.application_id, reason });
      }
    }

    const durationMs = Date.now() - startedAt;
    const fallbackCount = successes.filter((s) => s.usedFallback).length;
    const summary =
      `${dueRows.length} due, ${successes.length} sent ` +
      `(${fallbackCount} via fallback step), ${failures.length} failed/retry-scheduled, ` +
      `${durationMs}ms.`;

    console.log(`[process-followups] Done. ${summary}`);
    if (failures.length > 0) {
      console.log(
        `[process-followups] Failed rows: ${failures
          .map((f) => `${f.id} (${f.reason})`)
          .join("; ")}`,
      );
    }

    await logBatchRun(
      supabase,
      startedAt,
      dueRows.length,
      successes.length,
      "completed",
      summary,
    );
  } catch (err) {
    // Belt-and-suspenders: nothing above should throw past its own try/catch,
    // but the worker's scheduler must survive regardless of what this job does.
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[process-followups] Unexpected top-level failure: ${reason}`);
    await logBatchRun(
      supabase,
      startedAt,
      0,
      0,
      "failed",
      `Unexpected top-level failure: ${reason}`,
    );
  }
}

/**
 * Best-effort platform-level summary row for this whole batch run - distinct
 * from the per-application agent_runs rows FollowUpGeneratorAgent.run()
 * already writes via BaseAgent for each row it processes.
 * `organization_id` is null: this job spans every organization's due
 * follow-ups in one pass, and migration 088_self_improvement_agent.sql
 * dropped agent_runs.organization_id's NOT NULL constraint for exactly this
 * kind of cross-org platform job (see AG-38's self-improvement-agent.ts for
 * the precedent this follows).
 */
async function logBatchRun(
  supabase: SupabaseClient,
  startedAt: number,
  itemsFound: number,
  itemsProcessed: number,
  status: "completed" | "failed",
  outputSummary: string,
): Promise<void> {
  try {
    const { error } = await supabase.from("agent_runs").insert({
      organization_id: null,
      agent_type: AGENT_TYPE,
      status,
      trigger_source: "schedule",
      output_summary: outputSummary.slice(0, 2000),
      items_found: itemsFound,
      items_processed: itemsProcessed,
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    });

    if (error) {
      console.error(
        `[process-followups] Failed to write batch summary agent_runs row: ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[process-followups] Failed to write batch summary agent_runs row: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
