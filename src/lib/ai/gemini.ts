/**
 * Google Gemini API wrapper — the free-tier second opinion for cross-provider
 * validation (api/ai/validate). Gemini's API has a no-cost tier, which is why it
 * is the independent provider paired against Claude for consensus.
 *
 * SERVER-ONLY. The key is read from the server-only GEMINI_API_KEY env var (with
 * GOOGLE_GENERATIVE_AI_API_KEY as a fallback name) and must never reach the
 * client. Implemented with plain `fetch` against the REST endpoint so no SDK
 * dependency is added. The shape mirrors {@link callClaude} (text + token usage)
 * so callers can treat the two providers uniformly.
 */

/** Default free-tier model. Overridable per call. */
export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

/** Default output ceiling, matched to the Claude wrapper. */
export const DEFAULT_GEMINI_MAX_TOKENS = 4096;

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Whether a free-tier provider key is configured at all. */
export function isGeminiConfigured(): boolean {
  return Boolean(geminiKey());
}

function geminiKey(): string | undefined {
  return (
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY
  );
}

export interface GeminiUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface GeminiRequest {
  /** User-turn content. */
  prompt: string;
  /** Optional system instruction. */
  system?: string;
  /** Model id. Defaults to {@link DEFAULT_GEMINI_MODEL}. */
  model?: string;
  /** Max output tokens. Defaults to {@link DEFAULT_GEMINI_MAX_TOKENS}. */
  maxTokens?: number;
  /** Sampling temperature (0–1). */
  temperature?: number;
  /** Ask Gemini to emit `application/json` (used for structured verdicts). */
  json?: boolean;
}

export interface GeminiResponse {
  /** Concatenated text from all returned parts. */
  text: string;
  usage: GeminiUsage;
  model: string;
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/**
 * Send a single-turn message to Gemini and return the text plus token usage.
 * Throws if the key is missing or the API call fails — the validator catches
 * this and records the provider as unavailable rather than failing the run.
 */
export async function callGemini(req: GeminiRequest): Promise<GeminiResponse> {
  const key = geminiKey();
  if (!key) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const model = req.model ?? DEFAULT_GEMINI_MODEL;
  const maxTokens = req.maxTokens ?? DEFAULT_GEMINI_MAX_TOKENS;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (req.system) {
    body.systemInstruction = { parts: [{ text: req.system }] };
  }

  const res = await fetch(
    `${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as GeminiApiResponse;
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");

  const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  const totalTokens =
    data.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens;

  return {
    text,
    usage: { inputTokens, outputTokens, totalTokens },
    model,
  };
}
