// Structured-extraction stage for the research pipeline (AGENTS.md Agent 01
// "Grant Summary", reused by the research agents 12-15).
//
// Takes the raw text of a candidate funding page and asks Claude to pull out a
// single structured opportunity. Per BEHAVIORAL_CONTRACTS §9/§17 the model
// extracts only what the page states and returns null for anything absent — it
// never fabricates. This module then validates the result (deadline must be in
// the future, amounts must be positive) and computes a confidence score from
// how completely the core fields were filled, so the caller can decide whether
// the extraction is trustworthy enough to persist.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { FUNDER_CATEGORIES, OPPORTUNITY_RECURRENCES } from "@/lib/utils/constants";
import type { Enums } from "@/types/database";

type FunderCategory = Enums<"funder_category">;
type Recurrence = (typeof OPPORTUNITY_RECURRENCES)[number];

/**
 * The structured opportunity extracted from a page. Field names match the task
 * spec's output shape (snake_case) so it maps cleanly onto opportunities rows.
 * Every field except `name` may be null when the page does not state it.
 */
export interface ParsedOpportunity {
  name: string;
  funder_name: string | null;
  category: FunderCategory | null;
  description: string | null;
  amount_min: number | null;
  amount_max: number | null;
  /** ISO date (YYYY-MM-DD) in the future, or null. */
  deadline: string | null;
  url: string | null;
  eligibility_requirements: string | null;
  required_documents: string[] | null;
  application_method: string | null;
  recurrence: Recurrence | null;
  geographic_restrictions: string | null;
}

export interface ParseResult {
  /** The extracted opportunity, or null when nothing usable was found. */
  opportunity: ParsedOpportunity | null;
  /** 0-100 quality estimate based on coverage of the core fields. */
  confidence: number;
  /** Notes on anything dropped or corrected during validation. */
  warnings: string[];
  /** Claude tokens consumed, for the caller to roll into agent_runs. */
  tokensUsed: number;
}

export interface ParseOptions {
  /** Raw page text (or HTML — it is treated as opaque source text). */
  rawContent: string;
  /** The page URL; carried through onto the parsed opportunity. */
  sourceUrl: string;
  model?: string;
  maxTokens?: number;
}

/** Cap source text sent to the model to keep input tokens bounded. */
const MAX_CONTENT_CHARS = 14_000;

/**
 * Extract a structured opportunity from raw page content. Never throws —
 * unreadable model output yields `{ opportunity: null, confidence: 0 }` so a
 * single bad page never halts a research run (Contracts §17).
 */
export async function parseOpportunity(
  options: ParseOptions,
): Promise<ParseResult> {
  const rawContent = options.rawContent.trim();
  if (rawContent === "") {
    return {
      opportunity: null,
      confidence: 0,
      warnings: ["empty_content"],
      tokensUsed: 0,
    };
  }

  const { system, prompt } = buildPrompt(
    rawContent.slice(0, MAX_CONTENT_CHARS),
    options.sourceUrl,
  );

  let text: string;
  let tokensUsed = 0;
  try {
    const response = await callClaude({
      system,
      prompt,
      model: options.model ?? DEFAULT_MODEL,
      maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    });
    text = response.text;
    tokensUsed = response.usage.totalTokens;
  } catch (err) {
    console.error(`[result-parser] Claude call failed for ${options.sourceUrl}:`, err);
    return {
      opportunity: null,
      confidence: 0,
      warnings: ["extraction_failed"],
      tokensUsed: 0,
    };
  }

  const raw = parseJsonObject(text);
  if (!raw) {
    return {
      opportunity: null,
      confidence: 0,
      warnings: ["bad_model_output"],
      tokensUsed,
    };
  }

  const { opportunity, warnings } = validate(raw, options.sourceUrl);
  if (!opportunity || !opportunity.name) {
    return {
      opportunity: null,
      confidence: 0,
      warnings: warnings.length ? warnings : ["no_opportunity_found"],
      tokensUsed,
    };
  }

  return {
    opportunity,
    confidence: scoreConfidence(opportunity, warnings),
    warnings,
    tokensUsed,
  };
}

// --- prompt ------------------------------------------------------------------

