// Grant Pattern Extraction Engine — turns the Intelligence Library
// (intelligence_funded_proposals) into actionable, org- and opportunity-
// specific guidance for the draft generation pipeline (see
// src/lib/agents/draft-generation-agent.ts, which is the only caller).
//
// DEVIATION FROM TASK SPEC — verified live via a direct PostgREST column
// probe against project vbjplpquqxxfbpazyalt on 2026-07-21 (the same date
// this file was written): the task's matching SQL assumes
// intelligence_funded_proposals.ntee_major, a clean .funder_type bucket, and
// a full_text_search_vector tsvector column. All three are added by
// supabase/migrations/106_intelligence_library_schema_upgrade.sql, but that
// migration has NOT been applied to production (confirmed: `SELECT
// ntee_major FROM intelligence_funded_proposals LIMIT 1` returns Postgres
// error 42703 "column does not exist" against live prod right now — see also
// src/lib/intelligence/proposals-query.ts's header, which hit the same gap
// the same day). This module is written against the columns confirmed live:
// id, source, funder_name, funder_type (messy — see proposals-query.ts's
// deriveFunderBucket), grant_program, award_amount, award_year, category
// (text[]), full_text, metadata (jsonb: keywords/success_factors).
//
// There is also no org-side NTEE code anywhere in this schema
// (organizations has no ntee_code column — the same gap
// draft-generation-agent.ts's loadPlatformPatterns already documented). The
// task's "NTEE major match" tier is therefore implemented as a
// funder_category match instead: opportunity.category is a real
// funder_category enum value (e.g. "housing_grant", "government_grant"), and
// the 80 hand-authored INTELLIGENCE_LIBRARY_SEED rows carry that exact enum
// value inside their `category` text[] array alongside an NTEE letter and
// free-text topic tags (confirmed by direct query) — this is the closest
// live analog to an NTEE match and is scored at the same weight (3pts) the
// task assigns to the NTEE tier.
//
// The "funder_type match" tier reuses the funder-type classification this
// codebase already built rather than re-deriving one: deriveFunderType()
// (src/lib/intelligence/grant-style-guide.ts) buckets an opportunity's
// funder_category into federal/foundation/corporate, and deriveFunderBucket()
// (src/lib/intelligence/proposals-query.ts) buckets a library row's
// source/funder_type into federal/private_foundation/corporate_foundation/
// community_foundation/public_charity. FUNDER_TYPE_TO_BUCKETS below maps
// between the two systems.
//
// The "full-text search" tier runs client-side keyword overlap against a
// single fetched candidate pool rather than `@@ plainto_tsquery` (no
// full_text_search_vector column exists to query), mirroring the same
// tradeoff draft-generation-agent.ts's prior loadIntelligenceLibrary already
// made for this exact table (corpus is ~100s of rows, not worth fighting
// jsonb-path PostgREST filter syntax for).

import type { SupabaseClient } from "@supabase/supabase-js";

import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  deriveFunderBucket,
  type FunderBucket,
} from "@/lib/intelligence/proposals-query";
import { deriveFunderType, type FunderType } from "@/lib/intelligence/grant-style-guide";

export interface OrgProfile {
  name: string;
  missionStatement: string | null;
  serviceArea: string | null;
  targetPopulation: string | null;
  annualBudget: number | null;
}

export interface Opportunity {
  id: string;
  name: string;
  /** A real funder_category enum value (opportunities.category). */
  category: string;
  description: string | null;
  amountMin: number | null;
  amountMax: number | null;
  funderName: string | null;
}

export interface ReferenceNarrative {
  id: string;
  funderName: string | null;
  grantProgram: string | null;
  awardAmount: number | null;
  fullText: string;
  successFactors: string[];
  keywords: string[];
  /** federal/private_foundation/corporate_foundation/community_foundation/public_charity — see deriveFunderBucket. */
  funderBucket: FunderBucket | null;
  /** Combined relevance score from the matching algorithm below. */
  matchScore: number;
  /** Which match tiers fired for this row — surfaced for reviewer transparency. */
  matchReasons: string[];
}

export interface PersuasiveElement {
  elementType: string;
  description: string;
  whyItWorks: string;
}

export interface BudgetStructure {
  personnelPercent: number;
  programPercent: number;
  adminPercent: number;
  otherPercent: number;
  narrative: string;
}

