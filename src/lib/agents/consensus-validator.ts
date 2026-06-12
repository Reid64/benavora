// Cross-provider consensus validation (api/ai/validate, migration 014).
//
// After the research agents discover an opportunity, each finding is sent to two
// INDEPENDENT AI providers — Anthropic Claude and the free-tier Google Gemini —
// which each judge, on their own, whether the opportunity holds up:
//   1. existence    — does this opportunity / funding program plausibly exist?
//   2. eligibility  — are the stated eligibility requirements coherent & sane?
//   3. deadline     — is the deadline plausible (not past, not absurd)?
//   4. amounts      — are the dollar figures internally consistent & realistic?
//
// HONESTY (BEHAVIORAL_CONTRACTS §9): these providers reason from their training
// knowledge and the finding's own internal consistency — they do NOT browse the
// live web here. The prompt is explicit about this: a provider that cannot
// confidently judge a field returns `unverifiable` rather than inventing a fact.
// The value is the CONSENSUS — two independently-built models agreeing is a far
// stronger signal than either alone, and disagreement flags a finding for human
// review.
//
// Each provider's verdict is upserted to `validations` (one row per provider).
// An opportunity earns the "Verified" badge only when BOTH providers return
// `verified` — see {@link computeConsensus}, which is pure so the UI can derive
// the same badge from the stored rows.

import type { SupabaseClient } from "@supabase/supabase-js";

import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  callGemini,
  DEFAULT_GEMINI_MODEL,
  isGeminiConfigured,
} from "@/lib/ai/gemini";
import {
  computeConsensus,
  VALIDATION_FIELDS,
  VALIDATION_PROVIDERS,
  type ConsensusStatus,
  type ConsensusSummary,
  type FieldCheck,
  type ParsedVerdict,
  type ValidationChecks,
  type ValidationField,
  type ValidationVerdict,
  type ValidationVerdictRow,
} from "@/lib/opportunities/validation";
import type { Json } from "@/types/database";

// Re-export the client-safe pieces so server callers can keep one import.
export { computeConsensus, VALIDATION_FIELDS, VALIDATION_PROVIDERS };
export type {
  ConsensusStatus,
  ConsensusSummary,
  FieldCheck,
  ParsedVerdict,
  ValidationChecks,
  ValidationField,
  ValidationVerdict,
  ValidationVerdictRow,
};

/** The opportunity facts a provider needs to judge a finding. */
export interface ValidationOpportunity {
  name: string;
  category: string;
  description: string | null;
  funderName: string | null;
  url: string | null;
  eligibilityRequirements: string | null;
  deadline: string | null;
  amountMin: number | null;
  amountMax: number | null;
  amountAvailable: number | null;
  geographicRestrictions: string | null;
}

/** One provider's outcome from a validation run. */
export interface ProviderValidationResult {
  provider: string;
  providerLabel: string;
  model: string | null;
  /** Null when the provider was unavailable (e.g. no key) or errored. */
  verdict: ParsedVerdict | null;
  tokensUsed: number;
  error?: string;
}

export interface ValidationRunResult {
  providers: ProviderValidationResult[];
  consensus: ConsensusSummary;
  totalTokens: number;
}

// --- prompt ------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a grant-research fact-checker validating an opportunity that an automated research agent discovered. Judge ONLY from your own knowledge and the internal consistency of the data you are given — you do NOT have live web access in this task. If you cannot confidently judge a field, mark it not-ok and say why; never invent a fact, a URL, or a deadline to fill a gap (fabrication is worse than admitting uncertainty).

Assess four things:
- existence: Does a funding opportunity / program like this plausibly exist? Does the funder name, category, and URL look real and mutually consistent?
- eligibility: Are the eligibility requirements coherent and internally consistent (not contradictory, not impossible)?
- deadline: Is the deadline plausible — a real future or recent date, not absurd or contradictory?
- amounts: Are the dollar figures realistic and internally consistent (min <= max, available covers the range, sane magnitude for this funder type)?

