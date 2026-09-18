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
import { dedupKeys } from "@/lib/alerts/alerts-service";
import type { AgentType } from "@/types/agents";
import type { Json } from "@/types/database";

/**
 * AR-11.4: per-agent-class timeout ceilings. A single global limit across
 * agents doing wildly different work (AGENTS.md §15's flat 60s) is what let
 * six agent types die silently for months (2026-09-16 audit) — a Claude
 * call with SDK-level retries, a multi-page browser crawl, and a single
 * upsert do not belong under one ceiling. Three classes, calibrated from
 * what's actually been recorded in agent_runs.error_message (AR-7.3 made a
 * timeout record its configured limit and last phase reached; before that,
 * every timeout row read the same bare "Agent timed out after 60s." with no
 * way to tell which class of work was running).
 */

/**
 * DETERMINISTIC class: no Claude call, no browser, no multi-page/external
 * network loop — pure DB reads/writes/arithmetic. Unchanged from AGENTS.md
 * §15's original default. success_probability (purely arithmetic, the only
 * BaseAgent subclass in this class with fresh post-AR-7.3 evidence) ran 7/7
 * clean at this limit in the first batch of runs recorded after AR-7.3
 * landed (2026-09-18) — confirms 60s remains correct here. Its 2 historical
 * timeouts (pre-AR-7.3, no phase recorded) both predate WGR-170's fix and
 * cannot be attributed to this limit being too short.
 */
export const AGENT_TIMEOUT_MS = 60_000;

/**
 * CLAUDE_CALL class: one or a few sequential Claude calls (with the SDK's
 * own retry behavior) but no browser automation or multi-page crawl. AR-2.1
 * (2026-09-17) raised eligibility_scoring/semantic-matching/
 * compliance-checker/email-parser to this value after live data showed
 * eligibility_scoring's only recorded failure was a single ~291ms overrun of
 * the 60s default (2026-08-24, duration_ms=60291) — evidence the call was
 * "just barely too short for one Claude round trip," not evidence 180s
 * itself is insufficient. 30 completed / 0 failed eligibility_scoring runs
 * recorded since (as of 2026-09-18), all well inside this limit.
 */
export const AGENT_TIMEOUT_CLAUDE_CALL_MS = 180_000;

/**
 * MULTI_STEP class: browser automation, multi-page/paginated crawling, or a
 * multi-call pipeline (budget narrative generation, review, propensity
 * scoring, the *_research family). Deliberately held to 270s, NOT the
 * platform's real 300s ceiling (`export const maxDuration = 300` on every
 * route that invokes these agents — verified live against vercel.json and
 * each route file) that several of these agents were previously hardcoded to
 * match exactly: an in-process timeout equal to the platform's own hard kill
 * point means the platform can win that race, and a process killed by the
 * platform records nothing at all — reproducing the exact "died silently,
 * recorded nowhere" defect this whole initiative exists to close, just at
 * the 300s tier instead of the default 60s one. 270s leaves a 30s margin so
 * this class's own graceful timeout (which AR-7.3 made recordable) always
 * fires first. Checked against all of agent_runs before lowering the several
 * 300_000/280_000 literals that used to sit here: no BaseAgent-driven run
 * has ever recorded a successful completion between 270s and 300s, so this
 * has no evidence of cutting off a real in-flight workload. The one
 * historical run that timed out exactly at this ceiling
 * (government_research, 2026-06-22, duration_ms=270145) is a single data
 * point three months stale with zero recurrence since — logged as a watch
 * item in test-evidence/AGENT_FAILURE_LEDGER.md, not acted on (see AR-11.4:
 * "do not tune on two data points" — this is one).
 */
export const AGENT_TIMEOUT_MULTI_STEP_MS = 270_000;

/**
 * AR-11.4 Step 3: how long a class can go without a NEW {@link BaseAgent.setPhase}
 * checkpoint before it's treated as stalled (likely hung) rather than merely
 * slow (legitimately still working). Only enforced once an agent has called
 * setPhase() at least once — an agent that never reports phases keeps the
 * pre-existing flat-ceiling-only behavior unchanged, so this adds zero
 * regression risk for the ~35 BaseAgent subclasses AR-7.3 did not wire phase
 * reporting into. The DETERMINISTIC class gets no distinct stall window
 * (its ceiling is already short enough that a mid-window "no progress"
 * check would just be a second, redundant timer); CLAUDE_CALL and
 * MULTI_STEP get 60s/90s respectively — long enough that normal per-page/
 * per-call cadence (research/*.ts's own pagination loops call setPhase()
 * once per page, typically well under a minute apart) never trips it, short
 * enough that a real hang inside a 270s ceiling is caught in well under
 * half the window instead of only at the very end.
 */
