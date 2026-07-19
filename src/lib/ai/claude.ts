import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude API wrapper with token tracking.
 *
 * SERVER-ONLY. The API key is read from the server-only ANTHROPIC_API_KEY env
 * var and must never reach the client. Every call returns the tokens consumed
 * so callers (agents, AI routes) can persist usage to agent_runs.tokens_used
 * for cost monitoring (Behavioral Contracts §15, §16).
 */

/** Default model. Overridable per call or via the `ai.model` platform_config flag. */
export const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Default output ceiling. Mirrors the `ai.max_tokens` platform_config flag. */
export const DEFAULT_MAX_TOKENS = 8192;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  client = new Anthropic({ apiKey });
  return client;
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

  const message = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    ...(req.system ? { system: req.system } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    messages: [{ role: "user", content: req.prompt }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;

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

  const webSearchTool = {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: req.maxSearches ?? 5,
  } as unknown as Anthropic.Tool;

  const message = await getClient().messages.create({
    model,
    max_tokens: maxTokens,
    ...(req.system ? { system: req.system } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    messages: [{ role: "user", content: req.prompt }],
    tools: [webSearchTool],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const usedWebSearch = message.content.some(
    (block) => (block as { type: string }).type === "server_tool_use",
  );

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;

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
