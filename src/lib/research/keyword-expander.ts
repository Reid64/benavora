// Keyword expansion for search profiles — overnight-006.
//
// Given an existing search profile's keywords, mission statement, and focus
// areas, asks Claude to suggest additional high-signal search terms that would
// surface more relevant grant opportunities. The caller decides which to keep;
// this module only generates candidates.
//
// Output is deterministic-ish (temperature=0) so repeated calls on the same
// profile do not produce wildly different sets. Each term is cleaned, trimmed,
// and deduplicated before return.

import { callClaude } from "@/lib/ai/claude";

export interface KeywordExpansionInput {
  /** The profile's existing keywords (used for dedup and context). */
  existingKeywords: string[];
  /** Org mission statement for context. */
  missionStatement: string | null;
  /** Profile geographic scope for context. */
  geographicScope: string | null;
  /** Profile focus-area labels for context. */
  focusAreaLabels: string[];
  /** Population-served tags for context. */
  populationsServed: string[];
  /** Funder categories the profile targets (human-readable). */
  categories: string[];
  /** How many NEW keywords to suggest (default: 10). */
  count?: number;
}

export interface KeywordExpansionResult {
  /** Suggested keywords, already deduped against existingKeywords. */
  suggested: string[];
  /** Total Claude tokens consumed. */
  tokensUsed: number;
}

/** Hard cap on how many keywords the AI may suggest in one call. */
const MAX_SUGGEST = 20;

/**
 * Suggest additional search keywords for a search profile. Never throws —
 * a failed AI call returns empty results so the caller can proceed.
 */
export async function expandKeywords(
  input: KeywordExpansionInput,
): Promise<KeywordExpansionResult> {
  const count = Math.min(input.count ?? 10, MAX_SUGGEST);
  const existingSet = new Set(
    input.existingKeywords.map((k) => k.trim().toLowerCase()),
  );

  const contextLines: string[] = [];
  if (input.missionStatement) {
    contextLines.push(`Mission: ${input.missionStatement}`);
  }
  if (input.geographicScope) {
    contextLines.push(`Geographic scope: ${input.geographicScope}`);
  }
  if (input.focusAreaLabels.length > 0) {
    contextLines.push(`Focus areas: ${input.focusAreaLabels.join(", ")}`);
  }
  if (input.populationsServed.length > 0) {
    contextLines.push(`Populations served: ${input.populationsServed.join(", ")}`);
  }
  if (input.categories.length > 0) {
    contextLines.push(`Funding categories: ${input.categories.join(", ")}`);
  }
  if (input.existingKeywords.length > 0) {
    contextLines.push(`Existing keywords: ${input.existingKeywords.join(", ")}`);
  }

  const prompt = `You are helping a nonprofit improve its grant-discovery search profile. Suggest ${count} additional search keywords that would surface relevant funding opportunities they may be missing.

${contextLines.join("\n")}

Rules:
- Each keyword should be 1-5 words and work as a search query term.
- Do NOT repeat the existing keywords listed above.
- Focus on terms that funders, grant databases, and government portals actually use.
- Include both broad terms and specific program names where applicable.
- Return ONLY a JSON array of strings — no explanations, no markdown fences.

Example output format: ["affordable housing", "emergency shelter", "rapid rehousing", "CDBG", "HUD CoC"]`;

  let claudeResult: { text: string; usage: { totalTokens: number } };
  try {
    claudeResult = await callClaude({ prompt, maxTokens: 512, temperature: 0 });
  } catch {
    return { suggested: [], tokensUsed: 0 };
  }

  const suggested = parseKeywordArray(claudeResult.text)
    .filter((k) => {
      const norm = k.trim().toLowerCase();
      return norm !== "" && !existingSet.has(norm);
    })
    .slice(0, count);

  return { suggested, tokensUsed: claudeResult.usage.totalTokens };
}

// --- helpers -----------------------------------------------------------------

function parseKeywordArray(text: string): string[] {
  const clean = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    const parsed: unknown = JSON.parse(clean);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .map((k) => k.trim())
        .filter((k) => k !== "");
    }
  } catch {
    // Fall back to line-by-line if Claude returned a list.
    const lines = clean
      .split("\n")
      .map((l) =>
        l
          .replace(/^[-*•\d.)\s]+/, "")
          .replace(/["',]/g, "")
          .trim(),
      )
      .filter((l) => l !== "" && l.length < 80);
    if (lines.length > 0) return lines;
  }
  return [];
}
