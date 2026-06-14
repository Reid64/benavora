// AI Humanizer Agent - second-pass anti-detection rewrite (BLUEPRINT §4.8).
//
// After the Narrative Drafting Agent (Agent 05) produces a grounded draft, the
// Humanizer runs a SECOND, specialized Claude pass that rewrites the text to
// read like an experienced human grant writer wrote it - not a language model.
// It targets the statistical fingerprints AI-detection tools key on:
//
//   - em dashes used as connective punctuation,
//   - a fixed register of "AI vocabulary" (furthermore, leverage, robust, ...),
//   - uniform sentence length / low burstiness,
//   - absence of contractions,
//   - mechanically perfect paragraph and list parallelism,
//   - colon-led inline lists,
//   - repetitive sentence starters,
//   - vague claims where specific numbers/names/dates/locations belong.
//
// The rewrite is grounded EXACTLY like the first pass (BEHAVIORAL_CONTRACTS §9):
// it may only swap a vague claim for a specific fact that is present in the
// supplied organization profile / Knowledge Base, never invent one, and must
// preserve every [NEEDS INPUT: ...] placeholder and every section heading.
//
// Two layers run in sequence:
//   1. The Claude pass does the semantic work (rhythm, voice, contractions,
//      grounding vague claims, de-parallelizing lists).
//   2. A deterministic enforcement pass (`enforceHumanization`) is the hard
//      safety net: it GUARANTEES zero em dashes and zero banned vocabulary
//      survive, regardless of what the model returned.
//
// `analyzeHumanization` then measures the result so the route can report a
// humanization quality score alongside the grounding confidence.

import {
  callClaude,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
} from "@/lib/ai/claude";
import { humanizeEnum } from "@/lib/utils/formatters";
import type {
  DraftKnowledgeEntry,
  DraftOrgContext,
  DraftProvenNarrative,
  DraftTemplateType,
} from "@/types/ai";

// ---------------------------------------------------------------------------
// Banned vocabulary (the task's "AI vocabulary" list).
// ---------------------------------------------------------------------------

/**
 * Multi-word AI tells that are removed entirely rather than swapped - they are
 * transition scaffolding a human writer simply omits. The trailing comma/space
 * is consumed so the sentence reflows cleanly.
 */
const BANNED_PHRASES: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\bit is important to note that\b[\s,:-]*/gi, replacement: "" },
  { pattern: /\bit is important to note\b[\s,:-]*/gi, replacement: "" },
  { pattern: /\bin conclusion\b[\s,:-]*/gi, replacement: "" },
  { pattern: /\bfurthermore\b[\s,]*/gi, replacement: "" },
  { pattern: /\bmoreover\b[\s,]*/gi, replacement: "" },
  { pattern: /\badditionally\b[\s,]*/gi, replacement: "" },
];

/**
 * Single content words that are replaced with plainer language. Verb/adjective
 * forms are enumerated explicitly so grammar stays correct after substitution.
 */
const BANNED_WORDS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\bcrucial\b/gi, replacement: "key" },
  { pattern: /\bcrucially\b/gi, replacement: "" },
  { pattern: /\butilizations?\b/gi, replacement: "use" },
  { pattern: /\butilize\b/gi, replacement: "use" },
  { pattern: /\butilizes\b/gi, replacement: "uses" },
  { pattern: /\butilized\b/gi, replacement: "used" },
  { pattern: /\butilizing\b/gi, replacement: "using" },
  { pattern: /\bleverage\b/gi, replacement: "use" },
  { pattern: /\bleverages\b/gi, replacement: "uses" },
  { pattern: /\bleveraged\b/gi, replacement: "used" },
  { pattern: /\bleveraging\b/gi, replacement: "using" },
  { pattern: /\bfoster\b/gi, replacement: "support" },
  { pattern: /\bfosters\b/gi, replacement: "supports" },
  { pattern: /\bfostered\b/gi, replacement: "supported" },
  { pattern: /\bfostering\b/gi, replacement: "supporting" },
  { pattern: /\bdelves\b/gi, replacement: "digs" },
  { pattern: /\bdelved\b/gi, replacement: "dug" },
  { pattern: /\bdelving\b/gi, replacement: "digging" },
  { pattern: /\bdelve\b/gi, replacement: "dig" },
  { pattern: /\blandscapes?\b/gi, replacement: "field" },
  { pattern: /\bmultifaceted\b/gi, replacement: "complex" },
  { pattern: /\bcomprehensive\b/gi, replacement: "complete" },
  { pattern: /\brobust\b/gi, replacement: "strong" },
  { pattern: /\bstreamlines\b/gi, replacement: "simplifies" },
  { pattern: /\bstreamlined\b/gi, replacement: "simplified" },
  { pattern: /\bstreamlining\b/gi, replacement: "simplifying" },
  { pattern: /\bstreamline\b/gi, replacement: "simplify" },
  { pattern: /\bcutting-edge\b/gi, replacement: "modern" },
  { pattern: /\binnovative\b/gi, replacement: "new" },
  { pattern: /\btransformative\b/gi, replacement: "lasting" },
];

