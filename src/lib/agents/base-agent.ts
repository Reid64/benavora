// BaseAgent - shared infrastructure for every Benavora agent (AGENTS.md
// "Agent Architecture").
//
// Provides, once, the cross-cutting concerns every agent must honor:
//   - Structured logging to the agent_runs table (a row is written BEFORE work
//     starts, then updated to completed/failed). Agents never fail silently
//     (BEHAVIORAL_CONTRACTS §15).
//   - Token-usage tracking persisted to agent_runs.tokens_used for cost
//     monitoring.
//   - Execution-time measurement (duration_ms).
//   - A hard per-run timeout (AGENTS.md §15: 60s max, then fail).
//   - Organization-scoped data access through an injected Supabase client.
//
// Client choice is the caller's: user-triggered routes pass the session client
// (RLS stays on as a second barrier); scheduled/automated runs pass the service
// role client (admin.ts). Either way, subclasses MUST scope every query by
// `this.organizationId` so they are correct under the service role client too,
// where RLS does not protect them (BEHAVIORAL_CONTRACTS §2, §15).

import type { SupabaseClient } from "@supabase/supabase-js";

import { trackUsage } from "@/lib/billing/usage-tracker";
import { redactSecrets, logOrchestrationStep } from "@/lib/orchestration/orchestration-log";
import { runWithUsageContext } from "@/lib/ai/usage-context";
import type { AgentType } from "@/types/agents";
import type { Json } from "@/types/database";

/** Default hard ceiling on a single agent run (AGENTS.md §15). */
export const AGENT_TIMEOUT_MS = 60_000;

/**
 * AR-7.3: extracts the diagnostic parts of a Postgrest/pg error (code,
 * constraint, message, details, hint) or a plain Error/string, so a throw
 * site that only has a generic human-readable message to give AgentError can
 * still append the real cause instead of discarding it. Never throws; "" if
 * `err` carries nothing useful. Redacted via {@link redactSecrets} (AR-6.2) —
 * a raw pg error can echo back a connection string or other secret-shaped
 * value from the query, so this must never be skipped before persisting.
 */
export function causeOf(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as {
      code?: unknown;
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      constraint?: unknown;
    };
    const parts: string[] = [];
    if (typeof e.code === "string" && e.code) parts.push(`code=${e.code}`);
    if (typeof e.constraint === "string" && e.constraint) {
      parts.push(`constraint=${e.constraint}`);
    }
    if (typeof e.message === "string" && e.message) parts.push(e.message);
    else if (err instanceof Error) parts.push(err.message);
    if (typeof e.details === "string" && e.details) parts.push(`details=${e.details}`);
    if (typeof e.hint === "string" && e.hint) parts.push(`hint=${e.hint}`);
    if (parts.length) return redactSecrets(parts.join(" | "));
  }
  if (err instanceof Error) return redactSecrets(err.message);
  if (typeof err === "string" && err) return redactSecrets(err);
  return "";
}

/**
 * Builds an AgentError message that keeps the human-readable summary a
 * caller wants surfaced to users/routes, but appends the real cause (Postgres
 * code/constraint/message, or the original error text) so
 * agent_runs.error_message stops being diagnostically empty (AR-7.3). Does
 * not replace the human message — only appends when a cause is available.
 */
export function withCause(humanMessage: string, err: unknown): string {
  const cause = causeOf(err);
  return cause ? `${humanMessage} (${cause})` : humanMessage;
}

export interface BaseAgentOptions {
  /** Supabase client. Session client from routes, admin client for schedules. */
  client: SupabaseClient;
  /** Tenant scope. Every query the agent issues must filter by this. */
  organizationId: string;
  /** Profile id that triggered the run; null for automated/scheduled runs. */
  triggeredBy?: string | null;
  /**
   * Per-run hard timeout in ms. Defaults to {@link AGENT_TIMEOUT_MS} (60s).
   * Long-running agents (e.g. multi-pass scrapers) raise this toward the
   * deploy platform's function limit (Vercel 300s).
   */
  timeoutMs?: number;
}

/** What a subclass's {@link BaseAgent.execute} returns for one run. */
export interface AgentExecution<TResult> {
  /** The agent's domain result, handed back to the caller. */
  data: TResult;
  /** Human-readable summary stored in agent_runs.output_summary. */
  outputSummary: string;
  /** Count of items discovered (e.g. opportunities scored). Defaults to 0. */
  itemsFound?: number;
  /** Count of items written/updated. Defaults to itemsFound. */
  itemsProcessed?: number;
  /** Total Claude tokens consumed this run, for cost tracking. Defaults to 0. */
  tokensUsed?: number;
}

/** What {@link BaseAgent.run} resolves with after logging is finalized. */
export interface AgentRunOutcome<TResult> {
  /** agent_runs.id for this run, or null if the log row could not be created. */
  runId: string | null;
  data: TResult;
  tokensUsed: number;
  durationMs: number;
}

/**
 * Error raised by agents. Carries a stable `code` and an HTTP `status` hint so
 * route handlers can translate failures into the consistent API error shape
 * `{ error, code }` (BEHAVIORAL_CONTRACTS §16) without string-matching.
 */
