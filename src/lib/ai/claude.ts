import Anthropic from "@anthropic-ai/sdk";

import { createAdminClient } from "@/lib/supabase/admin";
import { withClaudeLimit } from "@/lib/ai/claude-concurrency";
import { getUsageContext } from "@/lib/ai/usage-context";
import { computeCostUsd } from "@/lib/ai/pricing";
import { recordCost } from "@/lib/pil/cost";

/**
 * Claude API wrapper with token tracking.
 *
 * SERVER-ONLY. The default API key is read from the server-only
 * ANTHROPIC_API_KEY env var and must never reach the client. Every call
 * returns the tokens consumed so callers (agents, AI routes) can persist
 * usage to agent_runs.tokens_used for cost monitoring (Behavioral Contracts
 * §15, §16).
 *
 * BYOK: callers may pass `apiKey` on the request to use an org's own,
 * decrypted key (src/lib/autoapply/usage-meter.ts's `shouldUseOwnKeys()`)
 * instead of the platform key — a fresh, uncached Anthropic client is built
 * per call in that case so one org's key is never reused for another's
 * request or mixed into the module-level singleton.
 */

/** Default model. Overridable per call or via the `ai.model` platform_config flag. */
export const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Default output ceiling. Mirrors the `ai.max_tokens` platform_config flag. */
export const DEFAULT_MAX_TOKENS = 8192;

let client: Anthropic | null = null;

function getClient(apiKeyOverride?: string): Anthropic {
  if (apiKeyOverride) {
    // Never cached on the module singleton — a BYOK key is scoped to the one
    // call that requested it.
    return new Anthropic({ apiKey: apiKeyOverride });
  }

  if (client) return client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  client = new Anthropic({ apiKey });
  return client;
}

function isAuthError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 401;
}

/**
 * Best-effort, throttled admin alert when the PLATFORM's own ANTHROPIC_API_KEY
 * (never a BYOK org key — that's a per-org config issue, not a platform
 * outage) is rejected. Writes to `system_errors`, the same table
 * /api/admin/system already surfaces as a loud, colored `error_count_24h`
 * card on /admin/system — so a dead platform credential is visible there
 * within minutes, not only discoverable by hand-querying agent_runs.
 * Throttled per warm process to avoid flooding the table when many agents
 * fail the same way in a short window; never throws, never blocks the
 * caller's real error path.
 */
let lastPlatformAuthErrorAlertAt = 0;
const PLATFORM_AUTH_ERROR_ALERT_THROTTLE_MS = 10 * 60 * 1000;

async function reportPlatformKeyAuthFailure(
  source: string,
  err: unknown,
): Promise<void> {
  const now = Date.now();
  if (now - lastPlatformAuthErrorAlertAt < PLATFORM_AUTH_ERROR_ALERT_THROTTLE_MS) {
    return;
  }
  lastPlatformAuthErrorAlertAt = now;

  try {
    const admin = createAdminClient();
    await admin.from("system_errors").insert({
      source: "anthropic_api",
      error_type: "platform_key_authentication_error",
      message:
        `Platform ANTHROPIC_API_KEY rejected by Anthropic (401 authentication_error) on a ${source} call. ` +
        "Every agent without a BYOK org key is degraded until this is replaced in Vercel prod env vars " +
        "and local .env.local — no code-level workaround exists for an invalid credential. " +
        `Raw error: ${err instanceof Error ? err.message : String(err)}`,
      severity: "critical",
    });
  } catch {
    // Alerting must never mask or block the caller's real error.
  }
}

// AR-9.2: best-effort, throttled admin alert when an Anthropic call ran with
// no usage context set (getUsageContext() returned undefined) -- its cost
// could not be attributed to an org and was not recorded. This is the
// visible signal for exactly the failure mode this fix exists to close: a
// call that goes unmeasured must never look identical to one that cost
// nothing.
let lastUncontextedCallAlertAt = 0;
const USAGE_LOG_ALERT_THROTTLE_MS = 10 * 60 * 1000;

async function reportUncontextedCall(source: string): Promise<void> {
  const now = Date.now();
  if (now - lastUncontextedCallAlertAt < USAGE_LOG_ALERT_THROTTLE_MS) return;
  lastUncontextedCallAlertAt = now;
  try {
    await createAdminClient().from("system_errors").insert({
      source: "ai_usage_log",
      error_type: "usage_log_no_context",
      message:
        `A ${source} call ran with no organization/agent usage context set ` +
        "(src/lib/ai/usage-context.ts) -- its cost could not be attributed " +
        "and was not recorded in ai_usage_log.",
      severity: "warning",
    });
  } catch {
    // Alerting must never mask or block the caller's real response.
  }
}

let lastUsageLogWriteErrorAlertAt = 0;