/**
 * Human-readable banned vocabulary, surfaced in the system prompt so the model
 * avoids the terms in the first place (the deterministic pass is the backstop).
 */
export const BANNED_VOCABULARY: readonly string[] = [
  "furthermore",
  "moreover",
  "additionally",
  "crucial",
  "utilize",
  "leverage",
  "foster",
  "delve",
  "landscape",
  "multifaceted",
  "comprehensive",
  "robust",
  "streamline",
  "cutting-edge",
  "innovative",
  "transformative",
  "it is important to note",
  "in conclusion",
];

// Em dash, em quad, and horizontal bar, plus the ASCII "--" stand-in. Note: the
// en dash (-) is deliberately excluded so numeric/date ranges (2020-2024) and
// page ranges survive untouched.
const EM_DASH_PATTERN = /\s*(?:[-―⸺⸻]|--)\s*/g;

// ---------------------------------------------------------------------------
// Markdown artifact stripping (deterministic post-AI cleanup).
// ---------------------------------------------------------------------------

/**
 * Remove all markdown formatting artifacts left by the AI rewrite.
 * Runs before the vocabulary/em-dash enforcement so the downstream patterns
 * operate on clean prose.
 *
 *   - ATX headings (## Heading)  → plain text, line breaks preserved
 *   - Bold markers (**text**, __text__) → inner text only
 *   - Bullet lists (* item, - item) → flowing prose paragraph (items joined
 *     as sentences; a period is appended when the item lacks terminal punct)
 *   - Italic markers (*text*, _text_) → inner text only (after bullet pass)
 *   - Horizontal rules (---, ***) → removed
 *   - Blockquotes (> text) → inner text only
 *   - Inline code (`code`) → inner text only
 */
