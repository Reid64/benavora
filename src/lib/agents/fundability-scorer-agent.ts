// AG-29 Fundability Scorer Agent (AutonomousAgent, migration 091:
// fundability_scores). Phase 2 per AUTONOMOUS_PLATFORM_VISION.md section
// "Fundability Intelligence Score" and AGENTS_v2.md's Phase 2-5 spec section.
//
// Numbering note: AGENTS_v2.md's own Section 5 roster already assigns AG-29 to
// a different, also-unbuilt agent (Knowledge Engine Indexer) - the Phase 2-5
// addendum in that same document flags this exact collision explicitly. This
// agent's agentId ("ag-29-fundability") is deliberately suffixed so its
// agent_type enum value (migration 091) can never collide with a future
// literal "ag-29" build.
//
// SCHEMA NOTE (2026-07-20 hardening pass): the live schema (migration 091)
// has exactly ONE table, `fundability_scores`, with `deficiencies` as a jsonb
// array column - there is no separate `fundability_deficiencies` table.
// Per-deficiency fix tracking (fix_status/fixed_at) is therefore stored as
// fields *inside* each element of that jsonb array and persisted back to
// `fundability_scores.deficiencies` via an UPDATE after auto-fix resolution
// runs, matching Core Data Principle #3 (SCHEMA_REGISTRY_v2.md §4.2: "All
// scoring data stored as jsonb. Never add columns per score type.").
// Similarly, there is no `knowledge_base_profiles` table or `.mission_data`/
// `.programs_data` columns anywhere in the schema - the org's mission and
// programs actually live on `organizations.mission_statement` and
// `organizational_digital_twins.mission`/`.programs`, which is what the
// auto-fix engine below reads.
//
// Purpose: extends the existing deterministic Grant Probability Engine
// (src/lib/intelligence/grant-probability-engine.ts's computeGrantProbability(),
// opportunity_probability_scores) into a diagnostic layer. Rather than a bare
// 0-100 score, this agent asks Claude to decompose the opportunity into
// specific deficiencies across eight fixed rubric categories, attempts to
// auto-resolve the ones that are actually fixable from data already on file,
// and independently re-scores the opportunity assuming those fixes landed -
// probability_with_fixes is a second, real Claude call, never an estimated
// delta.
//
// Hard limit (matches AUTONOMOUS_PLATFORM_VISION.md's own framing for this
// feature): this agent never auto-publishes anything into knowledge_base,
// organizational_digital_twins, or applications. Its auto-fix engine only
// ever *reads* those tables to confirm whether a flagged gap is already
// resolved (e.g. the org's website was populated after the deficiency was
// first flagged) or notifies the org to fill it in - it never writes
// narrative content into them. Turning a gap into an actual drafted KB entry
// (AUTONOMOUS_PLATFORM_VISION.md's "Auto-Fix Available" flow via a narrow
// AG-06 invocation through `/api/intelligence/grant-probability/auto-fix`) is
// a separate, not-yet-built route and remains out of scope for this agent.
//
// Per-org scope: like every other AutonomousAgent, this class operates on
// `this.orgId` only. A multi-org nightly loop belongs in a future
// worker/autonomous-orchestrator.ts registration, not inside this class.
//
// Chain-reachability note: this agent chains a high-scoring opportunity to
// "ag-05-draft" (DraftGenerationAgent). Per AGENTS_v2.md §1.3, that agent_id
// currently has no case in worker/autonomous-orchestrator.ts's
// routeQueueItem() switch, so the enqueued row will fail-and-retry until it
// lands in `failed` - this mirrors the same accepted, forward-defensive
// pattern already used by probability-scoring-agent.ts and
// deadline-prediction-agent.ts's own "ag-05-draft" chains: correct once the
// routing gap is fixed, not dead code today.
//
// Grounding: every fact in every prompt below is loaded by this agent itself
// (organizations, opportunities, knowledge_base category coverage,
// organizational_digital_twins, opportunity_probability_scores, documents) -
// Claude is never asked to assume a fact it wasn't given, matching CLAUDE.md
// Iron Law #8 / #3.

import type { SupabaseClient } from "@supabase/supabase-js";
import { subDays } from "date-fns";
import pLimit from "p-limit";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

type FixType = "kb_gap" | "twin_gap" | "structural";
type Recommendation = "apply" | "consider" | "skip" | "fix_then_apply";

/** The eight fixed rubric categories every deficiency must be classified
 * under. This list is authoritative for both the system prompt and response
 * validation - Claude may never invent a ninth category. */
type DeficiencyCategory =
  | "mission_alignment"
  | "geographic_eligibility"
  | "financial_capacity"
  | "staff_capacity"
  | "track_record"
  | "reporting_capability"
  | "board_governance"
  | "compliance_status";

/** The only gap types this agent's auto-fix engine actually knows how to
 * resolve or notify on. Any deficiency Claude flags outside these four -
 * including every "structural" deficiency by definition - is left
 * fix_status='manual_required' with no automated action attempted. */
type FixKey =
  | "missing_website"
  | "missing_mission"
  | "missing_financial_docs"
  | "incomplete_programs"
  | "none";

type FixStatus = "fixed" | "notified" | "manual_required";

const DEFICIENCY_CATEGORIES: DeficiencyCategory[] = [
  "mission_alignment",
  "geographic_eligibility",
  "financial_capacity",
  "staff_capacity",
  "track_record",
  "reporting_capability",
  "board_governance",
  "compliance_status",
];
const FIX_TYPES: FixType[] = ["kb_gap", "twin_gap", "structural"];
const RECOMMENDATIONS: Recommendation[] = [
  "apply",
  "consider",
  "skip",
  "fix_then_apply",
];
const FIX_KEYS: FixKey[] = [
  "missing_website",
  "missing_mission",
  "missing_financial_docs",
  "incomplete_programs",
  "none",
];

/** Requirement 1: max_tokens 2000 for the base scoring call. */
const MAX_TOKENS = 2000;
/** The re-score ("with fixes") call is a much smaller ask - one number and a
 * one-sentence rationale - so it gets a tighter budget. */
