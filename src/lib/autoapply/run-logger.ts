// AR-1.2: gives the AutoApply worker pipeline (worker/queue-processor.ts and the
// src/lib/autoapply/** modules it calls) the same agent_runs observability every
// other Benavora agent gets from BaseAgent (src/lib/agents/base-agent.ts) —
// without depending on BaseAgent itself. worker/tsconfig.json only includes
// src/lib/autoapply/** and src/lib/supabase/**, and BaseAgent pulls in
// @/lib/billing/usage-tracker and other modules outside that build's scope, so
// this is a standalone, minimal re-implementation of the same
// running -> completed/failed contract instead of an import.
//
// Logging is best-effort in both directions: a failure to write the start row,
// or to patch it to completed/failed, is logged to console and swallowed — it
// must never block or mask the wrapped work's real result. A throw from `work`
// always propagates unchanged (same reference, same instanceof) after the
// failed row is recorded.

import type { SupabaseClient } from "@supabase/supabase-js";
import { redactSecrets, logOrchestrationStep } from "@/lib/orchestration/orchestration-log";

export interface WithAgentRunOptions {
  supabase: SupabaseClient;
  agentType: string;
  organizationId: string;
  /** Short human-readable note stored in agent_runs.input_params.summary. */
  inputSummary?: string;
}

function summarizeResult(result: unknown): string {
  if (result === undefined || result === null) return "Completed.";
  if (typeof result === "string") return result.slice(0, 500);
  try {
    return JSON.stringify(result).slice(0, 500);
  } catch {
    return "Completed.";
  }
}

async function logStart(opts: WithAgentRunOptions): Promise<string | null> {
  try {
    const { data, error } = await opts.supabase
      .from("agent_runs")
      .insert({
        organization_id: opts.organizationId,
        agent_type: opts.agentType,
        status: "running",
        input_params: opts.inputSummary ? { summary: opts.inputSummary } : null,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error(`[${opts.agentType}] Failed to log agent_runs start row: ${error.message}`);
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch (e) {
    console.error(
      `[${opts.agentType}] agent_runs start insert threw: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

async function logPatch(
  supabase: SupabaseClient,
  agentType: string,
  runId: string | null,
  patch: Record<string, unknown>,
): Promise<void> {
  if (runId === null) return;
  try {
    const { error } = await supabase.from("agent_runs").update(patch).eq("id", runId);
    if (error) {
      console.error(`[${agentType}] Failed to update agent_runs row ${runId}: ${error.message}`);
    }
  } catch (e) {
    console.error(
      `[${agentType}] agent_runs update threw: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// AR-9.1: orchestration_logs (migration 190, AR-6.2) had exactly zero rows in
// production despite real AutoApply traffic (autoapply_queue_processor,
// autoapply_submission_validator, ...) passing through this exact wrapper,
// because AR-6.2 only ever wired worker/autonomous-orchestrator.ts's
// agent_queue consumer — a completely separate pipeline this file's own
// header explicitly says it does NOT depend on. withAgentRun() is the one
// real step boundary the AutoApply worker pipeline has, so it is the
// correct place to write one orchestration_logs row per run. Same
// best-effort contract as the agent_runs logging above: never throws, never
// masks `work`'s real result — but unlike logStart/logPatch, a failed write
// here is logged with a fixed "[orchestration_logs]" prefix distinct from
// the "[agentType]" ones above, so it can never again go unnoticed while
// this table sits at zero.
async function writeOrchestrationLog(
  opts: WithAgentRunOptions,
  runId: string | null,
  status: "completed" | "failed",
  startedAtIso: string,
  errorMessage?: string,
): Promise<void> {
  if (runId === null) return; // no agent_runs row to link — logStart already logged that failure loudly.
  const finishedAtIso = new Date().toISOString();
  try {
    const result = await logOrchestrationStep(opts.supabase, {
      organizationId: opts.organizationId,
      orchestrationId: runId,
      taskId: opts.agentType,
      agentType: opts.agentType,
      agentRunId: runId,
      status,
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      durationMs: Date.parse(finishedAtIso) - Date.parse(startedAtIso),
      errorMessage: errorMessage ?? null,
      schemaValidationPassed: status === "completed",
    });
    if (!result.ok) {
      console.error(
        `[orchestration_logs] WRITE FAILED for ${opts.agentType} run ${runId}: ${result.error}`,
      );
    }
  } catch (e) {
    console.error(
      `[orchestration_logs] WRITE THREW for ${opts.agentType} run ${runId}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

/**
 * Runs `work`, logging an agent_runs row: inserted as 'running' before work
 * starts, patched to 'completed' (with duration_ms + output_summary) on
 * success, or to 'failed' (with duration_ms + error_message) if `work` throws
 * — then rethrows the original error unchanged either way.
 */
export async function withAgentRun<T>(
  opts: WithAgentRunOptions,
  work: () => Promise<T>,
): Promise<T> {
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  const runId = await logStart(opts);

  try {
    const result = await work();
    await logPatch(opts.supabase, opts.agentType, runId, {
      status: "completed",
      duration_ms: Date.now() - startedAtMs,
      output_summary: summarizeResult(result),
      completed_at: new Date().toISOString(),
    });
    await writeOrchestrationLog(opts, runId, "completed", startedAtIso);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logPatch(opts.supabase, opts.agentType, runId, {
      status: "failed",
      duration_ms: Date.now() - startedAtMs,
      error_message: redactSecrets(message),
      completed_at: new Date().toISOString(),
    });
    await writeOrchestrationLog(opts, runId, "failed", startedAtIso, redactSecrets(message));
    throw err;
  }
}
