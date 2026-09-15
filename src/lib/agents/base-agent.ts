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
import type { AgentType } from "@/types/agents";
import type { Json } from "@/types/database";

/** Default hard ceiling on a single agent run (AGENTS.md §15). */
export const AGENT_TIMEOUT_MS = 60_000;

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

  constructor(options: BaseAgentOptions) {
    this.client = options.client;
    this.organizationId = options.organizationId;
    this.triggeredBy = options.triggeredBy ?? null;
    this.timeoutMs = options.timeoutMs ?? AGENT_TIMEOUT_MS;
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
    const startedAt = Date.now();
    const runId = await this.logStart(input);

    try {
      const execution = await this.withTimeout(this.execute(input));
      const durationMs = Date.now() - startedAt;
      const tokensUsed = execution.tokensUsed ?? 0;
      const itemsFound = execution.itemsFound ?? 0;

      await this.update(runId, {
        status: "completed",
        output_summary: execution.outputSummary,
        items_found: itemsFound,
        items_processed: execution.itemsProcessed ?? itemsFound,
        tokens_used: tokensUsed,
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
      });

      return { runId, data: execution.data, tokensUsed, durationMs };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const message =
        err instanceof Error ? err.message : "Agent execution failed.";

      await this.update(runId, {
        status: "failed",
        error_message: message,
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
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

  // --- timeout ---------------------------------------------------------------

  /** Reject with an AgentError if `work` exceeds this agent's `timeoutMs`. */
  private withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new AgentError(
            `Agent timed out after ${this.timeoutMs / 1000}s.`,
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