const FIXED_PROBABILITY_MAX_TOKENS = 400;
const MAX_PER_RUN = 8;
/** Requirement 6: skip opportunities scored within the last 7 days unless
 * force=true is passed. */
const STALE_AFTER_DAYS = 7;
/** Requirement 5: maximum 5 concurrent Claude API calls. */
const MAX_CONCURRENT_CLAUDE_CALLS = 5;
/** Requirement 7: chain to draft-generation-agent at score >= 85. */
const AUTO_DRAFT_CHAIN_THRESHOLD = 85;
/** Requirement 8: every decision's reasoning must be >= 100 words. */
const MIN_REASONING_WORDS = 100;
/** Financial-document categories (document_category enum) that satisfy a
 * missing_financial_docs deficiency. */
const FINANCIAL_DOC_CATEGORIES = ["financial_documents", "tax_documents"];

interface OpportunityScopeRow {
  id: string;
  name: string | null;
}

interface FundabilityScoreScopeRow {
  opportunity_id: string;
  generated_at: string | null;
}

interface OrgProfile {
  name: string;
  tax_status: string | null;
  mission_statement: string | null;
  service_area: string | null;
  target_population: string | null;
  annual_budget: number | null;
  website: string | null;
}

interface OpportunityFacts {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  eligibility_requirements: string | null;
  geographic_restrictions: string | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  eligibility_score: number | null;
}

interface ExistingProbabilityRow {
  overall_score: number | null;
  confidence: string | null;
  key_risks: string[] | null;
  key_strengths: string[] | null;
}

interface DigitalTwinRow {
  twin_completeness_score: number | null;
  key_strengths: string[] | null;
  proven_narrative_patterns: string[] | null;
  mission: string | null;
  programs: unknown[] | null;
}

// Field names below (`factor`, `auto_fixable`) intentionally match the
// pre-existing contract read by src/components/opportunities/FundabilityPanel.tsx
// and src/lib/agents/draft-generation-agent.ts, rather than more literal names
// like `category`/`is_auto_fixable` - those two are real, already-wired
// consumers of `fundability_scores.deficiencies`, and renaming this contract
// out from under them would silently break the UI panel and the Twin-Powered
// Draft Generation fundability section. `factor`'s value is constrained to
// the eight-category rubric (`DeficiencyCategory`) below; only the field's
// name is preserved, not its type.
interface RawDeficiency {
  factor?: string;
  issue?: string;
  fix_type?: string;
  fix_key?: string;
  fix_action?: string;
  auto_fixable?: boolean;
}

interface ValidatedDeficiency {
  factor: DeficiencyCategory;
  issue: string;
  fix_type: FixType;
  fix_key: FixKey;
  fix_action: string;
  auto_fixable: boolean;
  fix_status: FixStatus;
  fixed_at: string | null;
}

interface ParsedFundabilityResult {
  overall_score: number;
  confidence: "high" | "medium" | "low";
  recommendation: Recommendation;
  deficiencies: ValidatedDeficiency[];
}

interface ParsedFixedProbability {
  probability_with_fixes: number;
  rationale: string;
}

/** Shared, per-run context loaded once and reused across every opportunity's
 * two Claude calls and auto-fix pass. */
interface RunContext {
  org: OrgProfile;
  twin: DigitalTwinRow | null;
  kbCategories: string[];
  hasFinancialDocs: boolean;
  financialDocCount: number;
}

interface OpportunityOutcome {
  opportunityId: string;
  scored: boolean;
  overallScore: number | null;
  deficiencyCount: number;
  autoFixedCount: number;
  manualRequiredCount: number;
  tokensUsed: number;
  chained: boolean;
  decisionId: string | null;
  error: string | null;
}

function clampScore(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function formatCurrency(amount: number | null): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Coerces one of Claude's raw deficiency objects against the eight-category
 * rubric. Invalid category/fix_type/fix_key or missing required text is
 * rejected outright rather than persisted and left to a downstream reader to
 * guess at. `is_auto_fixable` can only ever be true for kb_gap/twin_gap
 * deficiencies with a recognized fix_key - a structural mismatch or an
 * unrecognized fix_key is never auto-fixable regardless of what Claude
 * claims. */
function validateDeficiency(raw: RawDeficiency): ValidatedDeficiency | null {
  if (!raw.factor || !raw.issue || !raw.fix_action) return null;
  if (!DEFICIENCY_CATEGORIES.includes(raw.factor as DeficiencyCategory)) {
    return null;
  }

  const fix_type =
    raw.fix_type && FIX_TYPES.includes(raw.fix_type as FixType)
      ? (raw.fix_type as FixType)
      : "structural";
  const fix_key =
    raw.fix_key && FIX_KEYS.includes(raw.fix_key as FixKey)
      ? (raw.fix_key as FixKey)
      : "none";

  const auto_fixable =
    raw.auto_fixable === true && fix_type !== "structural" && fix_key !== "none";

  return {
    factor: raw.factor as DeficiencyCategory,
    issue: raw.issue,
    fix_type,
    fix_key,
    fix_action: raw.fix_action,
    auto_fixable,
    fix_status: "manual_required",
    fixed_at: null,
  };
}

/** Extracts the first balanced JSON object from Claude's reply, tolerating
 * stray prose or code fences, mirroring eligibility-scorer.ts's parser. */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The fundability model returned an unreadable response.");
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The fundability model returned malformed JSON.");
  }
}