export function defaultStallMs(ceilingMs: number): number {
  if (ceilingMs <= AGENT_TIMEOUT_MS) return ceilingMs;
  if (ceilingMs <= AGENT_TIMEOUT_CLAUDE_CALL_MS) return 60_000;
  return 90_000;
}

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
   * Per-run hard timeout in ms. Defaults to {@link AGENT_TIMEOUT_MS} (60s,
   * the DETERMINISTIC class). Agents that call Claude or do browser/
   * multi-page work should pass {@link AGENT_TIMEOUT_CLAUDE_CALL_MS} or
   * {@link AGENT_TIMEOUT_MULTI_STEP_MS} rather than a bare literal, so the
   * class-level rationale documented alongside those constants stays
   * discoverable from the call site.
   */
  timeoutMs?: number;
  /**
   * AR-11.4: how long this agent can go without a new setPhase() checkpoint
   * before it's treated as stalled rather than merely slow. Defaults to
   * {@link defaultStallMs} of `timeoutMs`. Only ever matters for agents that
   * call setPhase() at all — see that function's doc comment.
   */
  stallMs?: number;
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
  /** AR-11.4: this agent's stall window (ms). See {@link defaultStallMs}. */
  private readonly stallMs: number;
  /**
   * AR-7.3: last checkpoint a subclass reported reaching via {@link setPhase}.
   * Read by {@link withTimeout} so a timeout's agent_runs.error_message names
   * how far execute() got instead of just "timed out" with no context.
   * Defaults to "start" for subclasses that never call setPhase — still
   * honest (we genuinely don't know more), just not as precise.
   */
  private phase = "start";
  /** AR-11.4: wall-clock time of the last setPhase() call, for stall detection. */
  private phaseChangedAt = Date.now();
  /**
   * AR-11.4: true once this agent has called setPhase() at least once. The
   * stall detector in {@link withTimeout} stays off until this flips —
   * an agent with no phase telemetry gives us nothing to judge "no progress"
   * against, so it keeps the pre-AR-11.4 flat-ceiling-only behavior.
   */
  private phaseReported = false;

  constructor(options: BaseAgentOptions) {
    this.client = options.client;
    this.organizationId = options.organizationId;
    this.triggeredBy = options.triggeredBy ?? null;
    this.timeoutMs = options.timeoutMs ?? AGENT_TIMEOUT_MS;
    this.stallMs = options.stallMs ?? defaultStallMs(this.timeoutMs);
  }

  /**
   * Subclasses call this at meaningful checkpoints inside execute() (e.g.
   * "fetched application", "calling claude", "saving result") so a timeout
   * has something real to report about progress, and so {@link withTimeout}
   * can tell a still-progressing run apart from a stalled one (AR-11.4).
   * Optional — omitting it just means a timeout reports phase="start" and
   * this agent never gets the stall-vs-slow distinction.
   */
  protected setPhase(phase: string): void {
    this.phase = phase;
    this.phaseChangedAt = Date.now();
    this.phaseReported = true;
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
        dedup_key: dedupKeys.agentSilentFailure(
          this.agentType,
          new Date().toISOString().slice(0, 10),
        ),
      });
    } catch {
      // Best-effort only -- never let alerting itself fail a real run.
    }
  }

  // --- timeout ---------------------------------------------------------------

  /**
   * Reject with an AgentError if `work` exceeds this agent's `timeoutMs`, OR
   * (AR-11.4) if it goes `stallMs` without a new {@link setPhase} checkpoint
   * once it has started reporting phases at all — Step 3's "slow vs hung"
   * distinction. A progressing agent (phase keeps advancing) only ever hits
   * the ceiling timer; an agent that reports a phase once and then goes
   * quiet for the whole stall window is very likely hung and gets killed
   * well before the ceiling, with a distinct `code: "stalled"` so it reads
   * differently from a genuine ceiling timeout in agent_runs.error_message.
   * AR-7.3: both messages name the configured limit/threshold explicitly and
   * the last phase {@link setPhase} recorded, instead of a bare "timed out"
   * with zero context.
   */
  private withTimeout<T>(work: Promise<T>): Promise<T> {
    let ceilingTimer: ReturnType<typeof setTimeout> | undefined;
    let stallTimer: ReturnType<typeof setInterval> | undefined;

    const ceiling = new Promise<never>((_, reject) => {
      ceilingTimer = setTimeout(() => {
        reject(
          new AgentError(
            `Agent timed out after ${this.timeoutMs / 1000}s (limit=${this.timeoutMs}ms, phase="${this.phase}").`,
            "timeout",
            504,
          ),
        );
      }, this.timeoutMs);
    });

    const racers = [work, ceiling];

    // Only meaningful when the stall window is strictly shorter than the
    // ceiling (true for CLAUDE_CALL/MULTI_STEP; the DETERMINISTIC class sets
    // stallMs === timeoutMs, where a second timer firing at the same instant
    // would just be redundant and racy against the ceiling timer).
    if (this.stallMs < this.timeoutMs) {
      const checkIntervalMs = Math.min(5_000, this.stallMs);
      const stall = new Promise<never>((_, reject) => {
        stallTimer = setInterval(() => {
          if (!this.phaseReported) return; // no telemetry to judge staleness from
          const sinceLastPhase = Date.now() - this.phaseChangedAt;
          if (sinceLastPhase >= this.stallMs) {
            reject(
              new AgentError(
                `Agent stalled: no progress past phase "${this.phase}" for ` +
                  `${Math.round(sinceLastPhase / 1000)}s (stall threshold=${this.stallMs}ms, ` +
                  `ceiling=${this.timeoutMs}ms not yet reached).`,
                "stalled",
                504,
              ),
            );
          }
        }, checkIntervalMs);
      });
      racers.push(stall);
    }

    return Promise.race(racers).finally(() => {
      if (ceilingTimer) clearTimeout(ceilingTimer);
      if (stallTimer) clearInterval(stallTimer);
    });
  }
}