async function reportUsageLogWriteFailure(source: string, err: unknown): Promise<void> {
  const now = Date.now();
  if (now - lastUsageLogWriteErrorAlertAt < USAGE_LOG_ALERT_THROTTLE_MS) return;
  lastUsageLogWriteErrorAlertAt = now;
  try {
    await createAdminClient().from("system_errors").insert({
      source: "ai_usage_log",
      error_type: "usage_log_write_failed",
      message:
        `Failed to write ai_usage_log for a ${source} call: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      severity: "warning",
    });
  } catch {
    // Alerting must never mask or block the caller's real response.
  }
}

/**
 * Records one Anthropic call's cost to the single per-call ledger
 * (ai_usage_log, AR-5.1/AR-9.2). Never throws -- a logging failure must
 * never fail an Anthropic call that already succeeded. Skips recording (and
 * alerts instead) when no usage context is set, since organization_id is
 * NOT NULL on ai_usage_log and there is nothing to attribute the row to.
 */
async function recordUsage(
  source: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  durationMs: number,
): Promise<void> {
  const context = getUsageContext();
  if (!context) {
    await reportUncontextedCall(source);
    return;
  }

  try {
    const costUsd = await computeCostUsd(model, inputTokens, outputTokens);
    await recordCost({
      organization_id: context.organizationId,
      model,
      endpoint: source,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      cost_usd: costUsd,
      duration_ms: durationMs,
      agent_type: context.agentType,
      agent_run_id: context.agentRunId ?? null,
      pil_agent_run_id: null,
      provider: "anthropic",
      billing_path: "api",
    });
  } catch (err) {
    await reportUsageLogWriteFailure(source, err);
  }
}

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ClaudeRequest {
  /** User-turn content. */
  prompt: string;
  /** Optional system prompt (org context, grant-writer persona, etc.). */
  system?: string;
  /** Model id. Defaults to {@link DEFAULT_MODEL}. */
  model?: string;
  /** Max output tokens. Defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
  /** Sampling temperature (0-1). */
  temperature?: number;
  /**
   * BYOK override — an org's own decrypted Anthropic key
   * (usage-meter.ts's `shouldUseOwnKeys()`). When set, this call uses that
   * key instead of the platform ANTHROPIC_API_KEY and a platform-key auth
   * failure is never reported for it (a bad BYOK key is that org's own
   * configuration problem, not a platform-wide outage).
   */
  apiKey?: string;
}

export interface ClaudeResponse {
  /** Concatenated text from all text content blocks. */
  text: string;
  usage: ClaudeUsage;
  model: string;
  /** Why generation stopped, e.g. "end_turn" | "max_tokens". */
  stopReason: string | null;
}

/**
 * Send a single-turn message to Claude and return the text plus token usage.
 * Throws if ANTHROPIC_API_KEY is missing or the API call fails - callers are
 * responsible for logging the failure to agent_runs (agents never fail silently).
 */
export async function callClaude(req: ClaudeRequest): Promise<ClaudeResponse> {
  const model = req.model ?? DEFAULT_MODEL;
  const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
  const startedAt = Date.now();

  let message;
  try {
    message = await withClaudeLimit(() =>
      getClient(req.apiKey).messages.create({
        model,
        max_tokens: maxTokens,
        ...(req.system ? { system: req.system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: [{ role: "user", content: req.prompt }],
      }),
    );
  } catch (err) {
    if (!req.apiKey && isAuthError(err)) {
      await reportPlatformKeyAuthFailure("callClaude", err);
    }
    throw err;
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;

  await recordUsage("callClaude", message.model, inputTokens, outputTokens, Date.now() - startedAt);

  return {
    text,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    model: message.model,
    stopReason: message.stop_reason,
  };
}

export interface ClaudeConversationRequest {
  /** Prior turns plus the final user turn, in order. */
  messages: { role: "user" | "assistant"; content: string }[];
  /** Optional system prompt. */
  system?: string;
  /** Model id. Defaults to {@link DEFAULT_MODEL}. */
  model?: string;
  /** Max output tokens. Defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
  /** Sampling temperature (0-1). */
  temperature?: number;
  /** BYOK override - see {@link ClaudeRequest.apiKey}. */
  apiKey?: string;
}

/**
 * Same contract as {@link callClaude}, but for multi-turn conversations - the
 * caller supplies the full messages array (prior turns + the current one)
 * instead of a single prompt string. Used by surfaces that carry chat history,
 * e.g. Benavora Assist (src/lib/knowledge/assist.ts).
 */
export async function callClaudeConversation(
  req: ClaudeConversationRequest,
): Promise<ClaudeResponse> {
  const model = req.model ?? DEFAULT_MODEL;
  const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
  const startedAt = Date.now();

  let message;
  try {
    message = await withClaudeLimit(() =>
      getClient(req.apiKey).messages.create({
        model,
        max_tokens: maxTokens,
        ...(req.system ? { system: req.system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: req.messages,
      }),
    );
  } catch (err) {
    if (!req.apiKey && isAuthError(err)) {
      await reportPlatformKeyAuthFailure("callClaudeConversation", err);
    }
    throw err;
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;

  await recordUsage(
    "callClaudeConversation",
    message.model,
    inputTokens,
    outputTokens,
    Date.now() - startedAt,
  );

  return {
    text,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    model: message.model,
    stopReason: message.stop_reason,
  };
}

export interface ClaudeToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ClaudeToolCallRequest {
  /** Full message history, including any prior assistant tool_use / user tool_result blocks. */
  messages: Anthropic.MessageParam[];
  /** Optional system prompt. */
  system?: string;
  /** Tools the model may call this turn. */
  tools: ClaudeToolSpec[];
  /** Model id. Defaults to {@link DEFAULT_MODEL}. */
  model?: string;
  /** Max output tokens. Defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
  /** BYOK override - see {@link ClaudeRequest.apiKey}. */
  apiKey?: string;
}

export interface ClaudeToolCallResponse {
  /** Raw content blocks (text and/or tool_use) - the caller runs any tool_use blocks itself. */
  content: Anthropic.ContentBlock[];
  usage: ClaudeUsage;
  model: string;
  stopReason: string | null;
}

/**
 * Same contract as {@link callClaudeConversation}, but with Anthropic tool use
 * (function calling) enabled. Returns the raw content blocks uninterpreted -
 * the caller is responsible for running any `tool_use` blocks and feeding
 * `tool_result` blocks back in via `messages` on the next call, looping until
 * `stopReason` is no longer `"tool_use"`. Used by the in-app Benavora Assist
 * surface (src/lib/knowledge/assist.ts's `answerApp`).
 */
export async function callClaudeWithTools(req: ClaudeToolCallRequest): Promise<ClaudeToolCallResponse> {
  const model = req.model ?? DEFAULT_MODEL;
  const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
  const startedAt = Date.now();

  let message;
  try {
    message = await withClaudeLimit(() =>
      getClient(req.apiKey).messages.create({
        model,
        max_tokens: maxTokens,
        ...(req.system ? { system: req.system } : {}),
        messages: req.messages,
        tools: req.tools as unknown as Anthropic.Tool[],
      }),
    );
  } catch (err) {
    if (!req.apiKey && isAuthError(err)) {
      await reportPlatformKeyAuthFailure("callClaudeWithTools", err);
    }
    throw err;
  }

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;

  await recordUsage(
    "callClaudeWithTools",
    message.model,
    inputTokens,
    outputTokens,
    Date.now() - startedAt,
  );

  return {
    content: message.content,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    model: message.model,
    stopReason: message.stop_reason,
  };
}

export interface ClaudeWebSearchResponse extends ClaudeResponse {
  /** True if Claude actually issued a web_search tool call for this turn. */
  usedWebSearch: boolean;
}

/**
 * Same contract as {@link callClaude}, but grants Claude the server-side
 * web_search tool so responses can cite live data instead of training-data
 * recall. web_search_20250305 is a real, GA Anthropic tool served under the
 * standard `anthropic-version: 2023-06-01` header this SDK always sends (see
 * @anthropic-ai/sdk@0.30.1's core.js) - no anthropic-beta header required.
 * The pinned SDK predates this tool's TS types (no WebSearchTool variant in
 * its `Tool` union), so the tool object is cast around the stale type the
 * same way the pinned google-auth-library/googleapis mismatch is cast
 * elsewhere in this codebase - the wire format is correct even though the
 * local type declarations haven't caught up.
 */
export async function callClaudeWithWebSearch(
  req: ClaudeRequest & { maxSearches?: number },
): Promise<ClaudeWebSearchResponse> {
  const model = req.model ?? DEFAULT_MODEL;
  const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;
  const startedAt = Date.now();

  const webSearchTool = {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: req.maxSearches ?? 5,
  } as unknown as Anthropic.Tool;

  let message;
  try {
    message = await withClaudeLimit(() =>
      getClient(req.apiKey).messages.create({
        model,
        max_tokens: maxTokens,
        ...(req.system ? { system: req.system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: [{ role: "user", content: req.prompt }],
        tools: [webSearchTool],
      }),
    );
  } catch (err) {
    if (!req.apiKey && isAuthError(err)) {
      await reportPlatformKeyAuthFailure("callClaudeWithWebSearch", err);
    }
    throw err;
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const usedWebSearch = message.content.some(
    (block) => (block as { type: string }).type === "server_tool_use",
  );

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;

  await recordUsage(
    "callClaudeWithWebSearch",
    message.model,
    inputTokens,
    outputTokens,
    Date.now() - startedAt,
  );

  return {
    text,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    model: message.model,
    stopReason: message.stop_reason,
    usedWebSearch,
  };
}