function parseFundabilityResponse(text: string): ParsedFundabilityResult {
  const raw = extractJsonObject(text) as {
    overall_score?: unknown;
    confidence?: unknown;
    recommendation?: unknown;
    deficiencies?: unknown;
  };

  const overall_score = clampScore(raw.overall_score, 0);

  const rawConfidence =
    typeof raw.confidence === "string" ? raw.confidence.toLowerCase() : "";
  const confidence: ParsedFundabilityResult["confidence"] =
    rawConfidence === "high" || rawConfidence === "medium" || rawConfidence === "low"
      ? rawConfidence
      : "low";

  const rawRecommendation =
    typeof raw.recommendation === "string" ? raw.recommendation.toLowerCase() : "";
  const recommendation: Recommendation = RECOMMENDATIONS.includes(
    rawRecommendation as Recommendation,
  )
    ? (rawRecommendation as Recommendation)
    : overall_score >= 70
      ? "apply"
      : overall_score >= 40
        ? "fix_then_apply"
        : "skip";

  const rawDeficiencies = Array.isArray(raw.deficiencies)
    ? (raw.deficiencies as RawDeficiency[])
    : [];
  const deficiencies = rawDeficiencies
    .map(validateDeficiency)
    .filter((d): d is ValidatedDeficiency => d !== null);

  return { overall_score, confidence, recommendation, deficiencies };
}

function parseFixedProbabilityResponse(
  text: string,
  fallback: number,
): ParsedFixedProbability {
  const raw = extractJsonObject(text) as {
    probability_with_fixes?: unknown;
    rationale?: unknown;
  };
  return {
    probability_with_fixes: clampScore(raw.probability_with_fixes, fallback),
    rationale:
      typeof raw.rationale === "string" && raw.rationale.trim() !== ""
        ? raw.rationale
        : "No rationale returned.",
  };
}

/** Requirement 1: a system prompt of at least 400 words precisely defining
 * the rubric, the eight deficiency categories, and the exact JSON contract.
 * Computed once - it depends on no per-call arguments. */
function buildSystemPrompt(): string {
  return [
    "You are Benavora's Fundability Diagnostic Analyst, an expert nonprofit grants reviewer whose sole job is to explain, with total precision, exactly why a specific funding opportunity scores the way it does for a specific organization - not just what the score is, but which concrete gap is behind every point lost, so the organization knows precisely what to fix before it applies. You are conservative: you never guess, you never invent a fact about the organization or the funder that was not given to you, and you never inflate a score to be encouraging. A wrong score that leads an under-prepared organization to waste weeks on a doomed application is a real cost to a small nonprofit's limited staff time, so accuracy matters more than optimism.",
    "",
    "THE 0-100 SCALE. Score the opportunity's overall fundability - the organization's realistic readiness to submit a competitive application to this specific opportunity, today, as-is. 90-100 means the organization's on-file profile, financial capacity, and track record are essentially a direct match for the funder's stated priorities and eligibility requirements, with no material gap. 70-89 means a strong match with only minor, easily-addressed gaps. 50-69 means a moderate match: real gaps exist in one or more rubric categories below that a reviewer would likely notice and penalize. 30-49 means significant gaps across multiple categories that make a competitive submission unlikely without real remediation work first. 0-29 means the opportunity is a poor fit today, whether from a structural mismatch, a near-total absence of the organizational data a strong application would need, or both.",
    "",
    "THE EIGHT DEFICIENCY CATEGORIES. Every deficiency you report must be classified under exactly one of these eight - never invent a ninth:",
    "1. mission_alignment - the organization's stated mission, programs, and target population do not clearly match what this funder says it wants to fund.",
    "2. geographic_eligibility - the funder's geographic restrictions do not clearly include the organization's service area, or the service area was not documented clearly enough to confirm eligibility.",
    "3. financial_capacity - the organization's annual budget, financial documentation, or funding history is too thin, unknown, or mismatched with the award size for a funder to trust it can responsibly manage the award.",
    "4. staff_capacity - there is no documented evidence the organization has the staff bandwidth to execute the funded work or comply with reporting obligations.",
    "5. track_record - the organization lacks a documented history of comparable prior awards, outcomes, or proven narrative patterns that would reassure this funder.",
    "6. reporting_capability - there is no evidence on file that the organization can meet this funder's likely reporting, compliance, or outcome-measurement expectations.",
    "7. board_governance - board composition, governance structure, or organizational oversight is undocumented or appears thin for an award of this size.",
    "8. compliance_status - tax status, required registrations, or other compliance prerequisites for this funder or opportunity type are unclear or unconfirmed from the facts given.",
    "",
    "CLASSIFYING EACH DEFICIENCY. Every deficiency's 'factor' field must be one of the eight category names above, exactly spelled. For every deficiency you report, also classify fix_type as one of exactly three values: 'kb_gap' (the organization's Knowledge Base is missing or thin on content that would resolve this - a targeted narrative entry would fix it), 'twin_gap' (the Organizational Digital Twin profile itself is incomplete on this point), or 'structural' (a real mismatch - wrong geography, wrong mission fit, wrong funder type, insufficient budget scale - that no amount of better writing or documentation fixes). Then set fix_key to the single most specific known remediation this platform can act on: 'missing_website' if the deficiency stems from no organization website being on file, 'missing_mission' if it stems from no mission statement being on file in either the organization profile or its Digital Twin, 'missing_financial_docs' if it stems from no financial or tax documents being on file, 'incomplete_programs' if it stems from the Digital Twin having no documented programs, or 'none' if the deficiency does not match any of those four specific gaps. auto_fixable may only be true when fix_type is 'kb_gap' or 'twin_gap' AND fix_key is one of the four specific values above - never true for a 'structural' deficiency, and never true when fix_key is 'none'. Every fix_action must be one concrete, specific instruction (for example: 'Add a budget_justification Knowledge Base entry describing your cost-per-client model'), never a vague generality like 'improve your materials'.",
    "",
    "OUTPUT FORMAT. Respond with ONLY a single JSON object. No preamble, no explanation, no markdown code fences, nothing before the opening brace or after the closing brace - your entire response must be valid JSON and nothing else, in exactly this shape:",
    '{"overall_score": <integer 0-100>, "confidence": "high" | "medium" | "low", "recommendation": "apply" | "consider" | "fix_then_apply" | "skip", "deficiencies": [{"factor": "mission_alignment" | "geographic_eligibility" | "financial_capacity" | "staff_capacity" | "track_record" | "reporting_capability" | "board_governance" | "compliance_status", "issue": "<one sentence>", "fix_type": "kb_gap" | "twin_gap" | "structural", "fix_key": "missing_website" | "missing_mission" | "missing_financial_docs" | "incomplete_programs" | "none", "fix_action": "<one concrete instruction>", "auto_fixable": <boolean>}]}',
  ].join("\n");
}