export function stripMarkdown(text: string): { text: string; markdownArtifactsRemoved: number } {
  let count = 0;
  let out = text;

  // ATX headings: ## Heading → Heading
  out = out.replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, (_m, heading: string) => {
    count++;
    return heading.trim();
  });

  // Bold: **text** and __text__
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, inner: string) => { count++; return inner; });
  out = out.replace(/__([^_]+)__/g, (_m, inner: string) => { count++; return inner; });

  // Bullet lists → prose paragraphs (before remaining * are treated as italic)
  out = out.replace(/((?:^[ \t]*[*-][ \t]+.+(?:\n|$))+)/gm, (listBlock: string) => {
    count++;
    const items = listBlock
      .split("\n")
      .map((line) => line.replace(/^[ \t]*[*-][ \t]+/, "").trim())
      .filter((line) => line.length > 0);
    const prose = items
      .map((item) => (/[.!?]$/.test(item) ? item : `${item}.`))
      .join(" ");
    return `${prose}\n`;
  });

  // Italic: *text* and _text_ (inline only, after bullets are converted)
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_m, inner: string) => { count++; return inner; });
  out = out.replace(/(?<!_)_([^_\n]+)_(?!_)/g, (_m, inner: string) => { count++; return inner; });

  // Horizontal rules (--- / *** / ___)
  out = out.replace(/^[ \t]*(?:[*\-_][ \t]*){3,}[ \t]*$/gm, () => { count++; return ""; });

  // Blockquotes: > text → text
  out = out.replace(/^[ \t]*>[ \t]?(.*)$/gm, (_m, inner: string) => { count++; return inner; });

  // Inline code: `code` → code
  out = out.replace(/`([^`\n]+)`/g, (_m, inner: string) => { count++; return inner; });

  // Collapse 3+ blank lines to 2
  out = out.replace(/\n{3,}/g, "\n\n");

  return { text: out.trim(), markdownArtifactsRemoved: count };
}

// ---------------------------------------------------------------------------
// Deterministic transformations (the hard safety net).
// ---------------------------------------------------------------------------

/** Capitalize sentence starts (string start + after .!? / newline). */
function fixSentenceCase(text: string): string {
  return text
    .replace(/^(\s*)([a-z])/, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
    .replace(
      /([.!?]\s+|\n[ \t]*)([a-z])/g,
      (_m, sep: string, ch: string) => sep + ch.toUpperCase(),
    );
}

/** Collapse the punctuation/whitespace debris a removal or swap can leave. */
function tidyPunctuation(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*,/g, ", ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/[ \t]+\n/g, "\n");
}

/** Preserve the original first-letter case of `matched` on `replacement`. */
function matchCase(matched: string, replacement: string): string {
  const firstRepl = replacement[0];
  if (!firstRepl) return replacement;
  const first = matched[0];
  if (first && first === first.toUpperCase() && first !== first.toLowerCase()) {
    return firstRepl.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Replace every em dash with a comma (its safest grammatical equivalent for the
 * connective use AI favors). Returns the count removed for metrics/reporting.
 */
export function stripEmDashes(text: string): { text: string; count: number } {
  let count = 0;
  const out = text.replace(EM_DASH_PATTERN, () => {
    count += 1;
    return ", ";
  });
  return { text: tidyPunctuation(out), count };
}

/**
 * Strip/replace the banned AI vocabulary. Phrases are dropped, content words are
 * swapped for plainer equivalents (case-preserving). Returns the change count.
 */
export function replaceAiVocabulary(text: string): {
  text: string;
  count: number;
} {
  let count = 0;
  let out = text;

  for (const { pattern, replacement } of BANNED_PHRASES) {
    out = out.replace(pattern, () => {
      count += 1;
      return replacement;
    });
  }
  for (const { pattern, replacement } of BANNED_WORDS) {
    out = out.replace(pattern, (matched: string) => {
      count += 1;
      return matchCase(matched, replacement);
    });
  }

  return { text: fixSentenceCase(tidyPunctuation(out)), count };
}

/** What the deterministic enforcement pass changed. */
export interface EnforcementResult {
  text: string;
  emDashesRemoved: number;
  vocabReplaced: number;
  markdownArtifactsRemoved: number;
}

/**
 * Run the guaranteed transformations over model output: zero markdown artifacts,
 * zero em dashes, and zero banned vocabulary survive this, no matter what the
 * model returned.
 */
export function enforceHumanization(text: string): EnforcementResult {
  const markdown = stripMarkdown(text);
  const vocab = replaceAiVocabulary(markdown.text);
  const dashes = stripEmDashes(vocab.text);
  return {
    text: dashes.text,
    emDashesRemoved: dashes.count,
    vocabReplaced: vocab.count,
    markdownArtifactsRemoved: markdown.markdownArtifactsRemoved,
  };
}

// ---------------------------------------------------------------------------
// Text analysis - measure how "human" the result reads.
// ---------------------------------------------------------------------------

/** Quantitative anti-detection signals measured on a piece of text. */
export interface HumanizationMetrics {
  sentenceCount: number;
  /** Mean words per sentence. */
  avgSentenceLength: number;
  /** Standard deviation of sentence length (raw burstiness). */
  sentenceLengthStdDev: number;
  /** stdDev / mean - burstiness normalized for length. Higher = more varied. */
  burstiness: number;
  shortestSentence: number;
  longestSentence: number;
  /** True when the text mixes a ≤6-word sentence with a ≥25-word one. */
  hasDramaticVariance: boolean;
  /** Sentences that reuse an already-seen opening word (beyond the first use). */
  repeatedStarters: number;
  /** Inline "label: a, b, and c" colon-led list patterns. */
  colonListPatterns: number;
  /** Count of contractions (it's, we're, don't, ...). */
  contractions: number;
  /** Banned AI-vocabulary occurrences still present. */
  bannedVocabHits: number;
  /** Em dashes still present. */
  emDashes: number;
}

const SHORT_SENTENCE_MAX = 6;
const LONG_SENTENCE_MIN = 25;

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[a-z0-9]/i.test(s));
}

function wordCount(sentence: string): number {
  const words = sentence.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g);
  return words ? words.length : 0;
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/** Measure the anti-detection signals on `text`. */
export function analyzeHumanization(text: string): HumanizationMetrics {
  const sentences = splitSentences(text);
  const lengths = sentences.map(wordCount).filter((n) => n > 0);
  const sentenceCount = lengths.length;

  const total = lengths.reduce((sum, n) => sum + n, 0);
  const mean = sentenceCount > 0 ? total / sentenceCount : 0;
  const variance =
    sentenceCount > 0
      ? lengths.reduce((sum, n) => sum + (n - mean) ** 2, 0) / sentenceCount
      : 0;
  const stdDev = Math.sqrt(variance);

  const shortest = sentenceCount > 0 ? Math.min(...lengths) : 0;
  const longest = sentenceCount > 0 ? Math.max(...lengths) : 0;

  // Repeated sentence starters: count every opener seen more than once.
  const starterCounts = new Map<string, number>();
  for (const sentence of sentences) {
    const first = sentence.match(/[A-Za-z']+/)?.[0]?.toLowerCase();
    if (!first) continue;
    starterCounts.set(first, (starterCounts.get(first) ?? 0) + 1);
  }
  let repeatedStarters = 0;
  for (const n of starterCounts.values()) {
    if (n > 1) repeatedStarters += n - 1;
  }

  // Inline colon lists: a colon mid-sentence followed by a comma-separated run.
  const colonListPatterns = countMatches(
    text,
    /[A-Za-z]+\s*:\s+[^.:\n]*,[^.:\n]*,[^.:\n]*/g,
  );

  const contractions = countMatches(
    text,
    /\b[A-Za-z]+['’](?:s|re|ve|ll|d|t|m)\b|\b[A-Za-z]+n['’]t\b/gi,
  );

  let bannedVocabHits = 0;
  for (const { pattern } of BANNED_PHRASES) bannedVocabHits += countMatches(text, pattern);
  for (const { pattern } of BANNED_WORDS) bannedVocabHits += countMatches(text, pattern);

  const emDashes = countMatches(text, /[-―⸺⸻]|--/g);

  return {
    sentenceCount,
    avgSentenceLength: Math.round(mean * 10) / 10,
    sentenceLengthStdDev: Math.round(stdDev * 10) / 10,
    burstiness: mean > 0 ? Math.round((stdDev / mean) * 100) / 100 : 0,
    shortestSentence: shortest,
    longestSentence: longest,
    hasDramaticVariance:
      shortest > 0 && shortest <= SHORT_SENTENCE_MAX && longest >= LONG_SENTENCE_MIN,
    repeatedStarters,
    colonListPatterns,
    contractions,
    bannedVocabHits,
    emDashes,
  };
}

/**
 * A 0-100 "reads human" score from the metrics. Starts at 100 and deducts for
 * each surviving AI tell. This is a quality signal for the humanization pass,
 * distinct from the grounding confidence the draft route computes.
 */
export function computeHumanizationScore(metrics: HumanizationMetrics): number {
  let score = 100;

  // Hard tells the enforcement pass should have removed - heavily penalized.
  score -= metrics.emDashes * 6;
  score -= metrics.bannedVocabHits * 5;

  // Rhythm: uniform sentence length is the strongest statistical fingerprint.
  if (!metrics.hasDramaticVariance) score -= 14;
  if (metrics.burstiness < 0.35 && metrics.sentenceCount >= 4) score -= 12;

  // Stylistic tells.
  if (metrics.repeatedStarters > 2) score -= (metrics.repeatedStarters - 2) * 3;
  score -= metrics.colonListPatterns * 4;
  if (metrics.contractions === 0 && metrics.sentenceCount >= 5) score -= 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ---------------------------------------------------------------------------
// Prompt construction for the specialized humanizer Claude call.
// ---------------------------------------------------------------------------

/** Everything the humanizer pass needs: the draft plus its grounding data. */
export interface HumanizerContext {
  draft: string;
  templateType: DraftTemplateType;
  organization: DraftOrgContext | null;
  /** Concrete facts (numbers, names, dates, places) to ground vague claims. */
  knowledgeEntries: DraftKnowledgeEntry[];
  /** Previously funded narratives - the authentic voice to mirror. */
  provenNarratives: DraftProvenNarrative[];
}

function renderOrgFacts(org: DraftOrgContext | null): string {
  if (!org) {
    return "No verified organization profile is available. Do NOT invent specifics - keep claims as written rather than fabricating numbers, names, or dates.";
  }
  const lines: string[] = [];
  const add = (label: string, value: string | number | null) => {
    if (value !== null && value !== undefined && `${value}`.trim() !== "") {
      lines.push(`- ${label}: ${value}`);
    }
  };
  add("Legal name", org.name);
  add("Also known as", org.dba);
  add("EIN", org.ein);
  add("Tax status", org.taxStatus);
  add("Mission", org.missionStatement);
  add("Vision", org.visionStatement);
  add("Service area / location", org.serviceArea);
  add("Target population", org.targetPopulation);
  add("Founder", org.founderName);
  add(
    "Annual budget",
    org.annualBudget != null
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(org.annualBudget)
      : null,
  );
  return lines.length > 0
    ? lines.join("\n")
    : "The organization profile is empty. Do NOT invent specifics.";
}

function renderKnowledgeFacts(entries: DraftKnowledgeEntry[]): string {
  if (entries.length === 0) {
    return "No Knowledge Base facts are available. Keep existing claims; do not fabricate specifics.";
  }
  return entries
    .map(
      (entry) =>
        `### ${entry.title} (${humanizeEnum(entry.category)})\n${entry.content.trim()}`,
    )
    .join("\n\n");
}

