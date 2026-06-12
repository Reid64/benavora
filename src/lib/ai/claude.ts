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
export const DEFAULT_MAX_TOKENS = 4096;

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
  /** Sampling temperature (0–1). */
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
 * Throws if ANTHROPIC_API_KEY is missing or the API call fails — callers are
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
