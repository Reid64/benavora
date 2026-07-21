// Narrative Humanizer — post-processes an autonomously drafted grant
// narrative to remove common AI writing tells, inject organization-specific
// detail in place of vague boilerplate, enforce a consistent first-person
// active voice, and score the result. Called by
// src/lib/agents/draft-generation-agent.ts (ag-05-draft) after section
// drafting and before the applications INSERT.
//
// Follows this file's established convention (see draft-generation-agent.ts's
// own header) of local, narrowly-scoped interfaces rather than a shared
// OrgProfile/OpportunityContext type — no such shared type exists anywhere
// in this codebase (every agent that needs one defines its own), and the
// fields this module actually needs (demographic detail, program names,
// staff qualifications, impact stats) don't match any existing OrgProfile
// shape closely enough to reuse one.
//
// Every field on OrgProfile below is optional except `name` — this module
// never fabricates a fact it wasn't given. A missing field means the
// corresponding rule/prompt section is skipped, not filled with a
// placeholder.

import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

export interface OrgProfile {
  name: string;
  missionStatement?: string | null;
  serviceArea?: string | null;
  targetPopulation?: string | null;
  /** Most specific available population descriptor, e.g. "veterans in rural
   * Texas" — used to replace "community members". Never a fabricated
   * headcount; only what the org's own profile/twin data actually states. */
  demographicDetail?: string | null;
  programNames?: string[];
  /** Staff/board credentials, e.g. "Jane Doe, Executive Director" or a
   * capacity-narrative snippet — used to replace "experienced staff". */
  staffQualifications?: string[];
  /** Documented outcomes/impact statements — used to replace "impactful
   * outcomes" and "proven track record". */
  impactStats?: string[];
  /** A stated multi-year projection, if the org has one on file. There is
   * no schema source for this anywhere in this codebase today, so callers
   * will typically leave it null and the corresponding rule is skipped. */
  threeYearProjection?: string | null;
}

export interface OpportunityContext {
  name: string;
  category?: string | null;
  funderName?: string | null;
}

export interface HumanizationResult {
  humanizedText: string;
  humanizationScore: number;
  aiTellsRemoved: string[];
  wordCountBefore: number;
  wordCountAfter: number;
}

const AI_TELL_DETECTION_MAX_TOKENS = 200;
const REPLACEMENT_GENERATION_MAX_TOKENS = 400;
const VOICE_CONSISTENCY_MAX_TOKENS = 4000;
const QUALITY_SCORE_MAX_TOKENS = 300;
const MAX_CLAUDE_DETECTED_TELLS = 5;
/** Used when the Pass 4 scoring call fails or returns unparseable JSON — a
 * neutral middle value so a scoring failure doesn't silently read as either
 * "perfect" or "worthless" humanization. */