export class AgentError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 500) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.status = status;
  }
}

export abstract class BaseAgent<TInput, TResult> {
  /** Discriminator written to agent_runs.agent_type. Set by each subclass. */
  abstract readonly agentType: AgentType;

  protected readonly client: SupabaseClient;
  protected readonly organizationId: string;
  protected readonly triggeredBy: string | null;
  /** This agent's hard run timeout (ms). Overridable via constructor options. */
  protected readonly timeoutMs: number;
  /**
   * AR-7.3: last checkpoint a subclass reported reaching via {@link setPhase}.
   * Read by {@link withTimeout} so a timeout's agent_runs.error_message names
   * how far execute() got instead of just "timed out" with no context.
   * Defaults to "start" for subclasses that never call setPhase — still
   * honest (we genuinely don't know more), just not as precise.
   */
  private phase = "start";

  constructor(options: BaseAgentOptions) {
    this.client = options.client;
    this.organizationId = options.organizationId;
    this.triggeredBy = options.triggeredBy ?? null;
    this.timeoutMs = options.timeoutMs ?? AGENT_TIMEOUT_MS;
  }

  /**
   * Subclasses call this at meaningful checkpoints inside execute() (e.g.
   * "fetched application", "calling claude", "saving result") so a timeout
   * has something real to report about progress. Optional — omitting it just
   * means a timeout reports phase="start".
   */
  protected setPhase(phase: string): void {
    this.phase = phase;
  }

  /**
   * The agent's actual work. Implementations read organization-scoped data,
   * call Claude as needed, write results, and return an {@link AgentExecution}.
   * Throw {@link AgentError} for expected failures (not found, bad input) so the
   * route can surface a precise status; any other throw is logged and rethrown.
   */
  protected abstract execute(input: TInput): Promise<AgentExecution<TResult>>;

  /**
   * Run the agent end-to-end: log the run as `running`, execute under the
   * timeout, then update the row to `completed` or `failed`. Logging is
   * best-effort - a logging failure never masks or blocks the real result.
   */
  async run(input: TInput): Promise<AgentRunOutcome<TResult>> {
    const startedAtMs = Date.now();
    const startedAtIso = new Date(startedAtMs).toISOString();
    const runId = await this.logStart(input);

    try {
      // AR-9.2: every Anthropic call this subclass makes (however deep
      // inside execute()) attributes its ai_usage_log row to this run via
      // src/lib/ai/usage-context.ts, without execute() needing to pass
      // organizationId/runId down to whatever calls callClaude().
      const execution = await this.withTimeout(
        runWithUsageContext(
          { organizationId: this.organizationId, agentType: this.agentType, agentRunId: runId },
          () => this.execute(input),
        ),
      );
      const durationMs = Date.now() - startedAtMs;
      const tokensUsed = execution.tokensUsed ?? 0;
      const itemsFound = execution.itemsFound ?? 0;

      const itemsProcessed = execution.itemsProcessed ?? itemsFound;

      await this.update(runId, {
        status: "completed",
        output_summary: execution.outputSummary,
        items_found: itemsFound,
        items_processed: itemsProcessed,
        tokens_used: tokensUsed,
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
      });
      await this.writeOrchestrationLog(runId, "completed", startedAtIso, {
        itemsExpected: itemsFound,
        itemsProcessed,
      });

      await this.checkSilentFailure(itemsFound, itemsProcessed, execution.outputSummary);

      return { runId, data: execution.data, tokensUsed, durationMs };
    } catch (err) {
      const durationMs = Date.now() - startedAtMs;
      const message =
        err instanceof Error ? err.message : "Agent execution failed.";

      await this.update(runId, {
        status: "failed",
        // AR-7.3: redacted here, once, for every BaseAgent subclass — the
        // message itself may carry a raw Postgres error (or a subclass's own
        // withCause()-built message) that could echo a secret-shaped value
        // back from the query; never persist it unredacted (AR-6.2 pattern).
        error_message: redactSecrets(message),
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
      });
      await this.writeOrchestrationLog(runId, "failed", startedAtIso, {
        errorMessage: message,
      });

      // `message` (the raw exception text) is logged to agent_runs.error_message
      // above for operators, but never rethrown for an unexpected (non-AgentError)
      // failure - route handlers surface AgentError.message directly to the
      // client, so a raw DB/provider error must not travel through it.
      throw err instanceof AgentError
        ? err
        : new AgentError("Agent execution failed. Please try again.", "agent_failed");
    }
  }

  // --- logging helpers -------------------------------------------------------