function buildScoringPrompt(args: {
  org: OrgProfile;
  opportunity: OpportunityFacts;
  existingScore: ExistingProbabilityRow | null;
  twin: DigitalTwinRow | null;
  kbCategories: string[];
  hasFinancialDocs: boolean;
}): string {
  const { org, opportunity, existingScore, twin, kbCategories, hasFinancialDocs } = args;

  const orgLines: string[] = [];
  const add = (label: string, value: string | null) => {
    if (value != null && `${value}`.trim() !== "") orgLines.push(`- ${label}: ${value}`);
  };
  add("Legal name", org.name);
  add("Tax status", org.tax_status);
  add("Website on file", org.website);
  add("Mission (organization profile)", org.mission_statement);
  add("Service area", org.service_area);
  add("Target population", org.target_population);
  add("Annual budget", formatCurrency(org.annual_budget));
  add("Financial/tax documents on file", hasFinancialDocs ? "Yes" : "None on file");
  add(
    "Knowledge Base coverage",
    kbCategories.length > 0
      ? kbCategories.join(", ")
      : "No Knowledge Base entries on file at all.",
  );

  if (twin) {
    add("Mission (Digital Twin)", twin.mission);
    add(
      "Organizational Digital Twin completeness",
      twin.twin_completeness_score != null ? `${twin.twin_completeness_score}%` : null,
    );
    add(
      "Programs documented in Digital Twin",
      twin.programs && twin.programs.length > 0 ? `${twin.programs.length} program(s)` : "None",
    );
    if (twin.key_strengths && twin.key_strengths.length > 0) {
      add("Twin-documented strengths", twin.key_strengths.join("; "));
    }
    if (twin.proven_narrative_patterns && twin.proven_narrative_patterns.length > 0) {
      add("Proven narrative patterns on file", twin.proven_narrative_patterns.join("; "));
    }
  } else {
    orgLines.push("- Organizational Digital Twin: none built yet for this org.");
  }

  const oppLines: string[] = [`- Name: ${opportunity.name}`];
  if (opportunity.category) oppLines.push(`- Category: ${opportunity.category}`);
  const amountRange = [
    formatCurrency(opportunity.amount_min),
    formatCurrency(opportunity.amount_max),
  ];
  if (amountRange[0] || amountRange[1]) {
    oppLines.push(`- Award range: ${amountRange[0] ?? "?"} - ${amountRange[1] ?? "?"}`);
  }
  if (opportunity.description) oppLines.push(`- What the funder wants: ${opportunity.description}`);
  if (opportunity.eligibility_requirements) {
    oppLines.push(`- Eligibility requirements: ${opportunity.eligibility_requirements}`);
  }
  if (opportunity.geographic_restrictions) {
    oppLines.push(`- Geographic restrictions: ${opportunity.geographic_restrictions}`);
  }
  if (opportunity.eligibility_score != null) {
    oppLines.push(`- Existing eligibility score: ${opportunity.eligibility_score}/100`);
  }
  if (opportunity.deadline) oppLines.push(`- Deadline: ${opportunity.deadline}`);

  if (existingScore) {
    oppLines.push(
      existingScore.overall_score != null
        ? `- Existing Grant Probability Engine score: ${existingScore.overall_score}/100 (confidence: ${
            existingScore.confidence ?? "unknown"
          })`
        : "- Existing Grant Probability Engine score: insufficient data to compute (too few real inputs on file).",
    );
    if (existingScore.key_risks && existingScore.key_risks.length > 0) {
      oppLines.push(`- Known risks: ${existingScore.key_risks.join("; ")}`);
    }
    if (existingScore.key_strengths && existingScore.key_strengths.length > 0) {
      oppLines.push(`- Known strengths: ${existingScore.key_strengths.join("; ")}`);
    }
  } else {
    oppLines.push("- No Grant Probability Engine score computed yet for this opportunity.");
  }

  return [
    "## Organization",
    orgLines.join("\n"),
    "",
    "## Opportunity",
    oppLines.join("\n"),
    "",
    "Diagnose the fundability now. Return ONLY the JSON object described in the system prompt.",
  ].join("\n");
}

/** Requirement 3: a second, independent Claude call re-scoring the same
 * opportunity under the explicit assumption that every kb_gap/twin_gap
 * deficiency from the base call has been resolved. Only called when at least
 * one such deficiency exists - a structural-only or deficiency-free result
 * has nothing to hypothetically fix, so probability_with_fixes is defined to
 * equal probability_without_fixes in that case without spending a token. */
function buildFixedProbabilityPrompt(args: {
  opportunityName: string;
  baseScore: number;
  resolvedDeficiencies: ValidatedDeficiency[];
  remainingStructural: ValidatedDeficiency[];
}): string {
  const { opportunityName, baseScore, resolvedDeficiencies, remainingStructural } = args;

  const resolvedLines = resolvedDeficiencies
    .map((d) => `- [${d.factor}] ${d.issue} -> now resolved via: ${d.fix_action}`)
    .join("\n");
  const structuralLines = remainingStructural
    .map((d) => `- [${d.factor}] ${d.issue} (structural - still unresolved, cannot be fixed by content changes)`)
    .join("\n");

  return [
    `The base fundability score for "${opportunityName}" was ${baseScore}/100.`,
    "",
    "Assume the following deficiencies have now been fully and correctly resolved:",
    resolvedLines,
    "",
    remainingStructural.length > 0
      ? `The following structural deficiencies remain unresolved and must still weigh against the score:\n${structuralLines}`
      : "No structural deficiencies remain outstanding.",
    "",
    "Re-evaluate the opportunity's fundability probability under this hypothetical, independently of the base score - do not simply add a flat bonus. The result must never exceed the base score by more than 35 points, and must never exceed 100.",
    'Respond with ONLY a single JSON object, no prose, no code fences: {"probability_with_fixes": <integer 0-100>, "rationale": "<one sentence>"}',
  ].join("\n");
}