const DEFAULT_HUMANIZATION_SCORE = 70;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractJsonArray(text: string): unknown[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function buildOrgContextBlock(
  orgProfile: OrgProfile,
  opportunityContext: OpportunityContext,
): string {
  const lines = [`Organization: ${orgProfile.name}`];
  if (opportunityContext.funderName) {
    lines.push(`Funder: ${opportunityContext.funderName}`);
  }
  if (orgProfile.missionStatement) {
    lines.push(`Mission: ${orgProfile.missionStatement}`);
  }
  if (orgProfile.serviceArea) {
    lines.push(`Service area: ${orgProfile.serviceArea}`);
  }
  if (orgProfile.demographicDetail) {
    lines.push(`Population served: ${orgProfile.demographicDetail}`);
  }
  if (orgProfile.programNames && orgProfile.programNames.length > 0) {
    lines.push(`Programs: ${orgProfile.programNames.join(", ")}`);
  }
  if (
    orgProfile.staffQualifications &&
    orgProfile.staffQualifications.length > 0
  ) {
    lines.push(
      `Staff qualifications: ${orgProfile.staffQualifications.join("; ")}`,
    );
  }
  if (orgProfile.impactStats && orgProfile.impactStats.length > 0) {
    lines.push(`Documented impact: ${orgProfile.impactStats.join("; ")}`);
  }
  return lines.join("\n");
}

// ---- PASS 1: AI tell detection and removal --------------------------------

/** Phrases removed outright — no replacement, they add nothing. */
const DELETE_ONLY_TELLS: string[] = [
  "In conclusion,",
  "Furthermore,",
  "Moreover,",
  "It is important to note that",
  "In today's world",
];

interface ReplaceableTell {
  phrase: string;
  buildReplacement: (orgProfile: OrgProfile) => string | null;
}

/** Phrases replaced with organization-specific text when the data is
 * available; left untouched otherwise (never fabricated). */
const REPLACEABLE_TELLS: ReplaceableTell[] = [
  {
    phrase: "Leveraging our expertise",
    buildReplacement: (org) =>
      org.staffQualifications && org.staffQualifications.length > 0
        ? `Drawing on ${org.staffQualifications[0]}`
        : null,
  },
  {
    phrase: "Comprehensive approach",
    buildReplacement: (org) =>
      org.programNames && org.programNames.length > 0
        ? `${org.programNames.slice(0, 3).join(", ")} approach`
        : null,
  },
  {
    phrase: "Impactful outcomes",
    buildReplacement: (org) =>
      org.impactStats && org.impactStats.length > 0
        ? (org.impactStats[0] as string)
        : null,
  },
  {
    // No organization data can make this phrase "specific" on its own —
    // this is a bounded, always-safe active-voice tightening, not a
    // fabricated specific.
    phrase: "We are committed to",
    buildReplacement: () => "We commit to",
  },
];

function stripPhrase(text: string, phrase: string): { text: string; removed: boolean } {
  const escaped = escapeRegExp(phrase);
  const detectPattern = new RegExp(`\\s*${escaped}\\s*`, "i");
  const removed = detectPattern.test(text);
  if (!removed) return { text, removed: false };
  const stripped = text
    .replace(new RegExp(`\\s*${escaped}\\s*`, "gi"), " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { text: stripped, removed: true };
}

function applyFixedAiTells(
  text: string,
  orgProfile: OrgProfile,
): { text: string; removed: string[] } {
  let current = text;
  const removed: string[] = [];

  for (const phrase of DELETE_ONLY_TELLS) {
    const result = stripPhrase(current, phrase);
    if (result.removed) {
      current = result.text;
      removed.push(phrase);
    }
  }

  for (const tell of REPLACEABLE_TELLS) {
    const escaped = escapeRegExp(tell.phrase);
    if (!new RegExp(escaped, "i").test(current)) continue;
    const replacement = tell.buildReplacement(orgProfile);
    if (!replacement) continue;
    current = current.replace(new RegExp(escaped, "gi"), replacement);
    removed.push(tell.phrase);
  }

  return { text: current, removed };
}

async function detectAdditionalAiTells(text: string): Promise<string[]> {
  const response = await callClaude({
    system:
      "You are an editor who specializes in identifying AI-generated writing patterns in " +
      "nonprofit grant narratives.",
    prompt:
      "Identify the top 5 AI-generated phrases in this grant narrative that sound artificial. " +
      'Return ONLY a JSON array of the exact phrases, verbatim substrings copied from the text, ' +
      'e.g. ["phrase one", "phrase two"]. Do not include phrases that are normal, professional ' +
      "grant-writing language.\n\nNARRATIVE:\n" +
      text,
    model: DEFAULT_MODEL,
    maxTokens: AI_TELL_DETECTION_MAX_TOKENS,
  });

  const candidates = extractJsonArray(response.text).filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  const lowerText = text.toLowerCase();
  return candidates
    .filter((phrase) => lowerText.includes(phrase.toLowerCase()))
    .slice(0, MAX_CLAUDE_DETECTED_TELLS);
}

async function generateReplacementsForPhrases(
  phrases: string[],
  orgProfile: OrgProfile,
  opportunityContext: OpportunityContext,
): Promise<Record<string, string>> {
  if (phrases.length === 0) return {};

  const orgContextBlock = buildOrgContextBlock(orgProfile, opportunityContext);
  const phraseList = phrases.map((phrase) => `- "${phrase}"`).join("\n");

  const response = await callClaude({
    system:
      "You are a grant-writing editor. For each artificial-sounding phrase from a grant " +
      "narrative, write a specific, human-sounding replacement grounded in the organization's " +
      "real context below. Never invent a fact, statistic, or credential not present in that " +
      'context. Return ONLY a JSON object mapping each exact input phrase to its replacement ' +
      'text, e.g. {"phrase": "replacement"}. Omit a phrase from the object entirely if no ' +
      "grounded replacement is possible.",
    prompt: `ORGANIZATION CONTEXT:\n${orgContextBlock}\n\nPHRASES TO REPLACE:\n${phraseList}`,
    model: DEFAULT_MODEL,
    maxTokens: REPLACEMENT_GENERATION_MAX_TOKENS,
  });

  const raw = extractJsonObject(response.text);
  if (!raw) return {};

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trim().length > 0) {
      result[key] = value.trim();
    }
  }
  return result;
}

