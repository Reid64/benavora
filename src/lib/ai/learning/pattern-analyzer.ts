// Pattern analyzer - step 2b of the Recursive Learning Agent (AGENTS.md Agent 10).
//
// Compares an awarded narrative against denied narratives for the same
// funder_category to identify effective language patterns, structural elements,
// concrete data points, and tone differences. Returns a structured analysis
// stored in proven_narratives.success_patterns (migration 017).
//
// Per Behavioral Contracts §9 the model quotes directly from the supplied
// narratives and never invents patterns not present in the text.

import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import type { SuccessPatternAnalysis, SuccessPatternEntry } from "@/types/ai";

export interface PatternAnalysisInput {
  funderCategory: string;
  winningNarrative: string;
  deniedNarratives: string[];
}

const PATTERN_MAX_TOKENS = 2048;
const DENIED_EXCERPT_CHARS = 1000;
const MAX_DENIED_SAMPLES = 3;
const WINNING_EXCERPT_CHARS = 3000;

function renderDenied(narratives: string[]): string {
  if (narratives.length === 0) {
    return "(No denied narratives with snapshots are available for this funder category. Analyze the winning narrative alone and note its strongest elements.)";
  }
  return narratives
    .slice(0, MAX_DENIED_SAMPLES)
    .map((text, i) => {
      const body = text.replace(/\s+/g, " ").trim();
      const excerpt =
        body.length > DENIED_EXCERPT_CHARS
          ? `${body.slice(0, DENIED_EXCERPT_CHARS)}...`
          : body;
      return `### Denied narrative ${i + 1}\n${excerpt}`;
    })
    .join("\n\n");
}

/**
 * Analyze a winning narrative against denied narratives for the same funder
 * category. Returns structured winning/losing patterns and recommendations.
 *
 * Returns null when the model produces no parseable JSON - callers should treat
 * this as "no patterns stored" rather than a hard failure.
 */
export async function analyzePatterns(
  input: PatternAnalysisInput,
  model = DEFAULT_MODEL,
  maxTokens = PATTERN_MAX_TOKENS,
): Promise<{ analysis: SuccessPatternAnalysis; tokensUsed: number } | null> {
  const outputSchema = JSON.stringify({
    winning_patterns: [
      {
        description: "one sentence describing the effective pattern",
        example: "brief quote or paraphrase from the winning narrative",
      },
    ],
    losing_patterns: [
      {
        description: "one sentence describing the weak pattern",
        example: "brief quote or paraphrase from a denied narrative",
      },
    ],
    recommendations: ["one actionable recommendation per string"],
  });

  const system = [
    "You are an expert grant-writing analyst. Compare winning and losing grant narratives to identify concrete, actionable patterns.",
    "",
    "RULES:",
    "1. Be specific - quote short phrases directly from the provided narratives as examples.",
    "2. Identify language patterns, structural choices, concrete data points, tone, and specificity - not generic writing advice.",
    "3. Return ONLY valid JSON matching the schema below. No prose, no code fences, no markdown.",
    outputSchema,
    "4. Return 3-6 winning_patterns, 2-4 losing_patterns (or fewer if only the winning narrative is available), and 3-5 recommendations.",
    "5. All examples must come verbatim from the supplied text. Never invent quotes.",
  ].join("\n");

  const winning = input.winningNarrative.replace(/\s+/g, " ").trim();
  const winningExcerpt =
    winning.length > WINNING_EXCERPT_CHARS
      ? `${winning.slice(0, WINNING_EXCERPT_CHARS)}...`
      : winning;

  const prompt = [
    `# Pattern analysis - funder category: ${input.funderCategory}`,
    "",
    "## Awarded (winning) narrative",
    winningExcerpt,
    "",
    "## Denied narratives for comparison",
    renderDenied(input.deniedNarratives),
    "",
    "## Output",
    "Return the JSON analysis now.",
  ].join("\n");

  const response = await callClaude({ system, prompt, model, maxTokens });
  const parsed = parseAnalysisResponse(response.text);
  if (!parsed) return null;
  return { analysis: parsed, tokensUsed: response.usage.totalTokens };
}

// --- response parsing --------------------------------------------------------

function parsePatterns(value: unknown): SuccessPatternEntry[] {
  if (!Array.isArray(value)) return [];
  const out: SuccessPatternEntry[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const entry = item as Record<string, unknown>;
      const description =
        typeof entry.description === "string" ? entry.description.trim() : "";
      const example =
        typeof entry.example === "string" ? entry.example.trim() : "";
      if (description) out.push({ description, example });
    }
  }
  return out;
}

function parseRecommendations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is string => typeof r === "string" && r.trim() !== "")
    .map((r) => r.trim());
}

function parseAnalysisResponse(text: string): SuccessPatternAnalysis | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const winningPatterns = parsePatterns(obj.winning_patterns);
  const losingPatterns = parsePatterns(obj.losing_patterns);
  const recommendations = parseRecommendations(obj.recommendations);

  if (winningPatterns.length === 0 && recommendations.length === 0) return null;

  return {
    winning_patterns: winningPatterns,
    losing_patterns: losingPatterns,
    recommendations,
  };
}