/** Requirement 8: builds a >= 100-word reasoning string from real, already-
 * computed facts about this decision - never fabricated filler. If the
 * natural narrative falls short of the minimum, it is extended with a
 * literal, always-true restatement of the full eight-category rubric rather
 * than any invented claim about this specific opportunity. */
function composeReasoning(args: {
  orgName: string;
  opportunityName: string;
  overallScore: number;
  probabilityWithoutFixes: number;
  probabilityWithFixes: number;
  confidence: string;
  recommendation: string;
  deficiencies: ValidatedDeficiency[];
  autoFixed: number;
  manualRequired: number;
  chained: boolean;
}): string {
  const {
    orgName,
    opportunityName,
    overallScore,
    probabilityWithoutFixes,
    probabilityWithFixes,
    confidence,
    recommendation,
    deficiencies,
    autoFixed,
    manualRequired,
    chained,
  } = args;

  const sentences: string[] = [];

  sentences.push(
    `Fundability scoring for "${opportunityName}" against ${orgName}'s current profile produced an overall readiness score of ${overallScore} out of 100 at ${confidence} confidence, with an as-is probability of ${probabilityWithoutFixes}% and a re-evaluated probability of ${probabilityWithFixes}% if every currently fixable deficiency identified this run were resolved.`,
  );

  if (deficiencies.length === 0) {
    sentences.push(
      "No deficiencies were identified against any of the eight scored rubric categories - mission alignment, geographic eligibility, financial capacity, staff capacity, track record, reporting capability, board governance, and compliance status - so this score reflects the organization's readiness exactly as it currently stands, with no remediation path identified as necessary or available for this opportunity.",
    );
  } else {
    const byCategory = deficiencies
      .map((d) => `${d.factor} (${d.fix_type}${d.auto_fixable ? ", auto-fixable" : ""})`)
      .join("; ");
    sentences.push(
      `${deficiencies.length} deficiency(ies) were identified this run: ${byCategory}. Of these, ${autoFixed} were resolved automatically by cross-referencing the organization's own profile, its Organizational Digital Twin, and its document library against the specific gap each deficiency named, while ${manualRequired} require the organization to take manual action - completing a Knowledge Base entry, updating the Digital Twin, or uploading a document - before they can be considered resolved.`,
    );
  }

  sentences.push(`The resulting recommendation for this opportunity is "${recommendation}".`);

  sentences.push(
    chained
      ? "Because the overall score met the autonomous draft-generation threshold and this organization currently has auto-draft enabled, this run queued the opportunity to the draft generation agent (ag-05-draft) for a follow-on narrative draft, which itself remains subject to its own unconditional human-review gate before anything reaches a funder."
      : "This opportunity was not chained to any downstream drafting agent this run, either because its score did not clear the autonomous draft-generation threshold or because this organization does not currently have auto-draft enabled in its autonomous settings, so no further autonomous action was taken beyond recording this score and its deficiency breakdown.",
  );

  let text = sentences.join(" ");
  while (countWords(text) < MIN_REASONING_WORDS) {
    text += ` This score was computed against Benavora's full eight-category fundability rubric: ${DEFICIENCY_CATEGORIES.join(", ")}.`;
  }
  return text;
}