export interface GrantPatternIntelligence {
  referenceNarratives: ReferenceNarrative[];
  winningPhrases: string[];
  successFactors: string[];
  persuasiveElements: PersuasiveElement[];
  budgetStructureRecommendation: BudgetStructure;
  evaluationApproachRecommendation: string;
  theoryOfChangeTemplate: string;
  funderPreferences: string[];
  avoidPatterns: string[];
  recommendedWordCount: number;
  recommendedSections: string[];
}

// intelligence_funded_proposals — real live columns only (see header).
interface IntelligenceProposalRow {
  id: string;
  source: string;
  funder_name: string | null;
  funder_type: string | null;
  grant_program: string | null;
  award_amount: number | null;
  award_year: number | null;
  category: string[] | null;
  full_text: string | null;
  metadata: { keywords?: string[]; success_factors?: string[] } | null;
}

interface ScoredCandidate {
  row: IntelligenceProposalRow;
  score: number;
  reasons: string[];
}

const CANDIDATE_POOL_LIMIT = 200;
const MAX_NARRATIVES = 5;
const MIN_NARRATIVES = 3;
const NARRATIVE_TEXT_CHAR_LIMIT = 3000;
const SYNTHESIS_MAX_TOKENS = 800;

// Task spec's four score components (ntee=3, funder_type=2, amount=1,
// full_text=2) plus a fifth for the FUNDER MATCH candidate tier the spec
// lists separately, scored at the same weight as the full-text tier.
const SCORE_CATEGORY_MATCH = 3;
const SCORE_FUNDER_TYPE_MATCH = 2;
const SCORE_AMOUNT_MATCH = 1;
const SCORE_KEYWORD_MATCH = 2;
const SCORE_FUNDER_NAME_MATCH = 2;

const AMOUNT_MATCH_LOWER_MULTIPLIER = 0.5;
const AMOUNT_MATCH_UPPER_MULTIPLIER = 2;

const FUNDER_TYPE_TO_BUCKETS: Record<FunderType, FunderBucket[]> = {
  federal: ["federal"],
  corporate: ["corporate_foundation"],
  foundation: ["private_foundation", "community_foundation", "public_charity"],
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "will", "have",
  "their", "about", "into", "across", "over", "under", "than", "through",
]);

function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? [];
  return Array.from(new Set(words.filter((w) => !STOPWORDS.has(w))));
}

const DEFAULT_SECTIONS = [
  "Executive Summary",
  "Problem Statement",
  "Program Description",
  "Budget Narrative",
  "Evaluation Plan",
  "Organizational Capacity",
];
const DEFAULT_WORD_COUNT = 2200;
const DEFAULT_BUDGET_NARRATIVE =
  "No closely matching reference narrative was available for this opportunity; using a standard " +
  "nonprofit program budget allocation as a starting point.";
const DEFAULT_EVALUATION_APPROACH =
  "Pre/post outcome design comparing participant status at intake to status at exit and follow-up, " +
  "with standard quarterly progress reporting to the funder.";
const DEFAULT_THEORY_OF_CHANGE =
  "If [organization] provides [core program/service] to [target population], then participants will " +
  "experience [short-term outcome], leading to [long-term outcome], because [documented local need].";

function fallbackBudgetStructure(narrative?: string): BudgetStructure {
  return {
    personnelPercent: 60,
    programPercent: 25,
    adminPercent: 10,
    otherPercent: 5,
    narrative: narrative ?? DEFAULT_BUDGET_NARRATIVE,
  };
}

function buildFallbackIntelligence(
  narratives: ReferenceNarrative[],
): Omit<GrantPatternIntelligence, "referenceNarratives"> {
  const winningPhrases = Array.from(
    new Set(narratives.flatMap((n) => n.keywords)),
  ).slice(0, 10);
  const successFactors = Array.from(
    new Set(narratives.flatMap((n) => n.successFactors)),
  ).slice(0, 5);

  return {
    winningPhrases,
    successFactors,
    persuasiveElements: [],
    budgetStructureRecommendation: fallbackBudgetStructure(),
    evaluationApproachRecommendation: DEFAULT_EVALUATION_APPROACH,
    theoryOfChangeTemplate: DEFAULT_THEORY_OF_CHANGE,
    funderPreferences: [],
    avoidPatterns: [],
    recommendedWordCount: DEFAULT_WORD_COUNT,
    recommendedSections: DEFAULT_SECTIONS,
  };
}