function renderVoiceSamples(narratives: DraftProvenNarrative[]): string {
  if (narratives.length === 0) {
    return "No proven narratives available. Infer an authentic, grounded nonprofit voice from the organization profile.";
  }
  return narratives
    .map((n, i) => `Sample ${i + 1}:\n${n.narrativeText.trim()}`)
    .join("\n\n");
}

/**
 * Build the specialized system + user prompt for the humanizer pass. The system
 * prompt carries the persona and the full anti-detection rule set; the user turn
 * carries the draft and its grounding data.
 */
export function buildHumanizerPrompt(context: HumanizerContext): {
  system: string;
  prompt: string;
} {
  const orgName = context.organization?.name ?? "this organization";

  const system = [
    `You are a senior grant writer at ${orgName} with twenty years of experience. You are editing a draft so it reads exactly like you wrote it by hand - never like AI output. You rewrite for rhythm and authenticity, not to sound impressive.`,
    "",
    "ABSOLUTE PRESERVATION RULES - these override every stylistic instruction:",
    "1. Preserve every fact, figure, name, date, and quoted requirement. Never add a fact that is not in the GROUNDING DATA below.",
    "2. Preserve every [NEEDS INPUT: ...] placeholder verbatim. Never resolve, remove, or reword them.",
    "3. Preserve all section headings as plain text labels (no # or ## markers). Keep the overall structure and meaning.",
    "4. Keep roughly the same length. Do not summarize or pad.",
    "",
    "OUTPUT FORMAT - non-negotiable:",
    "- Do not use markdown formatting of any kind: no # heading markers, no **bold**, no *italic*, no __underline__, no bullet lists (* or -), no numbered lists, no horizontal rules, no blockquotes.",
    "- Do not use em-dashes (—). Replace with a comma, a parenthetical, or two separate sentences.",
    "- Write in plain prose paragraphs only. If the draft has bullet lists, convert them to flowing prose.",
    "",
    "REWRITE FOR HUMAN VOICE - apply all of the following:",
    "- EM DASHES: remove every em dash (-). Recast as a comma, a parenthetical, or two separate sentences.",
    `- AI VOCABULARY: never use these words/phrases - ${BANNED_VOCABULARY.join(", ")}. Replace them with plain, specific language.`,
    "- SENTENCE RHYTHM: create dramatic length variance. Put very short sentences (3-6 words) next to long ones (25-30+ words). Punch. Then expand. Never let three sentences in a row share a similar length.",
    "- CONTRACTIONS: use them naturally (it's, we're, don't, they've, can't) where a person would.",
    "- PARAGRAPHS: break mechanical structure. Use an occasional one-sentence paragraph for emphasis.",
    "- SPECIFICS OVER VAGUENESS: replace vague claims (\"many families\", \"significant impact\", \"recent years\") with concrete numbers, names, dates, and locations DRAWN ONLY from the GROUNDING DATA. If a specific is not in the data, leave the claim general - do NOT invent one.",
    "- AUTHENTIC VOICE: mirror the tone, cadence, and word choice of the PROVEN NARRATIVES below. They were written by this organization and have won funding.",
    "- FORMALITY: let formality rise and fall within a section, the way real writing does, rather than holding one even register.",
    "- SENTENCE STARTERS: do not begin consecutive sentences the same way. Vary openings (subject, clause, transition, question).",
    "- LISTS: break perfect parallelism. Vary item structure and length; do not make every bullet the same grammatical shape.",
    "- BURSTINESS: vary the rhythm overall - uniform pacing is the clearest AI fingerprint.",
    "- COLON LISTS: eliminate \"label: a, b, and c\" inline colon lists. Weave the items into prose instead.",
    "",
    "Return ONLY the rewritten draft text. No preamble, no notes, no explanation of what you changed.",
  ].join("\n");

  const prompt = [
    "# Draft to humanize",
    "Rewrite the draft below for an authentic human voice using the rules in your instructions. Keep every fact and placeholder intact.",
    "",
    "## GROUNDING DATA - the ONLY source for any specific you introduce",
    "",
    "### Verified organization profile",
    renderOrgFacts(context.organization),
    "",
    "### Knowledge Base facts (numbers, names, dates, locations you may use)",
    renderKnowledgeFacts(context.knowledgeEntries),
    "",
    "### Proven narratives - match this voice",
    renderVoiceSamples(context.provenNarratives),
    "",
    "## DRAFT",
    context.draft.trim(),
    "",
    "## OUTPUT",
    "Return only the rewritten draft, ready for an editor. Same facts, same placeholders, same structure - human voice.",
  ].join("\n");

  return { system, prompt };
}