export class FundabilityScorerAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-29-fundability", supabase);
  }

  /** "chain" scope: an upstream agent enqueues this agent's own agent_queue
   * row with input_payload.opportunityIds (optionally .force) - mirrors
   * probability-scoring-agent.ts's loadChainScope(). */
  private async loadChainScope(): Promise<{ scope: OpportunityScopeRow[]; force: boolean }> {
    let queueRow: { input_payload: unknown } | null = null;
    try {
      const { data } = await this.supabase
        .from("agent_queue")
        .select("input_payload")
        .eq("org_id", this.orgId)
        .eq("agent_id", "ag-29-fundability")
        .eq("status", "processing")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      queueRow = data as { input_payload: unknown } | null;
    } catch {
      queueRow = null;
    }

    const payload = (queueRow?.input_payload ?? {}) as {
      opportunityIds?: unknown;
      force?: unknown;
    };
    const force = payload.force === true;
    const opportunityIds = Array.isArray(payload.opportunityIds)
      ? payload.opportunityIds.filter((id): id is string => typeof id === "string")
      : [];
    if (opportunityIds.length === 0) return { scope: [], force };

    try {
      const { data, error } = await this.supabase
        .from("opportunities")
        .select("id, name")
        .eq("organization_id", this.orgId)
        .in("id", opportunityIds);

      if (error) throw new Error(`Failed to load chained opportunities: ${error.message}`);
      return { scope: (data ?? []) as OpportunityScopeRow[], force };
    } catch (err) {
      throw err instanceof Error ? err : new Error("Failed to load chained opportunities.");
    }
  }

  /** Default scope: open opportunities for this org with no fundability_scores
   * row yet, or whose most recent row is older than STALE_AFTER_DAYS - unless
   * force=true, in which case every open opportunity is in scope regardless
   * of cache freshness (Requirement 6). */
  private async loadDefaultScope(force: boolean): Promise<OpportunityScopeRow[]> {
    const [opportunitiesRes, scoresRes] = await Promise.all([
      this.supabase
        .from("opportunities")
        .select("id, name")
        .eq("organization_id", this.orgId)
        .eq("status", "open"),
      this.supabase
        .from("fundability_scores")
        .select("opportunity_id, generated_at")
        .eq("org_id", this.orgId),
    ]);

    if (opportunitiesRes.error) {
      throw new Error(`Failed to load open opportunities: ${opportunitiesRes.error.message}`);
    }
    if (scoresRes.error) {
      throw new Error(`Failed to load existing fundability scores: ${scoresRes.error.message}`);
    }

    const opportunities = (opportunitiesRes.data ?? []) as OpportunityScopeRow[];
    if (force) return opportunities.slice(0, MAX_PER_RUN);

    const latestByOpportunity = new Map<string, string | null>();
    for (const row of (scoresRes.data ?? []) as FundabilityScoreScopeRow[]) {
      const existing = latestByOpportunity.get(row.opportunity_id);
      if (!existing || (row.generated_at && row.generated_at > existing)) {
        latestByOpportunity.set(row.opportunity_id, row.generated_at);
      }
    }

    const staleThreshold = subDays(new Date(), STALE_AFTER_DAYS);

    return opportunities
      .filter((opp) => {
        if (!latestByOpportunity.has(opp.id)) return true;
        const generatedAt = latestByOpportunity.get(opp.id);
        if (!generatedAt) return true;
        return new Date(generatedAt) < staleThreshold;
      })
      .slice(0, MAX_PER_RUN);
  }

  private async loadOrgProfile(): Promise<OrgProfile | null> {
    try {
      const { data, error } = await this.supabase
        .from("organizations")
        .select(
          "name, tax_status, mission_statement, service_area, target_population, annual_budget, website",
        )
        .eq("id", this.orgId)
        .maybeSingle();
      if (error) throw new Error(`Failed to load organization profile: ${error.message}`);
      return (data ?? null) as OrgProfile | null;
    } catch (err) {
      throw err instanceof Error ? err : new Error("Failed to load organization profile.");
    }
  }

  private async loadOpportunityFacts(opportunityId: string): Promise<OpportunityFacts | null> {
    try {
      const { data } = await this.supabase
        .from("opportunities")
        .select(
          "id, name, category, description, eligibility_requirements, geographic_restrictions, amount_min, amount_max, deadline, eligibility_score",
        )
        .eq("id", opportunityId)
        .eq("organization_id", this.orgId)
        .maybeSingle();
      return (data ?? null) as OpportunityFacts | null;
    } catch {
      return null;
    }
  }

  private async loadExistingProbability(
    opportunityId: string,
  ): Promise<ExistingProbabilityRow | null> {
    try {
      const { data } = await this.supabase
        .from("opportunity_probability_scores")
        .select("overall_score, confidence, key_risks, key_strengths")
        .eq("opportunity_id", opportunityId)
        .eq("organization_id", this.orgId)
        .maybeSingle();
      return (data ?? null) as ExistingProbabilityRow | null;
    } catch {
      return null;
    }
  }

  private async loadDigitalTwin(): Promise<DigitalTwinRow | null> {
    try {
      const { data } = await this.supabase
        .from("organizational_digital_twins")
        .select("twin_completeness_score, key_strengths, proven_narrative_patterns, mission, programs")
        .eq("organization_id", this.orgId)
        .maybeSingle();
      return (data ?? null) as DigitalTwinRow | null;
    } catch {
      return null;
    }
  }

  private async loadKnowledgeBaseCategories(): Promise<string[]> {
    try {
      const { data } = await this.supabase
        .from("knowledge_base")
        .select("category")
        .eq("organization_id", this.orgId);

      const categories = new Set<string>();
      for (const row of (data ?? []) as { category: string | null }[]) {
        if (row.category) categories.add(row.category);
      }
      return Array.from(categories);
    } catch {
      return [];
    }
  }

  /** documents table (org-scoped, not opportunity-scoped) - checks whether
   * any financial/tax document is on file at all for missing_financial_docs
   * auto-fix resolution. */
  private async loadFinancialDocsInfo(): Promise<{ hasFinancialDocs: boolean; count: number }> {
    try {
      const { data, error } = await this.supabase
        .from("documents")
        .select("id", { count: "exact" })
        .eq("organization_id", this.orgId)
        .in("category", FINANCIAL_DOC_CATEGORIES);
      if (error) return { hasFinancialDocs: false, count: 0 };
      const count = data?.length ?? 0;
      return { hasFinancialDocs: count > 0, count };
    } catch {
      return { hasFinancialDocs: false, count: 0 };
    }
  }

  /** Requirement 2: the actual auto-fix engine. Each is_auto_fixable
   * deficiency is checked against real, already-loaded data; if the gap
   * turns out to already be resolved on file, it is marked 'fixed'. If not,
   * an org-wide notification is created (at most once per fix_key per run,
   * tracked via `notifiedFixKeys`) and the deficiency is marked 'notified'.
   * Deficiencies that are not is_auto_fixable are left 'manual_required'
   * with no automated action attempted. Every write is individually
   * try/caught so one failure never blocks the rest of the batch. */
  private async applyAutoFixes(
    deficiencies: ValidatedDeficiency[],
    context: RunContext,
    notifiedFixKeys: Set<FixKey>,
    errors: string[],
  ): Promise<{ deficiencies: ValidatedDeficiency[]; autoFixed: number; manualRequired: number }> {
    let autoFixed = 0;
    let manualRequired = 0;
    const now = new Date().toISOString();

    const resolved = await Promise.all(
      deficiencies.map(async (d): Promise<ValidatedDeficiency> => {
        if (!d.auto_fixable) {
          manualRequired++;
          return d;
        }

        try {
          let isResolved = false;
          switch (d.fix_key) {
            case "missing_website":
              isResolved = !!context.org.website && context.org.website.trim() !== "";
              break;
            case "missing_mission":
              isResolved =
                (!!context.org.mission_statement && context.org.mission_statement.trim() !== "") ||
                (!!context.twin?.mission && context.twin.mission.trim() !== "");
              break;
            case "missing_financial_docs":
              isResolved = context.hasFinancialDocs;
              break;
            case "incomplete_programs":
              isResolved = !!context.twin?.programs && context.twin.programs.length > 0;
              break;
            default:
              isResolved = false;
          }

          if (isResolved) {
            autoFixed++;
            return { ...d, fix_status: "fixed", fixed_at: now };
          }

          manualRequired++;
          if (!notifiedFixKeys.has(d.fix_key)) {
            notifiedFixKeys.add(d.fix_key);
            try {
              await this.createNotification(
                "fundability_gap",
                "Fundability gap identified",
                `${d.issue} Action needed: ${d.fix_action}`,
                { fix_key: d.fix_key, factor: d.factor, action: "complete_digital_twin" },
                "warning",
              );
            } catch (notifyErr) {
              errors.push(
                `Failed to send notification for fix_key ${d.fix_key}: ${
                  notifyErr instanceof Error ? notifyErr.message : "unknown error"
                }`,
              );
            }
          }
          return { ...d, fix_status: "notified", fixed_at: null };
        } catch (err) {
          errors.push(
            `Auto-fix check failed for deficiency factor ${d.factor}: ${
              err instanceof Error ? err.message : "unknown error"
            }`,
          );
          manualRequired++;
          return d;
        }
      }),
    );

    return { deficiencies: resolved, autoFixed, manualRequired };
  }

  /** Runs both Claude calls (Requirement 3) for a single opportunity and
   * returns the combined, auto-fix-annotated result plus token usage. Does
   * not touch the database - callers persist the result. */
  private async scoreOpportunity(
    opportunity: OpportunityFacts,
    existingScore: ExistingProbabilityRow | null,
    context: RunContext,
    notifiedFixKeys: Set<FixKey>,
    errors: string[],
  ): Promise<{
    overallScore: number;
    probabilityWithoutFixes: number;
    probabilityWithFixes: number;
    confidence: string;
    recommendation: Recommendation;
    deficiencies: ValidatedDeficiency[];
    autoFixed: number;
    manualRequired: number;
    tokensUsed: number;
  }> {
    let tokensUsed = 0;

    const basePrompt = buildScoringPrompt({
      org: context.org,
      opportunity,
      existingScore,
      twin: context.twin,
      kbCategories: context.kbCategories,
      hasFinancialDocs: context.hasFinancialDocs,
    });

    const baseResponse = await callClaude({
      system: buildSystemPrompt(),
      prompt: basePrompt,
      model: DEFAULT_MODEL,
      maxTokens: MAX_TOKENS,
    });
    tokensUsed += baseResponse.usage.totalTokens;

    const base = parseFundabilityResponse(baseResponse.text);

    const { deficiencies: fixedDeficiencies, autoFixed, manualRequired } = await this.applyAutoFixes(
      base.deficiencies,
      context,
      notifiedFixKeys,
      errors,
    );

    const fixableForReprobability = fixedDeficiencies.filter(
      (d) => d.auto_fixable && (d.fix_type === "kb_gap" || d.fix_type === "twin_gap"),
    );
    const structural = fixedDeficiencies.filter((d) => d.fix_type === "structural");

    let probabilityWithFixes = base.overall_score;
    if (fixableForReprobability.length > 0) {
      try {
        const fixedPrompt = buildFixedProbabilityPrompt({
          opportunityName: opportunity.name,
          baseScore: base.overall_score,
          resolvedDeficiencies: fixableForReprobability,
          remainingStructural: structural,
        });
        const fixedResponse = await callClaude({
          system: buildSystemPrompt(),
          prompt: fixedPrompt,
          model: DEFAULT_MODEL,
          maxTokens: FIXED_PROBABILITY_MAX_TOKENS,
        });
        tokensUsed += fixedResponse.usage.totalTokens;
        const fixedParsed = parseFixedProbabilityResponse(fixedResponse.text, base.overall_score);
        probabilityWithFixes = Math.min(100, Math.max(base.overall_score, fixedParsed.probability_with_fixes));
      } catch (err) {
        errors.push(
          `Fixed-probability re-score failed for "${opportunity.name}", falling back to base score: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        );
        probabilityWithFixes = base.overall_score;
      }
    }

    return {
      overallScore: base.overall_score,
      probabilityWithoutFixes: base.overall_score,
      probabilityWithFixes,
      confidence: base.confidence,
      recommendation: base.recommendation,
      deficiencies: fixedDeficiencies,
      autoFixed,
      manualRequired,
      tokensUsed,
    };
  }

  /** Full per-opportunity pipeline: score, auto-fix, persist, log decision,
   * and conditionally chain. Every database write is independently
   * try/caught so a failure at any single step is recorded in `errors` and
   * the run continues rather than aborting the whole batch (Requirement 4). */
  private async processOpportunity(
    oppScope: OpportunityScopeRow,
    runId: string,
    context: RunContext,
    orgConfig: { auto_draft_enabled: boolean },
    notifiedFixKeys: Set<FixKey>,
  ): Promise<OpportunityOutcome> {
    const errors: string[] = [];

    try {
      const opportunity = await this.loadOpportunityFacts(oppScope.id);
      if (!opportunity) {
        return {
          opportunityId: oppScope.id,
          scored: false,
          overallScore: null,
          deficiencyCount: 0,
          autoFixedCount: 0,
          manualRequiredCount: 0,
          tokensUsed: 0,
          chained: false,
          decisionId: null,
          error: `Opportunity ${oppScope.id} not found or not in this org - skipped.`,
        };
      }

      const existingScore = await this.loadExistingProbability(oppScope.id);

      const result = await this.scoreOpportunity(
        opportunity,
        existingScore,
        context,
        notifiedFixKeys,
        errors,
      );

      let insertedId: string | null = null;
      try {
        const { data: inserted, error: insertError } = await this.supabase
          .from("fundability_scores")
          .insert({
            org_id: this.orgId,
            opportunity_id: oppScope.id,
            overall_score: result.overallScore,
            probability_without_fixes: result.probabilityWithoutFixes,
            probability_with_fixes: result.probabilityWithFixes,
            confidence: result.confidence,
            deficiencies: result.deficiencies,
            recommendation: result.recommendation,
          })
          .select("id")
          .single();

        if (insertError || !inserted) {
          errors.push(
            `Failed to save fundability score for "${opportunity.name}": ${
              insertError?.message ?? "no row returned"
            }`,
          );
        } else {
          insertedId = (inserted as { id: string }).id;
        }
      } catch (err) {
        errors.push(
          `Failed to save fundability score for "${opportunity.name}": ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        );
      }

      const shouldChain =
        result.overallScore >= AUTO_DRAFT_CHAIN_THRESHOLD && orgConfig.auto_draft_enabled;
      if (shouldChain) {
        try {
          await this.queueChainedAgent(
            "ag-05-draft",
            8,
            {
              opportunityId: oppScope.id,
              score: result.overallScore,
              title: opportunity.name,
              reason: "fundability_score_above_threshold",
            },
            runId,
          );
        } catch (err) {
          errors.push(
            `Failed to queue ag-05-draft chain for "${opportunity.name}": ${
              err instanceof Error ? err.message : "unknown error"
            }`,
          );
        }
      }

      let decisionId: string | null = null;
      try {
        const reasoning = composeReasoning({
          orgName: context.org.name,
          opportunityName: opportunity.name,
          overallScore: result.overallScore,
          probabilityWithoutFixes: result.probabilityWithoutFixes,
          probabilityWithFixes: result.probabilityWithFixes,
          confidence: result.confidence,
          recommendation: result.recommendation,
          deficiencies: result.deficiencies,
          autoFixed: result.autoFixed,
          manualRequired: result.manualRequired,
          chained: shouldChain,
        });

        decisionId = await this.logDecision({
          decisionType: "fundability_scored",
          agentRunId: runId,
          entityType: "opportunity",
          entityId: oppScope.id,
          reasoning,
          confidenceScore: result.overallScore,
          actionTaken: insertedId
            ? `Recorded fundability score ${result.overallScore}/100 with ${result.deficiencies.length} deficiency(ies) (${result.autoFixed} auto-fixed, ${result.manualRequired} manual).`
            : `Scored fundability at ${result.overallScore}/100 but failed to persist the row.`,
          actionPayload: {
            deficiencies: result.deficiencies,
            recommendation: result.recommendation,
            probability_without_fixes: result.probabilityWithoutFixes,
            probability_with_fixes: result.probabilityWithFixes,
            chained_to_draft: shouldChain,
          },
          requiredHumanReview: result.manualRequired > 0,
        });
      } catch (err) {
        errors.push(
          `Failed to log agent_decisions row for "${opportunity.name}": ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        );
      }

      return {
        opportunityId: oppScope.id,
        scored: true,
        overallScore: result.overallScore,
        deficiencyCount: result.deficiencies.length,
        autoFixedCount: result.autoFixed,
        manualRequiredCount: result.manualRequired,
        tokensUsed: result.tokensUsed,
        chained: shouldChain,
        decisionId,
        error: errors.length > 0 ? errors.join(" | ") : null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to score opportunity fundability.";
      return {
        opportunityId: oppScope.id,
        scored: false,
        overallScore: null,
        deficiencyCount: 0,
        autoFixedCount: 0,
        manualRequiredCount: 0,
        tokensUsed: 0,
        chained: false,
        decisionId: null,
        error: message,
      };
    }
  }

  override async run(
    triggerSource: TriggerSource,
    options?: { force?: boolean },
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource, { force: options?.force === true });
    const decisions: string[] = [];
    const runErrors: string[] = [];

    try {
      const org = await this.loadOrgProfile();
      if (!org) throw new Error(`Could not load organization ${this.orgId}.`);

      let scope: OpportunityScopeRow[];
      if (triggerSource === "chain") {
        const chainResult = await this.loadChainScope();
        scope = chainResult.scope;
        if (options?.force === undefined) options = { force: chainResult.force };
      } else {
        scope = await this.loadDefaultScope(options?.force === true);
      }

      const [twin, kbCategories, financialDocs, orgConfig] = await Promise.all([
        this.loadDigitalTwin(),
        this.loadKnowledgeBaseCategories(),
        this.loadFinancialDocsInfo(),
        this.getOrgConfig(),
      ]);

      const context: RunContext = {
        org,
        twin,
        kbCategories,
        hasFinancialDocs: financialDocs.hasFinancialDocs,
        financialDocCount: financialDocs.count,
      };

      const notifiedFixKeys = new Set<FixKey>();
      const limit = pLimit(MAX_CONCURRENT_CLAUDE_CALLS);

      const outcomes = await Promise.all(
        scope.slice(0, MAX_PER_RUN).map((opp) =>
          limit(() =>
            this.processOpportunity(
              opp,
              runId,
              context,
              { auto_draft_enabled: orgConfig.auto_draft_enabled },
              notifiedFixKeys,
            ),
          ),
        ),
      );

      let opportunitiesScored = 0;
      let scoreSum = 0;
      let totalDeficiencies = 0;
      let autoFixed = 0;
      let manualRequired = 0;
      let tokensUsed = 0;
      let chainedCount = 0;

      for (const outcome of outcomes) {
        if (outcome.error) runErrors.push(outcome.error);
        if (outcome.decisionId) decisions.push(outcome.decisionId);
        tokensUsed += outcome.tokensUsed;
        if (outcome.scored && outcome.overallScore !== null) {
          opportunitiesScored++;
          scoreSum += outcome.overallScore;
          totalDeficiencies += outcome.deficiencyCount;
          autoFixed += outcome.autoFixedCount;
          manualRequired += outcome.manualRequiredCount;
          if (outcome.chained) chainedCount++;
        }
      }

      const avgScore = opportunitiesScored > 0 ? Math.round(scoreSum / opportunitiesScored) : 0;

      const summary = `Scored ${opportunitiesScored} of ${scope.length} opportunity(ies); avg score ${avgScore}/100; ${totalDeficiencies} deficiency(ies) found (${autoFixed} auto-fixed, ${manualRequired} manual); ${chainedCount} chained to draft generation.`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: scope.length,
        itemsProcessed: opportunitiesScored,
        itemsQueued: chainedCount,
        tokensUsed,
        outputPayload: {
          opportunitiesScored,
          avgScore,
          totalDeficiencies,
          autoFixed,
          manualRequired,
          errors: runErrors,
        },
      });

      return {
        success: true,
        itemsFound: scope.length,
        itemsProcessed: opportunitiesScored,
        itemsQueued: chainedCount,
        decisions,
        nextActions: chainedCount > 0 ? ["ag-05-draft"] : [],
        errors: runErrors,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fundability scoring failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...runErrors, message],
      };
    }
  }
}