async function fetchCandidatePool(
  supabase: SupabaseClient,
): Promise<IntelligenceProposalRow[]> {
  const { data } = await supabase
    .from("intelligence_funded_proposals")
    .select(
      "id, source, funder_name, funder_type, grant_program, award_amount, award_year, category, full_text, metadata",
    )
    .not("full_text", "is", null)
    .order("award_amount", { ascending: false, nullsFirst: false })
    .limit(CANDIDATE_POOL_LIMIT);

  return (data ?? []) as IntelligenceProposalRow[];
}

/** First significant (>=4 char) word of the funder's name, for a loose
 * ILIKE-style substring match — mirrors the task's "funder_name_keyword"
 * without over-matching on generic words like "The" or "Inc". */
function deriveFunderNameKeyword(funderName: string | null): string | null {
  if (!funderName) return null;
  const word = funderName
    .toLowerCase()
    .split(/\s+/)
    .find((w) => w.length >= 4);
  return word ?? funderName.toLowerCase();
}

function scoreCandidate(
  row: IntelligenceProposalRow,
  opportunity: Opportunity,
  combinedKeywords: string[],
  funderNameKeyword: string | null,
): ScoredCandidate {
  let score = 0;
  const reasons: string[] = [];

  if ((row.category ?? []).includes(opportunity.category)) {
    score += SCORE_CATEGORY_MATCH;
    reasons.push(`funder category match (${opportunity.category})`);
  }

  const rowBucket = deriveFunderBucket(row.source, row.funder_type);
  const oppBuckets = FUNDER_TYPE_TO_BUCKETS[deriveFunderType(opportunity.category)];
  if (rowBucket && oppBuckets.includes(rowBucket)) {
    score += SCORE_FUNDER_TYPE_MATCH;
    reasons.push(`funder type match (${rowBucket})`);
  }

  if (
    opportunity.amountMin != null &&
    opportunity.amountMax != null &&
    row.award_amount != null
  ) {
    const lower = opportunity.amountMin * AMOUNT_MATCH_LOWER_MULTIPLIER;
    const upper = opportunity.amountMax * AMOUNT_MATCH_UPPER_MULTIPLIER;
    if (row.award_amount >= lower && row.award_amount <= upper) {
      score += SCORE_AMOUNT_MATCH;
      reasons.push("award amount within range");
    }
  }

  const rowKeywords = [
    ...(row.metadata?.keywords ?? []).map((k) => k.toLowerCase()),
    ...(row.metadata?.success_factors ?? []).flatMap((s) => extractKeywords(s)),
  ];
  const hasKeywordOverlap = rowKeywords.some((rk) =>
    combinedKeywords.some((ck) => rk.includes(ck) || ck.includes(rk)),
  );
  if (hasKeywordOverlap) {
    score += SCORE_KEYWORD_MATCH;
    reasons.push("keyword/topic overlap");
  }

  if (
    funderNameKeyword &&
    row.funder_name &&
    row.funder_name.toLowerCase().includes(funderNameKeyword)
  ) {
    score += SCORE_FUNDER_NAME_MATCH;
    reasons.push("funder name match");
  }

  return { row, score, reasons };
}

/** Dedupe (candidates are already unique by id from a single pool fetch),
 * rank by score desc / award_amount desc, take top 5. When fewer than 3 rows
 * score above zero, backfill by award_amount so a draft is never left with
 * no library grounding at all — mirrors the MIN_NARRATIVES floor the prior
 * loadIntelligenceLibrary implementation already established for this table. */
function selectTopCandidates(scored: ScoredCandidate[]): ScoredCandidate[] {
  const byScoreThenAmount = (a: ScoredCandidate, b: ScoredCandidate) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.row.award_amount ?? 0) - (a.row.award_amount ?? 0);
  };

  const matched = scored.filter((c) => c.score > 0).sort(byScoreThenAmount);
  let selected = matched.slice(0, MAX_NARRATIVES);

  if (selected.length < MIN_NARRATIVES) {
    const usedIds = new Set(selected.map((c) => c.row.id));
    const backfill = scored
      .filter((c) => !usedIds.has(c.row.id))
      .sort((a, b) => (b.row.award_amount ?? 0) - (a.row.award_amount ?? 0))
      .slice(0, MIN_NARRATIVES - selected.length)
      .map((c) => ({ ...c, reasons: [...c.reasons, "backfill (below minimum match threshold)"] }));
    selected = [...selected, ...backfill];
  }

  return selected;
}

