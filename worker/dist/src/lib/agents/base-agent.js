"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseAgent = exports.AgentError = exports.AGENT_TIMEOUT_MS = void 0;
const usage_tracker_1 = require("@/lib/billing/usage-tracker");
/** Default hard ceiling on a single agent run (AGENTS.md §15). */
exports.AGENT_TIMEOUT_MS = 60_000;
/**
 * Error raised by agents. Carries a stable `code` and an HTTP `status` hint so
 * route handlers can translate failures into the consistent API error shape
 * `{ error, code }` (BEHAVIORAL_CONTRACTS §16) without string-matching.
 */
class AgentError extends Error {
    code;
    status;
    constructor(message, code, status = 500) {
        super(message);
        this.name = "AgentError";
        this.code = code;
        this.status = status;
    }
}
exports.AgentError = AgentError;
class BaseAgent {
    client;
    organizationId;
    triggeredBy;
    /** This agent's hard run timeout (ms). Overridable via constructor options. */
    timeoutMs;
    constructor(options) {
        this.client = options.client;
        this.organizationId = options.organizationId;
        this.triggeredBy = options.triggeredBy ?? null;
        this.timeoutMs = options.timeoutMs ?? exports.AGENT_TIMEOUT_MS;
    }
    /**
     * Run the agent end-to-end: log the run as `running`, execute under the
     * timeout, then update the row to `completed` or `failed`. Logging is
     * best-effort - a logging failure never masks or blocks the real result.
     */
    async run(input) {
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
        }
        catch (err) {
            const durationMs = Date.now() - startedAt;
            const message = err instanceof Error ? err.message : "Agent execution failed.";
            await this.update(runId, {
                status: "failed",
                error_message: message,
                duration_ms: durationMs,
                completed_at: new Date().toISOString(),
            });
            throw err instanceof AgentError
                ? err
                : new AgentError(message, "agent_failed");
        }
    }
    // --- logging helpers -------------------------------------------------------
    /** Insert the `running` log row. Returns its id, or null on failure. */
    async logStart(input) {
        const { data } = await this.client
            .from("agent_runs")
            .insert({
            organization_id: this.organizationId,
            agent_type: this.agentType,
            status: "running",
            triggered_by: this.triggeredBy,
            input_params: (input ?? null),
            started_at: new Date().toISOString(),
        })
            .select("id")
            .single();
        // Meter this run against the org's daily agent_runs quota (Contracts §25).
        // Best-effort and decoupled from the run itself - a tracking failure must
        // never block the agent. The entry route enforces the limit before we get
        // here; this keeps the usage_metrics history complete for the dashboards.
        await (0, usage_tracker_1.trackUsage)(this.client, this.organizationId, "agent_runs", 1);
        return data?.id ?? null;
    }
    /** Patch the run row. No-op when there is no row id. Best-effort. */
    async update(runId, patch) {
        if (!runId)
            return;
        await this.client.from("agent_runs").update(patch).eq("id", runId);
    }
    // --- timeout ---------------------------------------------------------------
    /** Reject with an AgentError if `work` exceeds this agent's `timeoutMs`. */
    withTimeout(work) {
        let timer = undefined;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(new AgentError(`Agent timed out after ${this.timeoutMs / 1000}s.`, "timeout", 504));
            }, this.timeoutMs);
        });
        return Promise.race([work, timeout]).finally(() => {
            if (timer)
                clearTimeout(timer);
        });
    }
}
exports.BaseAgent = BaseAgent;