Respond with ONLY a JSON object, no prose, no code fence:
{
  "verdict": "verified" | "discrepancy" | "unverifiable",
  "confidence": <integer 0-100>,
  "checks": {
    "existence":   { "ok": <bool>, "note": "<short reason>" },
    "eligibility": { "ok": <bool>, "note": "<short reason>" },
    "deadline":    { "ok": <bool>, "note": "<short reason>" },
    "amounts":     { "ok": <bool>, "note": "<short reason>" }
  },
  "summary": "<one or two sentences>"
}

Verdict rules: "verified" only if every check is ok and you are reasonably confident. "discrepancy" if any check reveals something inaccurate, contradictory, or implausible. "unverifiable" if you simply lack the basis to judge.`;

function fmtAmount(n: number | null): string {
  return n == null ? "not provided" : `$${n.toLocaleString("en-US")}`;
}

/** Build the user-turn describing the finding to validate. */
export function buildValidationPrompt(opp: ValidationOpportunity): string {
  const lines = [
    "Validate this discovered funding opportunity:",
    "",
    `Name: ${opp.name}`,
    `Category: ${opp.category}`,
    `Funder: ${opp.funderName ?? "not provided"}`,
    `URL: ${opp.url ?? "not provided"}`,
    `Description: ${opp.description ?? "not provided"}`,
    `Eligibility requirements: ${opp.eligibilityRequirements ?? "not provided"}`,
    `Deadline: ${opp.deadline ?? "not provided"}`,
    `Award amount (min): ${fmtAmount(opp.amountMin)}`,
    `Award amount (max): ${fmtAmount(opp.amountMax)}`,
    `Total funding available: ${fmtAmount(opp.amountAvailable)}`,
    `Geographic restrictions: ${opp.geographicRestrictions ?? "not provided"}`,
  ];
  return lines.join("\n");
}

// --- parsing -----------------------------------------------------------------

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function coerceVerdict(value: unknown): ValidationVerdict {
  return value === "verified" || value === "discrepancy"
    ? value
    : "unverifiable";
}

function coerceCheck(raw: unknown): FieldCheck {
  const obj = (raw ?? {}) as { ok?: unknown; note?: unknown };
  return {
    ok: obj.ok === true,
    note: typeof obj.note === "string" ? obj.note : "",
  };
}

/**
 * Pull a JSON object out of a model's text, tolerating code fences or stray
 * prose around it. Returns a normalized {@link ParsedVerdict}; on any failure
 * returns an `unverifiable` verdict carrying the parse note (never throws).
 */
export function parseVerdict(text: string): ParsedVerdict {
  const fallback: ParsedVerdict = {
    verdict: "unverifiable",
    confidence: 0,
    checks: emptyChecks("Provider response could not be parsed."),
    summary: "Provider response could not be parsed.",
  };

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return fallback;

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return fallback;
  }

  const obj = raw as {
    verdict?: unknown;
    confidence?: unknown;
    checks?: Record<string, unknown>;
    summary?: unknown;
  };
  const checksRaw = obj.checks ?? {};

  return {
    verdict: coerceVerdict(obj.verdict),
    confidence: clampConfidence(obj.confidence),
    checks: {
      existence: coerceCheck(checksRaw.existence),
      eligibility: coerceCheck(checksRaw.eligibility),
      deadline: coerceCheck(checksRaw.deadline),
      amounts: coerceCheck(checksRaw.amounts),
    },
    summary: typeof obj.summary === "string" ? obj.summary : "",
  };
}

function emptyChecks(note: string): ValidationChecks {
  return {
    existence: { ok: false, note },
    eligibility: { ok: false, note },
    deadline: { ok: false, note },
    amounts: { ok: false, note },
  };
}

// --- provider invocation -----------------------------------------------------

/** Ask Claude for a verdict. Throws on API failure (caller records the error). */
async function runClaude(
  prompt: string,
  model: string,
  maxTokens: number,
): Promise<{ verdict: ParsedVerdict; model: string; tokens: number }> {
  const res = await callClaude({
    system: SYSTEM_PROMPT,
    prompt,
    model,
    maxTokens,
    temperature: 0,
  });
  return {
    verdict: parseVerdict(res.text),
    model: res.model,
    tokens: res.usage.totalTokens,
  };
}

/** Ask Gemini for a verdict. Throws on API failure (caller records the error). */
async function runGemini(
  prompt: string,
  model: string,
  maxTokens: number,
): Promise<{ verdict: ParsedVerdict; model: string; tokens: number }> {
  const res = await callGemini({
    system: SYSTEM_PROMPT,
    prompt,
    model,
    maxTokens,
    temperature: 0,
    json: true,
  });
  return {
    verdict: parseVerdict(res.text),
    model: res.model,
    tokens: res.usage.totalTokens,
  };
}

export interface ValidateOptions {
  client: SupabaseClient;
  organizationId: string;
  opportunityId: string;
  opportunity: ValidationOpportunity;
  createdBy?: string | null;
  /** Claude model override; defaults to the platform default. */
  claudeModel?: string;
  /** Gemini model override; defaults to the free-tier flash model. */
  geminiModel?: string;
  maxTokens?: number;
}

/**
 * Validate one opportunity across both providers and upsert each verdict to
 * `validations`. The two provider calls run concurrently and independently
 * (Promise.allSettled) — one provider failing or being unconfigured never
 * aborts the other; that provider is recorded as unavailable and consensus
 * stays "pending". Returns every provider result plus the computed consensus.
 */
export async function validateOpportunity(
  options: ValidateOptions,
): Promise<ValidationRunResult> {
  const {
    client,
    organizationId,
    opportunityId,
    opportunity,
    createdBy = null,
  } = options;
  const maxTokens = options.maxTokens ?? 1024;
  const claudeModel = options.claudeModel ?? DEFAULT_MODEL;
  const geminiModel = options.geminiModel ?? DEFAULT_GEMINI_MODEL;
  const prompt = buildValidationPrompt(opportunity);

  const settled = await Promise.allSettled([
    runClaude(prompt, claudeModel, maxTokens),
    isGeminiConfigured()
      ? runGemini(prompt, geminiModel, maxTokens)
      : Promise.reject(
          new Error(
            "Free-tier provider not configured (set GEMINI_API_KEY).",
          ),
        ),
  ]);

  const providers: ProviderValidationResult[] = [
    toProviderResult(VALIDATION_PROVIDERS.claude, settled[0]),
    toProviderResult(VALIDATION_PROVIDERS.gemini, settled[1]),
  ];

  // Persist each provider that produced a verdict (upsert: one row per provider).
  for (const p of providers) {
    if (!p.verdict) continue;
    const row = {
      organization_id: organizationId,
      opportunity_id: opportunityId,
      provider: p.provider,
      model: p.model,
      verdict: p.verdict.verdict,
      confidence: p.verdict.confidence,
      details: {
        checks: p.verdict.checks,
        summary: p.verdict.summary,
      } as unknown as Json,
      created_by: createdBy,
      updated_at: new Date().toISOString(),
    };
    const { error } = await client
      .from("validations")
      .upsert(row, { onConflict: "opportunity_id,provider" });
    if (error) {
      // Don't fail the run on a persistence hiccup; surface it on the result.
      p.error = p.error ?? `Could not store verdict: ${error.message}`;
    }
  }

  const consensus = computeConsensus(
    providers
      .filter((p) => p.verdict)
      .map((p) => ({ verdict: p.verdict!.verdict })),
  );

  return {
    providers,
    consensus,
    totalTokens: providers.reduce((s, p) => s + p.tokensUsed, 0),
  };
}

function toProviderResult(
  meta: { id: string; label: string },
  settled: PromiseSettledResult<{
    verdict: ParsedVerdict;
    model: string;
    tokens: number;
  }>,
): ProviderValidationResult {
  if (settled.status === "fulfilled") {
    return {
      provider: meta.id,
      providerLabel: meta.label,
      model: settled.value.model,
      verdict: settled.value.verdict,
      tokensUsed: settled.value.tokens,
    };
  }
  return {
    provider: meta.id,
    providerLabel: meta.label,
    model: null,
    verdict: null,
    tokensUsed: 0,
    error:
      settled.reason instanceof Error
        ? settled.reason.message
        : "Provider validation failed.",
  };
}