function toReferenceNarrative(candidate: ScoredCandidate): ReferenceNarrative {
  const { row, score, reasons } = candidate;
  return {
    id: row.id,
    funderName: row.funder_name,
    grantProgram: row.grant_program,
    awardAmount: row.award_amount,
    fullText: row.full_text ?? "",
    successFactors: row.metadata?.success_factors ?? [],
    keywords: row.metadata?.keywords ?? [],
    funderBucket: deriveFunderBucket(row.source, row.funder_type),
    matchScore: score,
    matchReasons: reasons,
  };
}

const SYNTHESIS_SYSTEM_PROMPT =
  "You are a senior grant writing strategist. Analyze these successful grant narratives and extract " +
  "actionable patterns for a new grant application. Base every observation strictly on the reference " +
  "narratives and the organization/opportunity data provided below — never invent a funder preference, " +
  "statistic, or pattern that isn't grounded in what you were given. Keep every string field concise " +
  "(most under 20 words). Return ONLY a single JSON object, no markdown code fence, no preamble, " +
  "matching exactly this shape:\n" +
  '{"winningPhrases": ["..."], "successFactors": ["..."], "persuasiveElements": ' +
  '[{"elementType": "...", "description": "...", "whyItWorks": "..."}], "budgetStructure": ' +
  '{"personnelPercent": 0, "programPercent": 0, "adminPercent": 0, "otherPercent": 0, "narrative": "..."}, ' +
  '"evaluationApproach": "...", "theoryOfChangeTemplate": "...", "funderPreferences": ["..."], ' +
  '"avoidPatterns": ["..."], "recommendedWordCount": 0, "recommendedSections": ["..."]}\n' +
  "winningPhrases: up to 10 phrases adapted (not copied verbatim) from the reference narratives for this " +
  "org to use. successFactors: up to 5 factors present across the matching grants. persuasiveElements: " +
  "the rhetorical/structural techniques the winning narratives use and why they work with this type of " +
  "funder. budgetStructure percentages should sum to approximately 100. avoidPatterns: what seems absent " +
  "or weak in narratives that did not score as strongly, inferred by contrast with the strongest " +
  "reference narratives provided.";