function buildPrompt(
  content: string,
  sourceUrl: string,
): { system: string; prompt: string } {
  const system = [
    "You extract a single funding opportunity from a web page for a nonprofit's research system.",
    "",
    "RULES:",
    "1. Use ONLY information present in the page text. Never invent names, amounts, dates, or requirements. Use null for anything the page does not state.",
    "2. If the page is not a fundable grant, donation, or sponsorship opportunity (e.g. a homepage, article, or login wall), return {\"name\": null}.",
    `3. category MUST be exactly one of: ${FUNDER_CATEGORIES.join(", ")}. If unsure, use null.`,
    `4. recurrence MUST be one of: ${OPPORTUNITY_RECURRENCES.join(", ")}, or null.`,
    "5. amount_min / amount_max are plain numbers (no currency symbols or commas). deadline is an ISO date YYYY-MM-DD.",
    "6. required_documents is an array of short document names, or null.",
    "7. Respond with ONLY a JSON object, no prose and no code fences, with exactly these keys:",
    '{"name": string|null, "funder_name": string|null, "category": string|null, "description": string|null, "amount_min": number|null, "amount_max": number|null, "deadline": string|null, "eligibility_requirements": string|null, "required_documents": string[]|null, "application_method": string|null, "recurrence": string|null, "geographic_restrictions": string|null}',
  ].join("\n");

  const prompt = [
    `## Source URL\n${sourceUrl}`,
    "",
    "## Page text",
    content,
    "",
    "Extract the opportunity now. Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}

// --- parsing + validation ----------------------------------------------------

/** Scan for the first balanced-looking JSON object; tolerant of stray prose. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1));
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function toPositiveNumberOrNull(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toCategory(value: unknown): FunderCategory | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (FUNDER_CATEGORIES as readonly string[]).includes(v)
    ? (v as FunderCategory)
    : null;
}

function toRecurrence(value: unknown): Recurrence | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (OPPORTUNITY_RECURRENCES as readonly string[]).includes(v)
    ? (v as Recurrence)
    : null;
}

/** Validate + coerce the raw object, collecting warnings for dropped data. */
function validate(
  raw: Record<string, unknown>,
  sourceUrl: string,
): { opportunity: ParsedOpportunity | null; warnings: string[] } {
  const warnings: string[] = [];

  const name = toStringOrNull(raw.name);
  if (!name) return { opportunity: null, warnings };

  const category = toCategory(raw.category);
  if (raw.category != null && !category) warnings.push("unknown_category");

  // Amounts must be positive; order them so min <= max.
  let amountMin = toPositiveNumberOrNull(raw.amount_min);
  let amountMax = toPositiveNumberOrNull(raw.amount_max);
  if (raw.amount_min != null && amountMin === null) warnings.push("invalid_amount_min");
  if (raw.amount_max != null && amountMax === null) warnings.push("invalid_amount_max");
  if (amountMin !== null && amountMax !== null && amountMin > amountMax) {
    [amountMin, amountMax] = [amountMax, amountMin];
    warnings.push("amounts_reordered");
  }

  // Deadline must be a real date in the future (Contracts §5).
  let deadline: string | null = null;
  const rawDeadline = toStringOrNull(raw.deadline);
  if (rawDeadline) {
    const iso = /^\d{4}-\d{2}-\d{2}/.exec(rawDeadline)?.[0];
    if (!iso) {
      warnings.push("invalid_deadline");
    } else {
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) warnings.push("invalid_deadline");
      else if (ms <= Date.now()) warnings.push("past_deadline");
      else deadline = iso;
    }
  }

  const docs = Array.isArray(raw.required_documents)
    ? raw.required_documents
        .map((d) => (typeof d === "string" ? d.trim() : ""))
        .filter((d) => d !== "")
    : null;

  const opportunity: ParsedOpportunity = {
    name,
    funder_name: toStringOrNull(raw.funder_name),
    category,
    description: toStringOrNull(raw.description),
    amount_min: amountMin,
    amount_max: amountMax,
    deadline,
    url: sourceUrl,
    eligibility_requirements: toStringOrNull(raw.eligibility_requirements),
    required_documents: docs && docs.length > 0 ? docs : null,
    application_method: toStringOrNull(raw.application_method),
    recurrence: toRecurrence(raw.recurrence),
    geographic_restrictions: toStringOrNull(raw.geographic_restrictions),
  };

  return { opportunity, warnings };
}

// --- confidence --------------------------------------------------------------

/**
 * Confidence reflects how completely the core fields were extracted, minus
 * penalties for data we had to drop in validation. Deterministic so identical
 * inputs always score the same.
 */
function scoreConfidence(opp: ParsedOpportunity, warnings: string[]): number {
  let score = 100;
  const drop = (cond: boolean, pts: number) => {
    if (cond) score -= pts;
  };

  drop(!opp.funder_name, 12);
  drop(!opp.category, 15);
  drop(!opp.description, 8);
  drop(opp.amount_min === null && opp.amount_max === null, 12);
  drop(!opp.deadline, 10);
  drop(!opp.eligibility_requirements, 8);
  drop(!opp.application_method, 5);

  // Validation corrections signal a lower-quality source page.
  for (const w of warnings) {
    if (w === "past_deadline" || w === "invalid_deadline") score -= 8;
    else if (w.startsWith("invalid_amount")) score -= 4;
    else if (w === "unknown_category") score -= 6;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