function replacePhraseCaseInsensitive(
  text: string,
  phrase: string,
  replacement: string,
): string {
  return text.replace(new RegExp(escapeRegExp(phrase), "gi"), replacement);
}

async function removeAiTells(
  text: string,
  orgProfile: OrgProfile,
  opportunityContext: OpportunityContext,
): Promise<{ text: string; removed: string[] }> {
  const fixedPass = applyFixedAiTells(text, orgProfile);
  let current = fixedPass.text;
  const removed = [...fixedPass.removed];

  try {
    const detected = await detectAdditionalAiTells(current);
    if (detected.length > 0) {
      const replacements = await generateReplacementsForPhrases(
        detected,
        orgProfile,
        opportunityContext,
      );
      for (const phrase of detected) {
        const replacement = replacements[phrase];
        if (!replacement) continue;
        if (!current.toLowerCase().includes(phrase.toLowerCase())) continue;
        current = replacePhraseCaseInsensitive(current, phrase, replacement);
        removed.push(phrase);
      }
    }
  } catch {
    // Claude-based detection/replacement failed — the deterministic fixed-
    // list pass above already ran, so humanization still improved the
    // draft. Degrade gracefully rather than blocking, matching this
    // codebase's established defensive-load convention (see
    // draft-generation-agent.ts's loadRoiRecommendations/
    // loadFundabilityContext for the same pattern).
  }

  return { text: current, removed };
}

// ---- PASS 2: Specificity injection -----------------------------------------

interface SpecificityRule {
  label: string;
  patternSource: string;
  replacement: (orgProfile: OrgProfile) => string | null;
}

const SPECIFICITY_RULES: SpecificityRule[] = [
  {
    label: "community members",
    patternSource: "\\bcommunity members\\b",
    replacement: (org) => org.demographicDetail ?? null,
  },
  {
    label: "our programs",
    patternSource: "\\bour programs\\b",
    replacement: (org) =>
      org.programNames && org.programNames.length > 0
        ? org.programNames.join(", ")
        : null,
  },
  {
    label: "experienced staff",
    patternSource: "\\bexperienced staff\\b",
    replacement: (org) =>
      org.staffQualifications && org.staffQualifications.length > 0
        ? org.staffQualifications.join("; ")
        : null,
  },
  {
    label: "proven track record",
    patternSource: "\\bproven track record\\b",
    replacement: (org) =>
      org.impactStats && org.impactStats.length > 0
        ? (org.impactStats[0] as string)
        : null,
  },
  {
    label: "sustainable impact",
    patternSource: "\\bsustainable impact\\b",
    replacement: (org) => org.threeYearProjection ?? null,
  },
];

function applySpecificityInjection(
  text: string,
  orgProfile: OrgProfile,
): { text: string; applied: string[] } {
  let current = text;
  const applied: string[] = [];

  for (const rule of SPECIFICITY_RULES) {
    if (!new RegExp(rule.patternSource, "i").test(current)) continue;
    const replacement = rule.replacement(orgProfile);
    if (!replacement) continue;
    current = current.replace(new RegExp(rule.patternSource, "gi"), replacement);
    applied.push(rule.label);
  }

  return { text: current, applied };
}

// ---- PASS 3: Voice consistency ---------------------------------------------

