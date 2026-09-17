import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * orchestration_logs (migration 190, AR-6.2) — execution facts for one step
 * of one orchestration run. Org-scoped via organization_id (this platform's
 * live schema has no company_id anywhere — see the migration header).
 *
 * This is the only writer for that table. worker/autonomous-orchestrator.ts
 * calls logOrchestrationStep()/runOrchestrationStep() at each step boundary
 * instead of inserting into orchestration_logs directly, so every row goes
 * through the same redaction pass below.
 */

export interface OrchestrationStepInput {
  organizationId: string;
  orchestrationId: string;
  taskId?: string | null;
  agentType?: string | null;
  agentRunId?: string | null;
  pilAgentRunId?: string | null;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  itemsExpected?: number | null;
  itemsProcessed?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  schemaValidationPassed?: boolean | null;
  reconciliationPassed?: boolean | null;
  stateDelta?: Record<string, unknown> | null;
  costLogId?: string | null;
}

export type LogOrchestrationStepResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Secret redaction — never persist an API key, token, password, private key,
// or raw .env content into error_message/state_delta. Patterns cover the
// key shapes actually in use in this repo (Anthropic sk-ant-*, generic
// sk-*/pk-* API keys, AWS AKIA*, JWT-shaped bearer tokens, Bearer headers,
// and KEY=value .env-style assignments for common secret-ish names) plus a
// generic fallback for any "password"/"token"/"secret"/"key" = <value> pair
// so a redaction never depends on guessing every provider's key format.
// ---------------------------------------------------------------------------

const REDACTION_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bpk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\bBearer\s+[A-Za-z0-9._-]{10,}/gi,
  /\b((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|secret|password|passwd|private[_-]?key)\s*[:=]\s*)(["']?)([^\s"',]{4,})(\2)/gi,
];

const SECRET_KEY_NAME = /(password|passwd|token|secret|api[_-]?key|apikey|private[_-]?key)/i;

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of REDACTION_PATTERNS) {
    // Only the last (key=value) pattern has a capture group to preserve —
    // for the rest, replace's 2nd callback arg is the match offset (a
    // number), not a capture, so it must be ignored rather than prepended.
    redacted = redacted.replace(pattern, (...args: unknown[]) => {
      const group1 = args[1];
      return typeof group1 === "string" ? `${group1}[REDACTED]` : "[REDACTED]";
    });
  }
  return redacted;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") return redactJson(value as Record<string, unknown>);
  return value;
}

export function redactJson(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = SECRET_KEY_NAME.test(key) ? "[REDACTED]" : redactValue(value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Typed writer
// ---------------------------------------------------------------------------

export async function logOrchestrationStep(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  input: OrchestrationStepInput,
): Promise<LogOrchestrationStepResult> {
  const { data, error } = await supabase
    .from("orchestration_logs")
    .insert({
      organization_id: input.organizationId,
      orchestration_id: input.orchestrationId,
      task_id: input.taskId ?? null,
      agent_type: input.agentType ?? null,
      agent_run_id: input.agentRunId ?? null,
      pil_agent_run_id: input.pilAgentRunId ?? null,
      status: input.status,
      started_at: input.startedAt,
      finished_at: input.finishedAt ?? null,
      duration_ms: input.durationMs ?? null,
      items_expected: input.itemsExpected ?? null,
      items_processed: input.itemsProcessed ?? null,
      error_code: input.errorCode ?? null,
      error_message: input.errorMessage ? redactSecrets(input.errorMessage) : null,
      schema_validation_passed: input.schemaValidationPassed ?? null,
      reconciliation_passed: input.reconciliationPassed ?? null,
      state_delta: input.stateDelta ? redactJson(input.stateDelta) : null,
      cost_log_id: input.costLogId ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "orchestration_logs insert returned no row" };
  }
  return { ok: true, id: data.id as string };
}

// ---------------------------------------------------------------------------
// Step wrapper — the shared boundary every orchestrator call site uses
// instead of a scattered raw insert. Times the call, always writes exactly
// one row (success or failure), and rethrows so existing caller control flow
// (retry/continue decisions) is unchanged.
// ---------------------------------------------------------------------------

export interface OrchestrationStepContext {
  organizationId: string;
  orchestrationId: string;
  taskId: string;
  agentType?: string | null;
  agentRunId?: string | null;
  pilAgentRunId?: string | null;
  itemsExpected?: number | null;
  // Retry context (e.g. agent_queue.retry_count/max_retries) for AR-6.3's
  // Rule 1 (task_failed) trigger to tell a final failure from one that will
  // retry. retryCount is the number of attempts already made BEFORE this
  // one — the trigger computes "is this the last retry" as
  // (retryCount + 1) >= maxRetries. Omitted entirely for steps with no
  // retry mechanism, which the trigger then treats as always-final.
  retryCount?: number | null;
  maxRetries?: number | null;
}

export interface OrchestrationStepOutcome {
  itemsExpected?: number | null;
  itemsProcessed?: number | null;
  stateDelta?: Record<string, unknown> | null;
  reconciliationPassed?: boolean | null;
}

function errorCodeOf(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return "step_error";
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs `fn`, logging exactly one orchestration_logs row for the attempt.
 * `fn`'s thrown error (if any) is redacted and persisted, then rethrown
 * unchanged so the caller's own error handling is unaffected.
 */
export async function runOrchestrationStep<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  ctx: OrchestrationStepContext,
  fn: () => Promise<T>,
  toOutcome?: (result: T) => OrchestrationStepOutcome,
): Promise<T> {
  const startedAt = new Date();
  try {
    const result = await fn();
    const finishedAt = new Date();
    const outcome = toOutcome ? toOutcome(result) : {};
    await logOrchestrationStep(supabase, {
      organizationId: ctx.organizationId,
      orchestrationId: ctx.orchestrationId,
      taskId: ctx.taskId,
      agentType: ctx.agentType ?? ctx.taskId,
      agentRunId: ctx.agentRunId ?? null,
      pilAgentRunId: ctx.pilAgentRunId ?? null,
      status: "completed",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      itemsExpected: outcome.itemsExpected ?? ctx.itemsExpected ?? null,
      itemsProcessed: outcome.itemsProcessed ?? null,
      schemaValidationPassed: true,
      reconciliationPassed: outcome.reconciliationPassed ?? null,
      stateDelta: outcome.stateDelta ?? null,
    });
    return result;
  } catch (err) {
    const finishedAt = new Date();
    const retryStateDelta =
      ctx.retryCount != null || ctx.maxRetries != null
        ? { retry_count: ctx.retryCount ?? null, max_retries: ctx.maxRetries ?? null }
        : null;
    await logOrchestrationStep(supabase, {
      organizationId: ctx.organizationId,
      orchestrationId: ctx.orchestrationId,
      taskId: ctx.taskId,
      agentType: ctx.agentType ?? ctx.taskId,
      agentRunId: ctx.agentRunId ?? null,
      pilAgentRunId: ctx.pilAgentRunId ?? null,
      status: "failed",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      itemsExpected: ctx.itemsExpected ?? null,
      errorCode: errorCodeOf(err),
      errorMessage: errorMessageOf(err),
      schemaValidationPassed: false,
      stateDelta: retryStateDelta,
    });
    throw err;
  }
}