// ---------------------------------------------------------------------------
// Orchestrator - the full two-step humanization pass.
// ---------------------------------------------------------------------------

export interface HumanizerRunInput extends HumanizerContext {
  /** Model id. Defaults to {@link DEFAULT_MODEL}; overridable via platform_config. */
  model?: string;
  /** Max output tokens. Defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
}

export interface HumanizerRunResult {
  /** The humanized draft, after the deterministic enforcement pass. */
  content: string;
  metrics: HumanizationMetrics;
  /** 0-100 "reads human" quality score derived from {@link metrics}. */
  humanizationScore: number;
  emDashesRemoved: number;
  vocabReplaced: number;
  markdownArtifactsRemoved: number;
  tokensUsed: number;
  model: string;
}

/**
 * Run the humanizer end to end: the specialized Claude rewrite, then the
 * deterministic enforcement net, then measurement. Throws if the model returns
 * empty output (callers log the failure - agents never fail silently, §15).
 */
export async function runHumanizer(
  input: HumanizerRunInput,
): Promise<HumanizerRunResult> {
  const { system, prompt } = buildHumanizerPrompt(input);

  // A little warmth so the rewrite actually varies its rhythm; still grounded by
  // the strict preservation rules in the system prompt.
  const response = await callClaude({
    system,
    prompt,
    model: input.model ?? DEFAULT_MODEL,
    maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: 0.9,
  });

  const rewritten = response.text.trim();
  if (rewritten === "") {
    throw new Error("The humanizer model returned an empty rewrite.");
  }

  const enforced = enforceHumanization(rewritten);
  const metrics = analyzeHumanization(enforced.text);

  return {
    content: enforced.text,
    metrics,
    humanizationScore: computeHumanizationScore(metrics),
    emDashesRemoved: enforced.emDashesRemoved,
    vocabReplaced: enforced.vocabReplaced,
    markdownArtifactsRemoved: enforced.markdownArtifactsRemoved,
    tokensUsed: response.usage.totalTokens,
    model: response.model,
  };
}