function buildSynthesisPrompt(
  orgProfile: OrgProfile,
  opportunity: Opportunity,
  narratives: ReferenceNarrative[],
): string {
  const orgBlock = [
    `Organization: ${orgProfile.name}`,
    `Mission: ${orgProfile.missionStatement ?? "not provided"}`,
    `Service area: ${orgProfile.serviceArea ?? "not provided"}`,
    `Target population: ${orgProfile.targetPopulation ?? "not provided"}`,
    `Annual budget: ${orgProfile.annualBudget ?? "not provided"}`,
  ].join("\n");

  const oppBlock = [
    `Opportunity: ${opportunity.name}`,
    `Funder category: ${opportunity.category}`,
    `Funder: ${opportunity.funderName ?? "unknown"}`,
    `Amount range: ${opportunity.amountMin ?? "unspecified"} - ${opportunity.amountMax ?? "unspecified"}`,
    opportunity.description ? `Description: ${opportunity.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const narrativeBlocks = narratives
    .map((n, i) => {
      const amount = n.awardAmount != null ? `$${n.awardAmount.toLocaleString()}` : "unspecified";
      return (
        `[Reference ${i + 1} -- Funder: ${n.funderName ?? "Unknown"} | Program: ${n.grantProgram ?? "Unspecified"} | ` +
        `Amount: ${amount}]\n${n.fullText.slice(0, NARRATIVE_TEXT_CHAR_LIMIT)}`
      );
    })
    .join("\n\n");

  return [
    "ORGANIZATION PROFILE:",
    orgBlock,
    "",
    "OPPORTUNITY:",
    oppBlock,
    "",
    "REFERENCE NARRATIVES (real awarded grants, ranked by relevance):",
    narrativeBlocks,
  ].join("\n");
}

function toStringArray(value: unknown, max?: number): string[] {
  if (!Array.isArray(value)) return [];
  const arr = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return max != null ? arr.slice(0, max) : arr;
}

function toStr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function clampPercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

function toPersuasiveElements(value: unknown): PersuasiveElement[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      elementType: toStr(item.elementType, "unspecified"),
      description: toStr(item.description, ""),
      whyItWorks: toStr(item.whyItWorks, ""),
    }))
    .filter((el) => el.description.length > 0);
}

function toBudgetStructure(value: unknown, fallbackNarrative: string): BudgetStructure {
  if (value && typeof value === "object") {
    const b = value as Record<string, unknown>;
    const personnel = clampPercent(b.personnelPercent);
    const program = clampPercent(b.programPercent);
    const admin = clampPercent(b.adminPercent);
    const other = clampPercent(b.otherPercent);
    if (personnel != null && program != null && admin != null && other != null) {
      return {
        personnelPercent: personnel,
        programPercent: program,
        adminPercent: admin,
        otherPercent: other,
        narrative: toStr(b.narrative, fallbackNarrative),
      };
    }
  }
  return fallbackBudgetStructure(fallbackNarrative);
}

/** Parses Claude's synthesis JSON, merging per-field onto the deterministic
 * fallback (built from the narratives' own metadata) so a partially-invalid
 * or truncated response degrades field-by-field rather than discarding
 * everything — same convention as EvaluationLibrary.getFrameworkByCategory's
 * DB-row-with-fallback merge. */
function parseSynthesisResponse(
  text: string,
  fallback: Omit<GrantPatternIntelligence, "referenceNarratives">,
): Omit<GrantPatternIntelligence, "referenceNarratives"> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const winningPhrases = toStringArray(parsed.winningPhrases, 10);
    const successFactors = toStringArray(parsed.successFactors, 5);
    const persuasiveElements = toPersuasiveElements(parsed.persuasiveElements);
    const budgetStructureRecommendation = toBudgetStructure(
      parsed.budgetStructure,
      fallback.budgetStructureRecommendation.narrative,
    );

    return {
      winningPhrases: winningPhrases.length > 0 ? winningPhrases : fallback.winningPhrases,
      successFactors: successFactors.length > 0 ? successFactors : fallback.successFactors,
      persuasiveElements:
        persuasiveElements.length > 0 ? persuasiveElements : fallback.persuasiveElements,
      budgetStructureRecommendation,
      evaluationApproachRecommendation: toStr(
        parsed.evaluationApproach,
        fallback.evaluationApproachRecommendation,
      ),
      theoryOfChangeTemplate: toStr(parsed.theoryOfChangeTemplate, fallback.theoryOfChangeTemplate),
      funderPreferences: toStringArray(parsed.funderPreferences),
      avoidPatterns: toStringArray(parsed.avoidPatterns),
      recommendedWordCount:
        typeof parsed.recommendedWordCount === "number" && parsed.recommendedWordCount > 0
          ? Math.round(parsed.recommendedWordCount)
          : fallback.recommendedWordCount,
      recommendedSections:
        toStringArray(parsed.recommendedSections).length > 0
          ? toStringArray(parsed.recommendedSections)
          : fallback.recommendedSections,
    };
  } catch {
    return fallback;
  }
}

/**
 * Matches this opportunity + org profile against the Intelligence Library
 * and synthesizes actionable drafting guidance via a single Claude call.
 * Never throws — a missing ANTHROPIC_API_KEY, a Claude failure, or a
 * corpus with zero eligible rows all degrade to deterministic fallback
 * content built from whatever real reference narratives were found (or an
 * honestly empty/generic result when none were), so this can never block
 * draft generation.
 */
export async function extractGrantPatterns(
  orgProfile: OrgProfile,
  opportunity: Opportunity,
  supabase: SupabaseClient,
): Promise<GrantPatternIntelligence> {
  const candidatePool = await fetchCandidatePool(supabase);

  const orgKeywords = extractKeywords(
    `${orgProfile.missionStatement ?? ""} ${orgProfile.targetPopulation ?? ""} ${orgProfile.serviceArea ?? ""}`,
  );
  const oppKeywords = extractKeywords(
    `${opportunity.name} ${opportunity.description ?? ""} ${opportunity.category}`,
  );
  const combinedKeywords = [...orgKeywords, ...oppKeywords];
  const funderNameKeyword = deriveFunderNameKeyword(opportunity.funderName);

  const scored = candidatePool.map((row) =>
    scoreCandidate(row, opportunity, combinedKeywords, funderNameKeyword),
  );
  const referenceNarratives = selectTopCandidates(scored).map(toReferenceNarrative);

  const fallback = buildFallbackIntelligence(referenceNarratives);

  if (referenceNarratives.length === 0) {
    return { ...fallback, referenceNarratives };
  }

  try {
    const response = await callClaude({
      system: SYNTHESIS_SYSTEM_PROMPT,
      prompt: buildSynthesisPrompt(orgProfile, opportunity, referenceNarratives),
      model: DEFAULT_MODEL,
      maxTokens: SYNTHESIS_MAX_TOKENS,
    });
    const synthesized = parseSynthesisResponse(response.text, fallback);
    return { ...synthesized, referenceNarratives };
  } catch {
    return { ...fallback, referenceNarratives };
  }
}