async function enforceVoiceConsistency(
  text: string,
  orgProfile: OrgProfile,
  opportunityContext: OpportunityContext,
): Promise<string> {
  const system =
    "You are a senior grant editor enforcing voice consistency in a nonprofit grant narrative. " +
    "Rewrite the narrative so that, throughout: (1) the organization refers to itself in first " +
    "person plural ('we serve...'), never third person ('the organization serves...'); (2) " +
    "sentences use active voice rather than passive voice; (3) verb tense is present tense for " +
    "current programs and past tense for completed achievements; (4) vague quantifiers ('many', " +
    "'numerous', 'significant', 'various') are replaced with the specific figures already present " +
    "elsewhere in the text where one is available, and left as the most specific phrasing already " +
    "in the source text otherwise — never invent a number that isn't already in the text. Preserve " +
    "every factual claim, the section structure, and any [NEEDS INPUT: ...] markers exactly as-is. " +
    "Return ONLY the revised narrative text — no preamble, no meta-commentary, no markdown.";

  const orgContextBlock = buildOrgContextBlock(orgProfile, opportunityContext);

  const response = await callClaude({
    system,
    prompt:
      `ORGANIZATION CONTEXT (for tone/voice reference only — do not add facts not already in ` +
      `the narrative):\n${orgContextBlock}\n\nNARRATIVE TO REVISE:\n${text}`,
    model: DEFAULT_MODEL,
    maxTokens: VOICE_CONSISTENCY_MAX_TOKENS,
  });

  const revised = response.text.trim();
  return revised.length > 0 ? revised : text;
}

// ---- PASS 4: Quality score --------------------------------------------------

function clampScore(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

async function scoreHumanizedNarrative(text: string): Promise<number> {
  const response = await callClaude({
    system:
      "You are a quality assurance reviewer scoring a humanized grant narrative for remaining " +
      "AI-generated tells.",
    prompt:
      "Score this grant narrative on four dimensions, each 0-100:\n" +
      "1. human_voice_authenticity — does it read as written by a human grant writer, not an AI?\n" +
      "2. organization_specificity — how specific/concrete is it to this organization (vs. generic)?\n" +
      "3. ai_phrase_absence — how free is it of remaining AI-sounding stock phrases?\n" +
      "4. narrative_flow — does it read smoothly and cohesively end to end?\n" +
      'Return ONLY a JSON object: {"human_voice_authenticity": N, "organization_specificity": N, ' +
      '"ai_phrase_absence": N, "narrative_flow": N, "top_concerns": ["...", "...", "..."]}.\n\n' +
      `NARRATIVE:\n${text}`,
    model: DEFAULT_MODEL,
    maxTokens: QUALITY_SCORE_MAX_TOKENS,
  });

  const raw = extractJsonObject(response.text);
  if (!raw) return DEFAULT_HUMANIZATION_SCORE;

  const humanVoiceAuthenticity = clampScore(raw.human_voice_authenticity);
  const organizationSpecificity = clampScore(raw.organization_specificity);
  const aiPhraseAbsence = clampScore(raw.ai_phrase_absence);
  const narrativeFlow = clampScore(raw.narrative_flow);

  return Math.round(
    (humanVoiceAuthenticity +
      organizationSpecificity +
      aiPhraseAbsence +
      narrativeFlow) /
      4,
  );
}

// ---- Pipeline entry point ---------------------------------------------------

export async function humanizeNarrative(
  draftText: string,
  orgProfile: OrgProfile,
  opportunityContext: OpportunityContext,
): Promise<HumanizationResult> {
  const wordCountBefore = countWords(draftText);

  // PASS 1 — AI tell detection and removal.
  const pass1 = await removeAiTells(draftText, orgProfile, opportunityContext);
  let text = pass1.text;
  const aiTellsRemoved = [...pass1.removed];

  // PASS 2 — Specificity injection (deterministic; org data is already
  // fully known at this point, no Claude call needed).
  const pass2 = applySpecificityInjection(text, orgProfile);
  text = pass2.text;
  aiTellsRemoved.push(...pass2.applied);

  // PASS 3 — Voice consistency. Falls back to the pre-pass-3 text on
  // failure rather than blocking humanization entirely.
  try {
    text = await enforceVoiceConsistency(text, orgProfile, opportunityContext);
  } catch {
    // keep the Pass 1/2 result
  }

  // PASS 4 — Quality score.
  let humanizationScore = DEFAULT_HUMANIZATION_SCORE;
  try {
    humanizationScore = await scoreHumanizedNarrative(text);
  } catch {
    // keep the default fallback score
  }

  return {
    humanizedText: text,
    humanizationScore,
    aiTellsRemoved: Array.from(new Set(aiTellsRemoved)),
    wordCountBefore,
    wordCountAfter: countWords(text),
  };
}