  /** Insert the `running` log row. Returns its id, or null on failure.
   * p5.2b (2026-09-15): now logs a failed insert instead of swallowing it
   * silently -- previously a persistent failure (e.g. an agentType literal
   * missing from the agent_type enum, confirmed live for form-analyzer.ts/
   * form-filler.ts/hud-monitor.ts this session) was indistinguishable from a
   * rare transient blip: the agent's real work still completed correctly,
   * but every run was permanently invisible to agent_runs/audit/quota
   * tracking with no signal anywhere that this was happening. Still returns
   * null and never throws -- a logging failure must never block the agent's
   * real work, per this method's original contract. */
  private async logStart(input: TInput): Promise<string | null> {
    const { data, error } = await this.client
      .from("agent_runs")
      .insert({
        organization_id: this.organizationId,
        agent_type: this.agentType,
        status: "running",
        triggered_by: this.triggeredBy,
        input_params: (input ?? null) as Json,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error(
        `[${this.agentType}] Failed to log agent_runs start row: ${error.message}`,
      );
    }

    // Meter this run against the org's daily agent_runs quota (Contracts §25).
    // Best-effort and decoupled from the run itself - a tracking failure must
    // never block the agent. The entry route enforces the limit before we get
    // here; this keeps the usage_metrics history complete for the dashboards.
    await trackUsage(this.client, this.organizationId, "agent_runs", 1);

    return (data?.id as string | undefined) ?? null;
  }

  /** Patch the run row. No-op when there is no row id. Best-effort. */
  private async update(
    runId: string | null,
    patch: Record<string, unknown>,
  ): Promise<void> {
    if (!runId) return;
    await this.client.from("agent_runs").update(patch).eq("id", runId);
  }

  /**
   * AR-9.1: orchestration_logs (migration 190, AR-6.2) had exactly zero rows
   * in production because AR-6.2 only wired worker/autonomous-orchestrator.ts's
   * agent_queue consumer, not this class — even though BaseAgent is the shared
   * run() boundary for most of the on-demand agent fleet (eligibility scoring,
   * research, draft generation, ...). run() above is the real step boundary;
   * this writes one orchestration_logs row per run() call. No-op when there is
   * no agent_runs row id (logStart already failed loudly in that case). Never
   * throws and never masks run()'s real result or rethrown error — a failed
   * write here is logged at error level with a fixed, greppable
   * "[orchestration_logs]" prefix instead of disappearing.
   */
  private async writeOrchestrationLog(
    runId: string | null,
    status: "completed" | "failed",
    startedAtIso: string,
    params: { itemsExpected?: number; itemsProcessed?: number; errorMessage?: string } = {},
  ): Promise<void> {
    if (!runId) return;
    const finishedAtIso = new Date().toISOString();
    try {
      const result = await logOrchestrationStep(this.client, {
        organizationId: this.organizationId,
        orchestrationId: runId,
        taskId: this.agentType,
        agentType: this.agentType,
        agentRunId: runId,
        status,
        startedAt: startedAtIso,
        finishedAt: finishedAtIso,
        durationMs: Date.parse(finishedAtIso) - Date.parse(startedAtIso),
        itemsExpected: params.itemsExpected ?? null,
        itemsProcessed: params.itemsProcessed ?? null,
        errorMessage: params.errorMessage ?? null,
        schemaValidationPassed: status === "completed",
      });
      if (!result.ok) {
        console.error(
          `[orchestration_logs] WRITE FAILED for ${this.agentType} run ${runId}: ${result.error}`,
        );
      }
    } catch (e) {
      console.error(
        `[orchestration_logs] WRITE THREW for ${this.agentType} run ${runId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /**
   * Silent-failure guard (CROSS_WIRING_REPORT.md, 2026-09-15): a run can
   * report status='completed' while finding real work and processing none of
   * it (ag-29-knowledge-indexer's original bug pattern, on the sibling
   * AutonomousAgent base class before p5a-001's fix). Shared and
   * agent-agnostic on purpose so no BaseAgent subclass can silently regress
   * into the same invisible-failure pattern. Best-effort: never blocks or
   * masks the real run result.
   */
  private async checkSilentFailure(
    itemsFound: number,
    itemsProcessed: number,
    outputSummary: string,
  ): Promise<void> {
    if (itemsFound <= 0 || itemsProcessed > 0) return;
    try {
      await this.client.from("alerts").insert({
        organization_id: this.organizationId,
        type: "system",
        severity: "warning",
        message: `${this.agentType}: found ${itemsFound} item(s), processed 0. ${outputSummary}`,
        dedup_key: `agent-silent-failure:${this.agentType}:${crypto.randomUUID()}`,
      });
    } catch {
      // Best-effort only -- never let alerting itself fail a real run.
    }
  }

  // --- timeout ---------------------------------------------------------------

  /**
   * Reject with an AgentError if `work` exceeds this agent's `timeoutMs`.
   * AR-7.3: the message now names the configured limit explicitly (not just
   * the derived seconds) and the last phase {@link setPhase} recorded, so a
   * timed-out run's agent_runs.error_message says how far execute() got
   * instead of just "timed out" with zero context — AR-6.3's timeout alert
   * rule needs this to be a real signal rather than the same opaque string
   * on every one of six silently-dying agent types.
   */
  private withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new AgentError(
            `Agent timed out after ${this.timeoutMs / 1000}s (limit=${this.timeoutMs}ms, phase="${this.phase}").`,
            "timeout",
            504,
          ),
        );
      }, this.timeoutMs);
    });
    return Promise.race([work, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}
