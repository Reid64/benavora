// AG-36 Learning Network Aggregator Agent (AutonomousAgent, migration 080
// infrastructure + migration 083 substrate: platform_learning_patterns,
// org_learning_contributions; migration 099 hardening: confidence, weight,
// anonymized, source_hash columns). Phase 4, AUTONOMOUS_PLATFORM_VISION.md
// "Global Learning Network" section: anonymizes and aggregates successful
// grant patterns (narrative language, budget structure, keywords, timing,
// attachment types, funder preferences) across every org's awarded
// outcomes, so every org's Knowledge Engine benefits from outcomes it never
// personally generated.
//
// PLATFORM-LEVEL, NOT ORG-SCOPED. This agent's own queries never filter by
// organization_id - it reads awarded outcomes across the whole platform via
// a service-role client. That is a deliberate contrast with every other
// AutonomousAgent subclass in this codebase, which are all constructed with
// a real org's id and scope every query to it.
//
// Why this still passes a real orgId to `super()`: AutonomousAgent's
// constructor (src/lib/agents/autonomous-base.ts) requires an orgId, and
// both `agent_runs.organization_id` and `agent_decisions.org_id` are
// `NOT NULL ... REFERENCES organizations(id)`. A service-role client
// bypasses Row Level Security, but it does NOT bypass foreign-key
// constraints - a bare sentinel UUID or a null would fail the insert
// outright. Rather than modify autonomous-base.ts (out of scope; it is
// shared by every other AutonomousAgent subclass), this file lazily
// provisions one real, well-known "system" organization row
// (`ensureSystemOrg()`) the first time it runs, and uses that row's id for
// every base-class call. This satisfies the FK constraint while keeping
// every actual data query in this file unscoped across all real tenant
// orgs.
//
// Numbering collision, flagged per the convention in AGENTS_v2.md §1.4:
// this file uses the literal agentId "ag-36-learning-network" so it cannot
// collide with any string that is actually live in the agent_type enum
// today. See AGENTS_v2.md's own Phase 2-5 addendum for the full cross-doc
// numbering mismatch this agent shares with several others.
//
// RESOLVED (Phase 5.5, 2026-09-15): the paragraph below used to document
// "ag-36-learning-network" as absent from the `agent_type` Postgres enum.
// Live-verified against the real database today: the value already exists
// (added by an earlier, never-committed DDL pass - the same pattern
// AGENTS_v2.md's "canonical implementation per AG-NN slot" table documents
// for several other agent_type values). `startRun()`'s insert into
// `agent_runs` does not throw; this agent runs end-to-end. No code or
// schema change was needed here - this comment was simply stale.
//
// No chain target: AUTONOMOUS_PLATFORM_VISION.md §7's Phase 4 table lists
// this feature as "Internal only - no client-facing route," and this
// agent is the terminal step of its own pass (results surface indirectly
// through /api/intelligence/learning-network and the Knowledge Engine
// query UI, not through a queued downstream agent). `queueChainedAgent()`
// is intentionally never called.
//
// 2026-07-20 ENTERPRISE HARDENING PASS - what changed and why:
//   1. Pattern extraction is now ONE comprehensive per-outcome Claude call
//      (buildAnalysisPrompt/parseOutcomeAnalysis) covering all six pattern
//      types the task spec names, rather than a single narrow phrase-only
//      call. budget_structure, timing, and attachment_combination are
//      GROUNDED: the prompt gives Claude the real, deterministically
//      computed values for these three (a language model has no business
//      inventing arithmetic a database query already answers exactly), and
//      the parser always persists this file's own computed values rather
//      than trusting whatever Claude echoes back - Claude's role for those
//      three fields is limited to confirming it received them, never to
//      recomputing them. narrative_language, keyword, and funder_preference
//      are genuine Claude analysis (language understanding a regex can't
//      replicate), with keyword additionally grounded by real local
//      frequency counts (extractKeywordCandidatesLocally) that Claude
//      ranks/filters for grant-specificity rather than inventing counts.
//   2. Anonymization gained the org-suffix regex, URL stripping, and
//      >$10K dollar-amount redaction the task spec names explicitly, on
//      top of the org-profile-based redaction and email/phone/EIN
//      patterns this file already had.
//   3. Statistical confidence: success_rate is now only recomputed once a
//      pattern's sample_count reaches CONFIDENCE_MIN_SAMPLE (3); below that
//      it is left alone (or left null on first insert) and the new
//      `confidence` column is set to 'low'. checkPatternConfidence() runs
//      the literal COUNT query the task spec describes for observability in
//      each decision's reasoning trail, though the row's own sample_count -
//      not that count - remains the actual gate, since COUNT(*) over
//      (pattern_type, funder_category) counts distinct pattern *rows*
//      (effectively 0 or 1 once ntee_code is null for almost every row
//      today), not corroborating *outcomes*.
//   4. Cross-NTEE analysis (runCrossNteeAnalysis) is real, working code
//      that queries platform_learning_patterns for pattern_type groups with
//      >= 2 distinct non-null ntee_code values and sample_count >= 3, and
//      asks Claude to name the universal practice behind them. Because this
//      file has never had a real EIN->NTEE resolution path (see the
//      unchanged nteeCode note in processOutcome below), no per-outcome
//      pattern is ever written with a non-null ntee_code today, so this
//      pass will realistically report zero qualifying groups until a future
//      session wires foundation_directory/BMF NTEE lookup into funders -
//      the plumbing is real and will activate the moment that data exists,
//      consistent with this codebase's "implement the mechanism honestly,
//      don't fabricate the missing data source" convention (see AG-30/AG-35
//      for the same pattern).
//   5. winning_examples is now capped at 5 per pattern (was 25), matching
//      the task spec's explicit "Limit to 5 examples per pattern" - FIFO
//      eviction unchanged.
//   6. Contribution audit rows now carry an explicit anonymized=true flag
//      and a source_hash (SHA-256 of the raw pre-anonymization narrative).
//      hasOutcomeAlreadyContributed() uses this to make outcome processing
//      idempotent across weekly runs inside the shared 90-day lookback
//      window - the pre-hardening version had no such check and would have
//      double-counted every outcome once, silently inflating sample_count,
//      on its very first re-run. hasSourceHashContributed() additionally
//      catches the narrower case of the exact same narrative text
//      reappearing under a *different* outcome_id (e.g. a cloned
//      application submitted to two funders) - in that case the
//      language-derived candidates (narrative_language, keyword) are
//      skipped as already-represented, while budget/timing/attachment/
//      funder_preference candidates still count, since those genuinely
//      differ per submission even when the narrative text does not.
//   7. generateWeeklyDigest() runs at the end of every invocation (this
//      agent has no wired schedule of its own - see the "No chain target"
//      note above - so "weekly" is whatever external cadence eventually
//      schedules it) and notifies every platform owner via the same
//      cross-tenant alerts-per-owner-org pattern already established by
//      self-improvement-agent.ts's notifyPlatformOwners(), since this
//      schema has no dedicated platform-wide notifications table.
//
// Deviation from the task-given spec, unchanged from before: the task says
// "load the associated application draft_content." `applications.draft_content`
// is used as the primary narrative source (per that instruction literally),
// but falls back to `outcomes.narrative_snapshot` when draft_content is
// null - SCHEMA_REGISTRY_v2.md documents narrative_snapshot as "Narrative
// snapshot frozen at submission," which is the more faithful record of what
// was actually awarded (draft_content can be overwritten by later,
// unrelated draft regeneration on the same application row).

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude } from "@/lib/ai/claude";
import type { Enums } from "@/types/database";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";
type FunderCategory = Enums<"funder_category">;

/** One well-known row this agent provisions in `organizations` so it has a
 * real FK target for agent_runs/agent_decisions while running unscoped. */
const SYSTEM_ORG_ID = "00000000-0000-4000-8000-000000000036";
const SYSTEM_ORG_NAME = "Benavora Platform (System - AG-36 Learning Network)";

const LOOKBACK_DAYS = 90;
/** Bound on how many awarded outcomes one run processes, to keep Claude
 * spend and run duration predictable on a periodic cadence. */
const MAX_OUTCOMES_PER_RUN = 50;
/** Task requirement 5: "Limit to 5 examples per pattern." FIFO eviction. */
const WINNING_EXAMPLES_CAP = 5;
/** Task requirement 5: "sanitized excerpt (max 200 chars) after anonymization." */
const EXCERPT_MAX_LENGTH = 200;
/** Task requirement 1a: "top 5 impactful phrases (exact phrases 3-8 words)." */
const MAX_PHRASES = 5;
const PHRASE_MIN_WORDS = 3;
const PHRASE_MAX_WORDS = 8;
/** Task requirement 1c: "top 10 grant-specific keywords by frequency." */
const MAX_KEYWORDS = 10;
/** How many locally-counted frequency candidates are handed to Claude for
 * grant-specificity ranking - wider than MAX_KEYWORDS so Claude has real
 * choices to filter from, not just the raw top 10 by count alone. */
const MAX_KEYWORD_CANDIDATES = 30;
/** Narrative text sent to Claude is capped, not to save cost on any single
 * call but to bound worst-case run time across up to MAX_OUTCOMES_PER_RUN. */
const MAX_NARRATIVE_CHARS_FOR_CLAUDE = 6000;
/** success_rate here is a confidence proxy, not a true win rate - see the
 * comment on computeConfidenceProxy() below for why. */
const SUCCESS_RATE_CONFIDENCE_TARGET = 20;
/** Task requirement 3: "Only update success_rate when sample_count >= 3." */
const CONFIDENCE_MIN_SAMPLE = 3;
/** Below this, confidence label is 'medium'; at/above, 'high'. Below
 * CONFIDENCE_MIN_SAMPLE it is always 'low' regardless of this threshold. */
const CONFIDENCE_HIGH_SAMPLE = 10;
/** Task requirement 4: a universal (cross-NTEE) pattern needs corroboration
 * from at least this many distinct NTEE codes before Claude is asked to
 * name the shared practice behind them. */
const CROSS_NTEE_MIN_DISTINCT_CODES = 2;
/** Task requirement 4: "Store with ntee_code=NULL and higher weight." Every
 * ordinary per-outcome pattern row is weight=1.0 (migration 099 default);
 * a cross-NTEE universal finding is stored above that. */
const UNIVERSAL_PATTERN_WEIGHT = 1.5;
/** Task requirement 2: "Strip dollar amounts over $10K." */
const DOLLAR_REDACTION_THRESHOLD = 10_000;
const PATTERN_CONTENT_MAX_LENGTH = 400;

/** The full set of pattern_type values the migration 083/099 CHECK
 * constraint permits. 'ntee_success' is reserved specifically for
 * runCrossNteeAnalysis()'s output - no per-outcome candidate ever uses it. */
type PatternType =
  | "narrative_language"
  | "budget_structure"
  | "keyword"
  | "timing"
  | "attachment_type"
  | "funder_preference";
type StoredPatternType = PatternType | "ntee_success";

interface OutcomeRow {
  id: string;
  organization_id: string;
  application_id: string;
  result: string;
  awarded_amount: number | null;
  requested_amount: number | null;
  funder_category: FunderCategory | null;
  opportunity_category: FunderCategory | null;
  keywords_used: string[] | null;
  recorded_at: string;
  narrative_snapshot: string | null;
}

interface ApplicationRow {
  id: string;
  organization_id: string;
  opportunity_id: string | null;
  draft_content: string | null;
  submitted_at: string | null;
  budget_data: unknown;
}

interface OrgAnonymizationProfile {
  name: string | null;
  dba: string | null;
  founder_name: string | null;
  city: string | null;
  state: string | null;
  address_line1: string | null;
  address_line2: string | null;
  phone: string | null;
  email: string | null;
}

interface FunderProfile {
  id: string;
  name: string;
  category: FunderCategory | null;
  description: string | null;
  geographic_focus: string | null;
  annual_giving_budget: number | null;
  notes: string | null;
}

interface BudgetRatio {
  personnel: number;
  programs: number;
  admin: number;
  indirect: number;
}

interface TimingFacts {
  daysBeforeDeadline: number | null;
  dayOfWeek: number | null;
  month: number | null;
}

interface FunderPreference {
  preferred_org_sizes: string[];
  preferred_ntee_codes: string[];
  impact_metrics: string[];
}

/** Result of the single, comprehensive per-outcome Claude call. The three
 * grounded fields (budget_structure/timing/attachment_combination) are
 * parsed for completeness but never trusted over this file's own
 * deterministic computation - see the header comment's hardening note #1. */
interface ParsedOutcomeAnalysis {
  narrativePhrases: string[];
  keywords: string[];
  funderPreference: FunderPreference | null;
}

interface PatternCandidate {
  patternType: PatternType;
  excerpts: string[];
}

interface UpsertPatternParams {
  patternType: StoredPatternType;
  funderCategory: FunderCategory | null;
  nteeCode: string | null;
  excerpts: string[];
  awardAmount: number | null;
  weight?: number;
  /** Cross-NTEE aggregation rows set an explicit combined sample count
   * rather than the default "+1 per contributing outcome" increment. */
  sampleCountOverride?: number;
  /** Cross-NTEE aggregation rows carry their own descriptive content rather
   * than the generic describePatternContent() sentence. */
  patternContentOverride?: string;
}

interface UpsertPatternResult {
  id: string;
  created: boolean;
  sampleCount: number;
  confidence: "low" | "medium" | "high";
  patternContent: string;
  weight: number;
}

interface ProcessOutcomeResult {
  created: number;
  updated: number;
  tokensUsed: number;
  decisionIds: string[];
  skippedAsDuplicate: boolean;
  touchedPatterns: UpsertPatternResult[];
}

const PERSONNEL_KEYWORDS = [
  "personnel",
  "staff",
  "salary",
  "salaries",
  "wage",
  "compensation",
  "benefits",
];
/** Heuristic categorization only - not an authoritative accounting
 * classification. "admin" covers general management overhead; "indirect"
 * covers facilities/indirect-cost-rate style line items. Nonprofit budgets
 * are not standardized enough for a purely keyword-based split to be exact,
 * so computeBudgetRatio() is documented as an approximation. */
const ADMIN_KEYWORDS = ["admin", "administrative", "management"];
const INDIRECT_KEYWORDS = ["indirect", "overhead", "facilities", "operations", "operating"];

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_PATTERN = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const EIN_PATTERN = /\b\d{2}-\d{7}\b/g;
/** Task requirement 2's literal regex: strips "<Capitalized Words> Foundation
 * / Institute / Center / Agency / Organization / Program / Project" style
 * proper-noun phrases before anything derived from them is ever written to
 * the shared platform_learning_patterns table. */
const ORG_SUFFIX_PATTERN =
  /\b[A-Z][a-z]+ (?:[A-Z][a-z]+ )*(?:Foundation|Institute|Center|Agency|Organization|Program|Project)\b/g;
const URL_PATTERN = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
/** Matches "$12,500", "$12500.00", "$ 12,500" etc. Values above
 * DOLLAR_REDACTION_THRESHOLD are redacted to [BUDGET_RANGE]; smaller amounts
 * are left in place as they are rarely identifying on their own. */
const DOLLAR_PATTERN = /\$\s?[\d,]+(?:\.\d+)?/g;

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "before",
  "being",
  "between",
  "could",
  "during",
  "every",
  "first",
  "found",
  "however",
  "including",
  "other",
  "people",
  "program",
  "programs",
  "should",
  "still",
  "their",
  "there",
  "these",
  "those",
  "through",
  "which",
  "while",
  "would",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncateExcerpt(value: string, max = EXCERPT_MAX_LENGTH): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/** Strips org-identifying text before anything derived from it is ever
 * written to the shared platform_learning_patterns table. Order: redact
 * known org fields first (longest value first, so a short token inside a
 * longer one doesn't get double-processed), then the generic org-suffix
 * proper-noun pattern, then email/phone/EIN, then URLs, then dollar amounts
 * over the redaction threshold - each pass is independent of what the org
 * profile lookup found, so this is a safety net even when org fields are
 * missing or the text names a *different* organization (e.g. a funder
 * quoted in the narrative). */
function anonymizeText(text: string, org: OrgAnonymizationProfile): string {
  let result = text;

  const redactions: Array<[string, string]> = [];
  if (org.name) redactions.push([org.name, "[ORG]"]);
  if (org.dba) redactions.push([org.dba, "[ORG]"]);
  if (org.founder_name) redactions.push([org.founder_name, "[STAFF]"]);
  if (org.city) redactions.push([org.city, "[LOCATION]"]);
  if (org.state) redactions.push([org.state, "[LOCATION]"]);
  if (org.address_line1) redactions.push([org.address_line1, "[ADDRESS]"]);
  if (org.address_line2) redactions.push([org.address_line2, "[ADDRESS]"]);
  if (org.phone) redactions.push([org.phone, "[CONTACT]"]);
  if (org.email) redactions.push([org.email, "[CONTACT]"]);
  redactions.sort((a, b) => b[0].length - a[0].length);

  for (const [value, token] of redactions) {
    if (!value.trim()) continue;
    result = result.replace(new RegExp(escapeRegExp(value), "gi"), token);
  }

  result = result.replace(ORG_SUFFIX_PATTERN, "[ORG]");
  result = result.replace(EMAIL_PATTERN, "[CONTACT]");
  result = result.replace(PHONE_PATTERN, "[CONTACT]");
  result = result.replace(EIN_PATTERN, "[CONTACT]");
  result = result.replace(URL_PATTERN, "[URL]");
  result = result.replace(DOLLAR_PATTERN, (match) => {
    const numeric = Number(match.replace(/[^0-9.]/g, ""));
    return Number.isFinite(numeric) && numeric > DOLLAR_REDACTION_THRESHOLD
      ? "[BUDGET_RANGE]"
      : match;
  });

  return result;
}

/** Local, deterministic word-frequency count - the "by frequency" half of
 * task requirement 1c. Grant-specificity (the other half) is a judgment
 * call handed to Claude in the combined analysis prompt, which ranks/filters
 * these candidates rather than inventing its own counts. */
function extractKeywordCandidatesLocally(
  text: string,
  cap = MAX_KEYWORD_CANDIDATES,
): Array<{ word: string; count: number }> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const freq = new Map<string, number>();
  for (const word of words) {
    if (word.length < 5 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([word, count]) => ({ word, count }));
}

/** Task requirement 1b: { personnel_pct, programs_pct, admin_pct,
 * indirect_pct } from applications.budget_data. Format is not strictly
 * typed in the schema (jsonb "structured budget snapshot"); defensively
 * accepts either `lineItems` or `line_items`, matching grant_budgets'
 * documented shape ([{category, description, amount, justification}]).
 * Returns null when the field is empty or unusable rather than fabricating
 * a ratio. */
function computeBudgetRatio(budgetData: unknown): BudgetRatio | null {
  if (!budgetData || typeof budgetData !== "object") return null;
  const obj = budgetData as Record<string, unknown>;
  const rawItems = obj.lineItems ?? obj.line_items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) return null;

  let personnel = 0;
  let admin = 0;
  let indirect = 0;
  let programs = 0;

  for (const item of rawItems) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const category =
      typeof rec.category === "string" ? rec.category.toLowerCase() : "";
    const amount =
      typeof rec.amount === "number" ? rec.amount : Number(rec.amount) || 0;
    if (amount <= 0) continue;

    if (PERSONNEL_KEYWORDS.some((k) => category.includes(k))) {
      personnel += amount;
    } else if (INDIRECT_KEYWORDS.some((k) => category.includes(k))) {
      indirect += amount;
    } else if (ADMIN_KEYWORDS.some((k) => category.includes(k))) {
      admin += amount;
    } else {
      programs += amount;
    }
  }

  const total = personnel + admin + indirect + programs;
  if (total <= 0) return null;

  return {
    personnel: Number((personnel / total).toFixed(3)),
    programs: Number((programs / total).toFixed(3)),
    admin: Number((admin / total).toFixed(3)),
    indirect: Number((indirect / total).toFixed(3)),
  };
}

/** Task requirement 1d: { days_before_deadline, day_of_week, month }.
 * day_of_week/month are derived from submitted_at when available, falling
 * back to the outcome's own recorded_at (the award-recording date) when no
 * submission timestamp is on file - documented as a fallback, not treated
 * as equivalent. days_before_deadline requires both a submission date and a
 * deadline; either missing yields null rather than a fabricated value.
 * day_of_week uses UTC (0=Sunday..6=Saturday) since every timestamp in this
 * schema is stored as timestamptz/UTC. */
function computeTimingFacts(
  submittedAt: string | null,
  deadline: string | null,
  recordedAt: string,
): TimingFacts {
  const referenceDateSource = submittedAt ?? recordedAt;
  const referenceDate = new Date(referenceDateSource);
  const hasValidReference = !Number.isNaN(referenceDate.getTime());

  let daysBeforeDeadline: number | null = null;
  if (submittedAt && deadline) {
    const submitted = new Date(submittedAt).getTime();
    const due = new Date(deadline).getTime();
    if (!Number.isNaN(submitted) && !Number.isNaN(due)) {
      daysBeforeDeadline = Math.round((due - submitted) / (24 * 60 * 60 * 1000));
    }
  }

  return {
    daysBeforeDeadline,
    dayOfWeek: hasValidReference ? referenceDate.getUTCDay() : null,
    month: hasValidReference ? referenceDate.getUTCMonth() + 1 : null,
  };
}

function bucketTiming(daysBeforeDeadline: number): string {
  if (daysBeforeDeadline < 0) return "submitted_after_deadline";
  if (daysBeforeDeadline <= 1) return "submitted_final_day";
  if (daysBeforeDeadline <= 6) return "submitted_1_to_6_days_before_deadline";
  if (daysBeforeDeadline <= 14) return "submitted_7_to_14_days_before_deadline";
  if (daysBeforeDeadline <= 30) return "submitted_15_to_30_days_before_deadline";
  return "submitted_more_than_30_days_before_deadline";
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function describeTimingFacts(facts: TimingFacts): string {
  const parts: string[] = [];
  if (facts.daysBeforeDeadline !== null) {
    parts.push(bucketTiming(facts.daysBeforeDeadline));
  }
  if (facts.dayOfWeek !== null) parts.push(`submitted_on_${DAY_NAMES[facts.dayOfWeek]}`);
  if (facts.month !== null) parts.push(`submitted_in_month_${facts.month}`);
  return parts.length > 0 ? parts.join(", ") : "no_timing_data";
}

/** SHA-256 hash of raw (pre-anonymization) source content, hex-encoded.
 * Used both to make outcome processing idempotent across runs
 * (hasOutcomeAlreadyContributed) and to detect the same narrative text
 * reappearing under a different outcome_id (hasSourceHashContributed) -
 * task requirement 6's "hash of source content for dedup." Uses the
 * platform Web Crypto global (available in the Node 20+ runtime this app
 * targets) rather than pulling in Node's `crypto` module for one digest
 * call. */
async function hashContent(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** success_rate on platform_learning_patterns can't be a true award/denial
 * win rate here, because this agent only ever reads awarded outcomes (per
 * the task spec) - there is no denominator of denials to divide against.
 * Instead it is a confidence proxy that approaches 1.0 as more independent
 * awarded outcomes corroborate the same (pattern_type, funder_category,
 * ntee_code) pattern, capped at 1.0. A true win-rate pass would need to
 * also read denied outcomes, which is out of this agent's scope. */
function computeConfidenceProxy(sampleCount: number): number {
  return Number(
    Math.min(1, sampleCount / SUCCESS_RATE_CONFIDENCE_TARGET).toFixed(3),
  );
}

/** Task requirement 3's statistical confidence label. Below
 * CONFIDENCE_MIN_SAMPLE the pattern is 'low' confidence regardless of
 * anything else - success_rate is not even computed for it (see
 * upsertPattern). */
function computeConfidenceLabel(sampleCount: number): "low" | "medium" | "high" {
  if (sampleCount < CONFIDENCE_MIN_SAMPLE) return "low";
  if (sampleCount < CONFIDENCE_HIGH_SAMPLE) return "medium";
  return "high";
}

function describePatternContent(
  patternType: StoredPatternType,
  funderCategory: FunderCategory | null,
): string {
  const label = patternType.replace(/_/g, " ");
  const scope = funderCategory
    ? `${funderCategory.replace(/_/g, " ")} funders`
    : "all funder categories";
  return `Cross-org ${label} pattern observed in awarded applications to ${scope}.`;
}

/** Decision confidence scales with corroborating sample size. A
 * single-outcome pattern lands below
 * AUTONOMOUS_HARD_LIMITS.MIN_CONFIDENCE_TO_ACT (60) on purpose - logDecision
 * force-flags it for human review until enough independent orgs have
 * contributed to the same pattern, which is the correct behavior for a
 * cross-org claim built from one data point. */
function computeDecisionConfidence(sampleCount: number): number {
  return Math.min(95, 50 + sampleCount * 3);
}

/** Extracts the first balanced-looking JSON object from Claude's reply,
 * tolerating stray prose or code fences. Never throws - a malformed
 * response degrades to `null` rather than aborting the whole outcome, since
 * this agent processes a batch and one bad parse shouldn't cost the rest of
 * the candidates for that outcome (budget/timing/attachment candidates are
 * grounded locally and don't depend on this parse succeeding at all). */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/** Parses the single comprehensive per-outcome Claude response. Only the
 * three language/judgment fields (narrative_language, keyword,
 * funder_preference) are actually used from Claude's JSON - budget_structure,
 * timing, and attachment_combination are present in the prompt's contract
 * for completeness (task requirement 1 asks the prompt to cover all six
 * pattern types) but this file always persists its own deterministically
 * computed values for those three rather than whatever Claude returns; see
 * the file header's hardening note #1 for why. */
function parseOutcomeAnalysis(text: string): ParsedOutcomeAnalysis {
  const raw = extractJsonObject(text);
  if (!raw) return { narrativePhrases: [], keywords: [], funderPreference: null };

  const narrativePhrases = parseStringArray(raw.narrative_language)
    .filter((p) => {
      const words = wordCount(p);
      return words >= PHRASE_MIN_WORDS && words <= PHRASE_MAX_WORDS;
    })
    .slice(0, MAX_PHRASES);

  const keywords = parseStringArray(raw.keyword).slice(0, MAX_KEYWORDS);

  let funderPreference: FunderPreference | null = null;
  if (raw.funder_preference && typeof raw.funder_preference === "object") {
    const fp = raw.funder_preference as Record<string, unknown>;
    const preferred_org_sizes = parseStringArray(fp.preferred_org_sizes);
    const preferred_ntee_codes = parseStringArray(fp.preferred_ntee_codes);
    const impact_metrics = parseStringArray(fp.impact_metrics);
    if (
      preferred_org_sizes.length > 0 ||
      preferred_ntee_codes.length > 0 ||
      impact_metrics.length > 0
    ) {
      funderPreference = { preferred_org_sizes, preferred_ntee_codes, impact_metrics };
    }
  }

  return { narrativePhrases, keywords, funderPreference };
}

interface UniversalFinding {
  description: string;
  contributingNteeCodes: string[];
}

function parseUniversalFindings(text: string): UniversalFinding[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const findings: UniversalFinding[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const description = typeof rec.description === "string" ? rec.description.trim() : "";
    const contributingNteeCodes = parseStringArray(rec.contributing_ntee_codes);
    if (description && contributingNteeCodes.length >= CROSS_NTEE_MIN_DISTINCT_CODES) {
      findings.push({ description, contributingNteeCodes });
    }
  }
  return findings;
}

/** Task requirement 1: single system prompt covering all six pattern
 * types. Explicitly instructs Claude to copy the three grounded fields
 * through unchanged rather than recompute them, and to never attempt to
 * re-identify the organization behind an already-anonymized excerpt. */
function buildAnalysisSystemPrompt(): string {
  return [
    "You are Benavora's Learning Network Pattern Analyst. You read a single anonymized excerpt from a SUCCESSFULLY AWARDED grant application, plus several already-computed factual fields about that same submission, and extract cross-organization learning patterns other nonprofits can benefit from - without ever attempting to identify which specific organization the excerpt came from. The excerpt has already had organization names, staff names, locations, contact details, and large dollar amounts redacted; do not guess at or reconstruct what was redacted, and do not include anything in your response that still looks like it could identify a person, place, or specific organization even after redaction.",
    "",
    "Respond with ONLY a single JSON object, no prose, no markdown fences, in exactly this shape:",
    '{"narrative_language": ["<3-8 word phrase>", ...up to 5], "keyword": ["<word>", ...up to 10], "budget_structure": {"personnel_pct": <number>, "programs_pct": <number>, "admin_pct": <number>, "indirect_pct": <number>} | null, "timing": {"days_before_deadline": <number> | null, "day_of_week": <0-6> | null, "month": <1-12> | null}, "attachment_combination": ["<document category>", ...], "funder_preference": {"preferred_org_sizes": [...], "preferred_ntee_codes": [...], "impact_metrics": [...]} | null}',
    "",
    "FIELD RULES.",
    "narrative_language: identify up to 5 short phrases, each exactly 3 to 8 words, that represent strong, fundable grant-writing language - specific measurable outcomes, clear need statements, or concrete impact claims. Extract exact phrases from the excerpt, do not paraphrase or invent language that is not present.",
    "keyword: you will be given a list of candidate words with their real frequency counts in the excerpt. Select and rank up to 10 of those candidates that are genuinely grant-specific (program/outcome/methodology terms), not generic filler words - even if a generic word has a high count, exclude it. Never invent a keyword that is not in the candidate list.",
    "budget_structure, timing, attachment_combination: you will be given the real, already-computed ground-truth values for these three fields. Copy them through in your response exactly as given - do not recalculate, round differently, or alter them in any way. If a ground-truth value is given as null, return null for that field.",
    "funder_preference: you will be given whatever funder profile data is on file (name, category, description, geographic focus, notes) if any. Only report preferred_org_sizes / preferred_ntee_codes / impact_metrics you can genuinely infer from that profile text - if no funder profile was given, or nothing in it supports an inference, return null. Never fabricate a funder preference.",
  ].join("\n");
}

function buildAnalysisPrompt(args: {
  anonymizedNarrative: string | null;
  keywordCandidates: Array<{ word: string; count: number }>;
  knownKeywordTags: string[];
  budgetRatio: BudgetRatio | null;
  timingFacts: TimingFacts;
  attachmentCombination: string[];
  funderProfile: FunderProfile | null;
}): string {
  const {
    anonymizedNarrative,
    keywordCandidates,
    knownKeywordTags,
    budgetRatio,
    timingFacts,
    attachmentCombination,
    funderProfile,
  } = args;

  const lines: string[] = [];

  lines.push("## Anonymized narrative excerpt");
  lines.push(
    anonymizedNarrative
      ? anonymizedNarrative.slice(0, MAX_NARRATIVE_CHARS_FOR_CLAUDE)
      : "No narrative text is available for this outcome.",
  );
  lines.push("");

  lines.push("## Keyword candidates (word, real frequency count in excerpt)");
  lines.push(
    keywordCandidates.length > 0
      ? keywordCandidates.map((c) => `- ${c.word}: ${c.count}`).join("\n")
      : "No candidates - the excerpt was too short or unavailable.",
  );
  if (knownKeywordTags.length > 0) {
    lines.push(`Known keyword tags already recorded for this outcome: ${knownKeywordTags.join(", ")}`);
  }
  lines.push("");

  lines.push("## Ground-truth budget_structure (copy through exactly, do not recalculate)");
  lines.push(
    budgetRatio
      ? JSON.stringify({
          personnel_pct: Math.round(budgetRatio.personnel * 100),
          programs_pct: Math.round(budgetRatio.programs * 100),
          admin_pct: Math.round(budgetRatio.admin * 100),
          indirect_pct: Math.round(budgetRatio.indirect * 100),
        })
      : "null - no structured budget data on file.",
  );
  lines.push("");

  lines.push("## Ground-truth timing (copy through exactly, do not recalculate)");
  lines.push(
    JSON.stringify({
      days_before_deadline: timingFacts.daysBeforeDeadline,
      day_of_week: timingFacts.dayOfWeek,
      month: timingFacts.month,
    }),
  );
  lines.push("");

  lines.push("## Ground-truth attachment_combination (copy through exactly)");
  lines.push(
    attachmentCombination.length > 0
      ? JSON.stringify(attachmentCombination)
      : "[] - no documents attached to this application.",
  );
  lines.push("");

  lines.push("## Funder profile (for funder_preference inference only)");
  if (funderProfile) {
    const parts: string[] = [`Name: ${funderProfile.name}`];
    if (funderProfile.category) parts.push(`Category: ${funderProfile.category}`);
    if (funderProfile.description) parts.push(`Description: ${funderProfile.description}`);
    if (funderProfile.geographic_focus) parts.push(`Geographic focus: ${funderProfile.geographic_focus}`);
    if (funderProfile.annual_giving_budget != null) {
      parts.push(`Annual giving budget: $${funderProfile.annual_giving_budget}`);
    }
    if (funderProfile.notes) parts.push(`Notes: ${funderProfile.notes}`);
    lines.push(parts.join("\n"));
  } else {
    lines.push("No funder profile is on file for this opportunity.");
  }
  lines.push("");

  lines.push("Return ONLY the JSON object described in the system prompt.");

  return lines.join("\n");
}

function buildCrossNteeSystemPrompt(): string {
  return [
    "You are Benavora's Cross-Sector Learning Analyst. You are given a list of already-anonymized, already-confirmed grant-success patterns, each tagged with the NTEE (nonprofit sector) code it was observed under and how many independent awarded outcomes corroborate it. Your job is to identify which of these describe the SAME underlying successful practice even though they were observed in different nonprofit sectors - a 'universal' pattern that works regardless of sector, which is more valuable to surface platform-wide than a sector-specific one.",
    "",
    "Only report a finding when at least 2 of the given entries, from DIFFERENT ntee_code values, clearly describe the same underlying practice - not just a similar topic. Do not stretch a match. If nothing in the list qualifies, return an empty array.",
    "",
    'Respond with ONLY a JSON array, no prose, no markdown fences: [{"description": "<one sentence describing the shared universal practice>", "contributing_ntee_codes": ["<code>", "<code>", ...]}]',
  ].join("\n");
}

function buildCrossNteePrompt(
  patternType: StoredPatternType,
  rows: Array<{ ntee_code: string; pattern_content: string; sample_count: number }>,
): string {
  const lines = [
    `Pattern type: ${patternType}`,
    "",
    "Entries:",
    ...rows.map(
      (r) => `- ntee_code=${r.ntee_code}, sample_count=${r.sample_count}: ${r.pattern_content}`,
    ),
    "",
    "Identify any universal (cross-sector) patterns among these entries now.",
  ];
  return lines.join("\n");
}

export class LearningNetworkAggregatorAgent extends AutonomousAgent {
  constructor(supabase: SupabaseClient) {
    super(SYSTEM_ORG_ID, "ag-36-learning-network", supabase);
  }

  /** Idempotent. See file header for why a real organizations row is
   * required here rather than a bare sentinel id or null. */
  private async ensureSystemOrg(): Promise<void> {
    const { data: existing } = await this.supabase
      .from("organizations")
      .select("id")
      .eq("id", SYSTEM_ORG_ID)
      .maybeSingle();

    if (existing) return;

    const { error } = await this.supabase.from("organizations").insert({
      id: SYSTEM_ORG_ID,
      name: SYSTEM_ORG_NAME,
      onboarding_completed: true,
    });

    if (error && !/duplicate key/i.test(error.message ?? "")) {
      throw new Error(
        `Failed to provision system organization for platform-level agent runs: ${error.message}`,
      );
    }
  }

  /** Task requirement 3's literal "SELECT COUNT(*) ... WHERE pattern_type=?
   * AND funder_category=?" check. Used only to enrich a decision's
   * reasoning trail with how many platform_learning_patterns rows already
   * exist for this (pattern_type, funder_category) combination - the
   * per-row sample_count (handled inside upsertPattern) remains the actual
   * gate on whether success_rate is recomputed, since this COUNT is a count
   * of rows (effectively 0 or 1 while ntee_code is null), not corroborating
   * outcomes. */
  private async checkPatternConfidence(
    patternType: StoredPatternType,
    funderCategory: FunderCategory | null,
  ): Promise<number> {
    let query = this.supabase
      .from("platform_learning_patterns")
      .select("id", { count: "exact", head: true })
      .eq("pattern_type", patternType);
    query = funderCategory
      ? query.eq("funder_category", funderCategory)
      : query.is("funder_category", null);

    const { count } = await query;
    return count ?? 0;
  }

  /** Looks up an existing platform_learning_patterns row by
   * (pattern_type, funder_category, ntee_code) and either increments it or
   * inserts a new row. Both funder_category and ntee_code are nullable, so
   * null-safe `.is()` is used instead of `.eq()` wherever the value is
   * null. Statistical confidence gating (task requirement 3): success_rate
   * is only (re)computed once the row's sample_count reaches
   * CONFIDENCE_MIN_SAMPLE; below that it is left untouched (or null on
   * first insert) and `confidence` is 'low'. */
  private async upsertPattern(params: UpsertPatternParams): Promise<UpsertPatternResult> {
    let query = this.supabase
      .from("platform_learning_patterns")
      .select("id, sample_count, avg_award_amount, winning_examples, weight, pattern_content")
      .eq("pattern_type", params.patternType);

    query = params.funderCategory
      ? query.eq("funder_category", params.funderCategory)
      : query.is("funder_category", null);
    query = params.nteeCode
      ? query.eq("ntee_code", params.nteeCode)
      : query.is("ntee_code", null);

    const { data: existing, error: lookupError } = await query.maybeSingle();
    if (lookupError) {
      throw new Error(
        `Failed to look up platform_learning_patterns: ${lookupError.message}`,
      );
    }

    if (existing) {
      const existingSampleCount = (existing.sample_count as number) ?? 0;
      const existingAvgAward = (existing.avg_award_amount as number | null) ?? null;
      const existingWeight = (existing.weight as number | null) ?? 1.0;
      const existingExamples: unknown[] = Array.isArray(existing.winning_examples)
        ? (existing.winning_examples as unknown[])
        : [];

      const newSampleCount = params.sampleCountOverride ?? existingSampleCount + 1;
      const mergedExamples = [...existingExamples, ...params.excerpts].slice(
        -WINNING_EXAMPLES_CAP,
      );
      const newAvgAward =
        params.awardAmount != null
          ? Math.round(
              ((existingAvgAward ?? 0) * existingSampleCount + params.awardAmount) /
                newSampleCount,
            )
          : existingAvgAward;
      const confidence = computeConfidenceLabel(newSampleCount);
      const newWeight = params.weight != null ? Math.max(existingWeight, params.weight) : existingWeight;

      const patch: Record<string, unknown> = {
        sample_count: newSampleCount,
        avg_award_amount: newAvgAward,
        winning_examples: mergedExamples,
        confidence,
        weight: newWeight,
        last_updated: new Date().toISOString(),
      };
      // Task requirement 3: only recompute success_rate once sample_count
      // clears the confidence floor - a thin-evidence pattern keeps
      // whatever success_rate it already had rather than being churned on
      // every single new outcome.
      if (newSampleCount >= CONFIDENCE_MIN_SAMPLE) {
        patch.success_rate = computeConfidenceProxy(newSampleCount);
      }
      if (params.patternContentOverride) {
        patch.pattern_content = params.patternContentOverride;
      }

      const { error: updateError } = await this.supabase
        .from("platform_learning_patterns")
        .update(patch)
        .eq("id", existing.id as string);

      if (updateError) {
        throw new Error(
          `Failed to update platform_learning_patterns row ${existing.id}: ${updateError.message}`,
        );
      }

      return {
        id: existing.id as string,
        created: false,
        sampleCount: newSampleCount,
        confidence,
        patternContent: (params.patternContentOverride ?? existing.pattern_content) as string,
        weight: newWeight,
      };
    }

    const sampleCount = params.sampleCountOverride ?? 1;
    const confidence = computeConfidenceLabel(sampleCount);
    const patternContent =
      params.patternContentOverride ??
      describePatternContent(params.patternType, params.funderCategory);

    const { data: inserted, error: insertError } = await this.supabase
      .from("platform_learning_patterns")
      .insert({
        pattern_type: params.patternType,
        funder_category: params.funderCategory,
        ntee_code: params.nteeCode,
        pattern_content: patternContent,
        // Task requirement 3: never fabricate a success_rate on thin
        // evidence - only computed once the confidence floor is met, even
        // on first insert (relevant for cross-NTEE rows that can be
        // inserted with sampleCountOverride already >= the floor).
        success_rate: sampleCount >= CONFIDENCE_MIN_SAMPLE ? computeConfidenceProxy(sampleCount) : null,
        sample_count: sampleCount,
        avg_award_amount: params.awardAmount,
        winning_examples: params.excerpts.slice(-WINNING_EXAMPLES_CAP),
        confidence,
        weight: params.weight ?? 1.0,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      throw new Error(
        `Failed to insert platform_learning_patterns row: ${insertError?.message ?? "no row returned"}`,
      );
    }

    return {
      id: inserted.id as string,
      created: true,
      sampleCount,
      confidence,
      patternContent,
      weight: params.weight ?? 1.0,
    };
  }

  /** Per-org, anonymized-only audit trail of which outcome fed which
   * platform pattern. No raw narrative/keyword/budget content is stored
   * here - only ids, the pattern_type label, an explicit anonymized flag,
   * and a content hash for dedup (task requirement 6). */
  private async recordContribution(
    orgId: string,
    outcomeId: string,
    patternType: StoredPatternType,
    patternId: string,
    sourceHash: string | null,
  ): Promise<void> {
    const { error } = await this.supabase.from("org_learning_contributions").insert({
      org_id: orgId,
      outcome_id: outcomeId,
      contribution_type: patternType,
      pattern_id: patternId,
      anonymized: true,
      source_hash: sourceHash,
    });

    if (error) {
      throw new Error(
        `Failed to record org_learning_contributions for outcome ${outcomeId}: ${error.message}`,
      );
    }
  }

  /** Idempotency guard (hardening #6): if this outcome already has any
   * org_learning_contributions row, a prior run already processed it inside
   * the shared 90-day lookback window - skip it rather than double-counting
   * sample_count on every re-run. */
  private async hasOutcomeAlreadyContributed(outcomeId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from("org_learning_contributions")
      .select("id")
      .eq("outcome_id", outcomeId)
      .limit(1)
      .maybeSingle();
    return !!data;
  }

  /** Detects the exact same narrative text already contributed under a
   * *different* outcome_id (e.g. a cloned application). Used to skip only
   * the language-derived candidates (narrative_language, keyword) for the
   * duplicate - budget/timing/attachment/funder_preference still count as
   * new evidence since those genuinely can differ per submission. */
  private async hasSourceHashContributed(
    sourceHash: string,
    excludeOutcomeId: string,
  ): Promise<boolean> {
    const { data } = await this.supabase
      .from("org_learning_contributions")
      .select("id")
      .eq("source_hash", sourceHash)
      .neq("outcome_id", excludeOutcomeId)
      .limit(1)
      .maybeSingle();
    return !!data;
  }

  private async loadFunderProfile(opportunityId: string): Promise<FunderProfile | null> {
    const { data: opportunityRow } = await this.supabase
      .from("opportunities")
      .select("funder_id")
      .eq("id", opportunityId)
      .maybeSingle();

    const funderId = (opportunityRow as { funder_id: string | null } | null)?.funder_id;
    if (!funderId) return null;

    const { data: funderRow } = await this.supabase
      .from("funders")
      .select("id, name, category, description, geographic_focus, annual_giving_budget, notes")
      .eq("id", funderId)
      .maybeSingle();

    return (funderRow as FunderProfile | null) ?? null;
  }

  private async processOutcome(
    outcome: OutcomeRow,
    runId: string,
  ): Promise<ProcessOutcomeResult> {
    if (await this.hasOutcomeAlreadyContributed(outcome.id)) {
      return {
        created: 0,
        updated: 0,
        tokensUsed: 0,
        decisionIds: [],
        skippedAsDuplicate: true,
        touchedPatterns: [],
      };
    }

    const { data: applicationRow, error: applicationError } = await this.supabase
      .from("applications")
      .select("id, organization_id, opportunity_id, draft_content, submitted_at, budget_data")
      .eq("id", outcome.application_id)
      .maybeSingle();

    if (applicationError) {
      throw new Error(
        `Failed to load application ${outcome.application_id}: ${applicationError.message}`,
      );
    }
    if (!applicationRow) {
      throw new Error(
        `Application ${outcome.application_id} not found for outcome ${outcome.id}.`,
      );
    }
    const application = applicationRow as ApplicationRow;

    const { data: orgRow } = await this.supabase
      .from("organizations")
      .select(
        "name, dba, founder_name, city, state, address_line1, address_line2, phone, email",
      )
      .eq("id", application.organization_id)
      .maybeSingle();
    // Falls back to an all-null profile (no redaction possible) rather than
    // failing the whole outcome - an org row should always exist for a real
    // application, but this keeps the aggregator resilient to orphaned data.
    const orgProfile: OrgAnonymizationProfile =
      (orgRow as OrgAnonymizationProfile | null) ?? {
        name: null,
        dba: null,
        founder_name: null,
        city: null,
        state: null,
        address_line1: null,
        address_line2: null,
        phone: null,
        email: null,
      };

    let opportunityDeadline: string | null = null;
    let funderProfile: FunderProfile | null = null;
    if (application.opportunity_id) {
      const { data: opportunityRow } = await this.supabase
        .from("opportunities")
        .select("deadline")
        .eq("id", application.opportunity_id)
        .maybeSingle();
      opportunityDeadline = (opportunityRow?.deadline as string | null) ?? null;
      funderProfile = await this.loadFunderProfile(application.opportunity_id);
    }

    const attachmentCategories: string[] = [];
    const { data: appDocRows } = await this.supabase
      .from("application_documents")
      .select("document_id")
      .eq("application_id", application.id);
    const documentIds = (appDocRows ?? [])
      .map((row: { document_id: string }) => row.document_id)
      .filter(Boolean);
    if (documentIds.length > 0) {
      const { data: docRows } = await this.supabase
        .from("documents")
        .select("category")
        .in("id", documentIds);
      for (const doc of (docRows ?? []) as Array<{ category: string }>) {
        if (doc.category && !attachmentCategories.includes(doc.category)) {
          attachmentCategories.push(doc.category);
        }
      }
    }
    const attachmentCombination = [...attachmentCategories].sort();

    const funderCategory: FunderCategory | null =
      outcome.opportunity_category ?? outcome.funder_category ?? null;
    // No reliable path from opportunities -> funders -> foundation_directory
    // by EIN exists in the current schema (funders has no ein/ntee_code
    // column; foundation_directory's ntee_code is keyed off EIN alone).
    // Left null rather than guessing - see AGENTS_v2.md's repeated
    // "never fabricates a field it can't extract" convention. This is also
    // why runCrossNteeAnalysis() will realistically find nothing to work
    // with until a future session wires that lookup - see file header.
    const nteeCode: string | null = null;

    const narrativeSource = application.draft_content ?? outcome.narrative_snapshot ?? null;
    const sourceHash = narrativeSource ? await hashContent(narrativeSource.trim()) : null;
    const contentDuplicate =
      sourceHash !== null ? await this.hasSourceHashContributed(sourceHash, outcome.id) : false;

    const anonymizedNarrative = narrativeSource
      ? anonymizeText(narrativeSource, orgProfile)
      : null;
    const keywordCandidates = anonymizedNarrative
      ? extractKeywordCandidatesLocally(anonymizedNarrative)
      : [];

    const budgetRatio = computeBudgetRatio(application.budget_data);
    const timingFacts = computeTimingFacts(
      application.submitted_at,
      opportunityDeadline,
      outcome.recorded_at,
    );

    let tokensUsed = 0;
    let analysis: ParsedOutcomeAnalysis = {
      narrativePhrases: [],
      keywords: [],
      funderPreference: null,
    };
    if (anonymizedNarrative || funderProfile) {
      const response = await callClaude({
        system: buildAnalysisSystemPrompt(),
        prompt: buildAnalysisPrompt({
          anonymizedNarrative,
          keywordCandidates,
          knownKeywordTags: outcome.keywords_used ?? [],
          budgetRatio,
          timingFacts,
          attachmentCombination,
          funderProfile,
        }),
        maxTokens: 900,
        temperature: 0.2,
      });
      tokensUsed += response.usage.totalTokens;
      analysis = parseOutcomeAnalysis(response.text);
    }

    // Duplicate narrative content already contributed under a different
    // outcome - the language-derived candidates are already represented;
    // skip them but keep factual candidates (see file header hardening #6).
    if (contentDuplicate) {
      analysis = { ...analysis, narrativePhrases: [], keywords: [] };
    }

    const keywordsForCandidate =
      analysis.keywords.length > 0
        ? analysis.keywords
        : outcome.keywords_used && outcome.keywords_used.length > 0 && !contentDuplicate
          ? outcome.keywords_used.slice(0, MAX_KEYWORDS)
          : [];

    const candidates: PatternCandidate[] = [];

    if (analysis.narrativePhrases.length > 0) {
      candidates.push({
        patternType: "narrative_language",
        excerpts: analysis.narrativePhrases.map((p) => truncateExcerpt(p)),
      });
    }

    if (keywordsForCandidate.length > 0) {
      candidates.push({
        patternType: "keyword",
        excerpts: keywordsForCandidate.map((k) => truncateExcerpt(k)),
      });
    }

    if (budgetRatio) {
      candidates.push({
        patternType: "budget_structure",
        excerpts: [
          truncateExcerpt(
            `personnel ${Math.round(budgetRatio.personnel * 100)}% / ` +
              `programs ${Math.round(budgetRatio.programs * 100)}% / ` +
              `admin ${Math.round(budgetRatio.admin * 100)}% / ` +
              `indirect ${Math.round(budgetRatio.indirect * 100)}%`,
          ),
        ],
      });
    }

    if (timingFacts.daysBeforeDeadline !== null || timingFacts.dayOfWeek !== null) {
      candidates.push({
        patternType: "timing",
        excerpts: [truncateExcerpt(describeTimingFacts(timingFacts))],
      });
    }

    if (attachmentCombination.length > 0) {
      candidates.push({
        patternType: "attachment_type",
        excerpts: attachmentCombination.map((c) => truncateExcerpt(c)),
      });
    }

    if (analysis.funderPreference) {
      const fp = analysis.funderPreference;
      const summary = [
        fp.preferred_org_sizes.length > 0 ? `org sizes: ${fp.preferred_org_sizes.join("; ")}` : null,
        fp.preferred_ntee_codes.length > 0 ? `NTEE codes: ${fp.preferred_ntee_codes.join("; ")}` : null,
        fp.impact_metrics.length > 0 ? `impact metrics: ${fp.impact_metrics.join("; ")}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      if (summary) {
        candidates.push({ patternType: "funder_preference", excerpts: [truncateExcerpt(summary)] });
      }
    }

    let created = 0;
    let updated = 0;
    const decisionIds: string[] = [];
    const touchedPatterns: UpsertPatternResult[] = [];

    for (const candidate of candidates) {
      const existingRowCount = await this.checkPatternConfidence(
        candidate.patternType,
        funderCategory,
      );

      const result = await this.upsertPattern({
        patternType: candidate.patternType,
        funderCategory,
        nteeCode,
        excerpts: candidate.excerpts,
        awardAmount: outcome.awarded_amount,
      });
      touchedPatterns.push(result);

      if (result.created) created += 1;
      else updated += 1;

      const decisionId = await this.logDecision({
        decisionType: "learning_pattern_updated",
        agentRunId: runId,
        entityType: "platform_learning_pattern",
        entityId: result.id,
        reasoning:
          `Awarded outcome ${outcome.id} (${funderCategory ?? "uncategorized"}) contributed ` +
          `${candidate.excerpts.length} anonymized excerpt(s) to a ${candidate.patternType} ` +
          `pattern; sample_count is now ${result.sampleCount} (confidence: ${result.confidence}` +
          `${result.sampleCount < CONFIDENCE_MIN_SAMPLE ? " - below the sample-size floor, success_rate not recomputed" : ""}` +
          `). ${existingRowCount} platform_learning_patterns row(s) already existed for this ` +
          `(pattern_type, funder_category) combination before this update.` +
          (contentDuplicate
            ? " This outcome's narrative text was already represented by a prior contribution under a different outcome_id, so language-derived candidates were skipped for it."
            : ""),
        confidenceScore: computeDecisionConfidence(result.sampleCount),
        actionTaken: result.created
          ? `Created platform_learning_patterns row for ${candidate.patternType}.`
          : `Updated platform_learning_patterns row for ${candidate.patternType}.`,
        actionPayload: {
          patternType: candidate.patternType,
          funderCategory,
          sampleCount: result.sampleCount,
          confidence: result.confidence,
        },
        requiredHumanReview: false,
      });
      decisionIds.push(decisionId);

      await this.recordContribution(
        application.organization_id,
        outcome.id,
        candidate.patternType,
        result.id,
        sourceHash,
      );
    }

    return {
      created,
      updated,
      tokensUsed,
      decisionIds,
      skippedAsDuplicate: false,
      touchedPatterns,
    };
  }

  /** Task requirement 4: after per-NTEE analysis, run a second Claude pass
   * identifying patterns that succeed across multiple NTEE codes. Stored
   * with ntee_code=NULL, pattern_type='ntee_success' (the CHECK-constraint
   * value migration 083 reserved for exactly this), and an elevated
   * weight. See file header hardening #4 for why this will realistically
   * find nothing until NTEE resolution is wired into `funders` - the
   * mechanism is real and runs every invocation regardless. */
  private async runCrossNteeAnalysis(
    runId: string,
  ): Promise<{ universalPatternsCreated: number; tokensUsed: number; decisionIds: string[]; note: string }> {
    const { data, error } = await this.supabase
      .from("platform_learning_patterns")
      .select("pattern_type, ntee_code, funder_category, pattern_content, sample_count")
      .not("ntee_code", "is", null)
      .gte("sample_count", CONFIDENCE_MIN_SAMPLE);

    if (error) {
      return {
        universalPatternsCreated: 0,
        tokensUsed: 0,
        decisionIds: [],
        note: `Cross-NTEE analysis failed to query platform_learning_patterns: ${error.message}`,
      };
    }

    const rows = (data ?? []) as Array<{
      pattern_type: StoredPatternType;
      ntee_code: string;
      funder_category: FunderCategory | null;
      pattern_content: string;
      sample_count: number;
    }>;

    const byType = new Map<StoredPatternType, typeof rows>();
    for (const row of rows) {
      const bucket = byType.get(row.pattern_type) ?? [];
      bucket.push(row);
      byType.set(row.pattern_type, bucket);
    }

    let universalPatternsCreated = 0;
    let tokensUsed = 0;
    const decisionIds: string[] = [];
    let qualifyingGroups = 0;

    for (const [patternType, groupRows] of byType) {
      const distinctNteeCodes = new Set(groupRows.map((r) => r.ntee_code));
      if (distinctNteeCodes.size < CROSS_NTEE_MIN_DISTINCT_CODES) continue;
      qualifyingGroups += 1;

      const response = await callClaude({
        system: buildCrossNteeSystemPrompt(),
        prompt: buildCrossNteePrompt(patternType, groupRows),
        maxTokens: 700,
        temperature: 0.2,
      });
      tokensUsed += response.usage.totalTokens;

      const findings = parseUniversalFindings(response.text);
      for (const finding of findings) {
        const contributingRows = groupRows.filter((r) =>
          finding.contributingNteeCodes.includes(r.ntee_code),
        );
        if (contributingRows.length < CROSS_NTEE_MIN_DISTINCT_CODES) continue;

        const totalSampleCount = contributingRows.reduce((sum, r) => sum + r.sample_count, 0);
        const patternContent = `Cross-NTEE universal ${patternType} pattern (spans ${contributingRows.length} sectors): ${finding.description}`;

        const result = await this.upsertPattern({
          patternType: "ntee_success",
          funderCategory: null,
          nteeCode: null,
          excerpts: [truncateExcerpt(finding.description)],
          awardAmount: null,
          weight: UNIVERSAL_PATTERN_WEIGHT,
          sampleCountOverride: totalSampleCount,
          patternContentOverride: truncateExcerpt(patternContent, PATTERN_CONTENT_MAX_LENGTH),
        });

        if (result.created) universalPatternsCreated += 1;

        const decisionId = await this.logDecision({
          decisionType: "cross_ntee_pattern_identified",
          agentRunId: runId,
          entityType: "platform_learning_pattern",
          entityId: result.id,
          reasoning:
            `Cross-NTEE analysis of ${patternType} patterns found this practice corroborated ` +
            `across ${contributingRows.length} distinct NTEE codes (${finding.contributingNteeCodes.join(", ")}) ` +
            `with a combined sample_count of ${totalSampleCount}: ${finding.description}`,
          confidenceScore: computeDecisionConfidence(totalSampleCount),
          actionTaken: result.created
            ? "Created a new universal (cross-NTEE) platform_learning_patterns row."
            : "Updated an existing universal (cross-NTEE) platform_learning_patterns row.",
          actionPayload: {
            patternType,
            contributingNteeCodes: finding.contributingNteeCodes,
            totalSampleCount,
          },
          requiredHumanReview: false,
        });
        decisionIds.push(decisionId);
      }
    }

    const note =
      qualifyingGroups > 0
        ? `Cross-NTEE analysis examined ${qualifyingGroups} pattern_type group(s) with >= ${CROSS_NTEE_MIN_DISTINCT_CODES} distinct NTEE codes on file.`
        : `Cross-NTEE analysis skipped - no pattern_type currently has >= ${CROSS_NTEE_MIN_DISTINCT_CODES} distinct NTEE-coded pattern rows with sample_count >= ${CONFIDENCE_MIN_SAMPLE} (ntee_code is not yet populated by any live data source; see this file's header comment).`;

    return { universalPatternsCreated, tokensUsed, decisionIds, note };
  }

  /** Task requirement 7: after aggregation, generate a summary and notify
   * every platform owner. This schema has no dedicated platform-wide
   * notifications table (see autonomous-base.ts's own header note), so
   * this mirrors self-improvement-agent.ts's notifyPlatformOwners() - one
   * `alerts` row per organization that has a role='owner' profile,
   * deduplicated per run via `dedup_key`. */
  private async generateWeeklyDigest(args: {
    runId: string;
    patternsCreated: number;
    patternsUpdated: number;
    universalPatternsCreated: number;
    touchedPatterns: UpsertPatternResult[];
  }): Promise<{ decisionId: string; message: string; ownersNotified: number }> {
    const { runId, patternsCreated, patternsUpdated, universalPatternsCreated, touchedPatterns } = args;

    const topPattern = [...touchedPatterns].sort(
      (a, b) => b.sampleCount * b.weight - a.sampleCount * a.weight,
    )[0];

    const message =
      `This week: ${patternsUpdated} pattern(s) updated, ${patternsCreated} new pattern(s) discovered, ` +
      `top performing pattern: ${topPattern ? topPattern.patternContent : "none this run"}.` +
      (universalPatternsCreated > 0
        ? ` ${universalPatternsCreated} new cross-NTEE universal pattern(s) also identified.`
        : "");

    let ownersNotified = 0;
    try {
      const { data: owners, error } = await this.supabase
        .from("profiles")
        .select("organization_id")
        .eq("role", "owner");

      if (!error && owners) {
        const orgIds = new Set(
          (owners as Array<{ organization_id: string }>).map((row) => row.organization_id),
        );
        if (orgIds.size > 0) {
          const alertRows = Array.from(orgIds).map((orgId) => ({
            organization_id: orgId,
            type: "system",
            severity: "info",
            message,
            link: "/intelligence/learning-network",
            dedup_key: `learning-network-digest:${runId}`,
          }));
          const { error: upsertError } = await this.supabase
            .from("alerts")
            .upsert(alertRows, { onConflict: "organization_id,dedup_key" });
          if (!upsertError) ownersNotified = orgIds.size;
        }
      }
    } catch {
      // Best-effort: a notification failure must not fail a run that
      // already successfully aggregated and persisted patterns.
    }

    const decisionId = await this.logDecision({
      decisionType: "weekly_digest_generated",
      agentRunId: runId,
      entityType: "platform_learning_pattern",
      entityId: topPattern?.id,
      reasoning: message,
      confidenceScore: 80,
      actionTaken: `Notified ${ownersNotified} platform owner org(s) with the weekly learning network digest.`,
      actionPayload: {
        patternsCreated,
        patternsUpdated,
        universalPatternsCreated,
        ownersNotified,
      },
      requiredHumanReview: false,
    });

    return { decisionId, message, ownersNotified };
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    await this.ensureSystemOrg();

    const runId = await this.startRun(triggerSource, {
      lookbackDays: LOOKBACK_DAYS,
      maxOutcomesPerRun: MAX_OUTCOMES_PER_RUN,
    });

    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;
    let outcomesAnalyzed = 0;
    let skippedAsDuplicate = 0;
    let patternsCreated = 0;
    let patternsUpdated = 0;
    const touchedPatterns: UpsertPatternResult[] = [];

    try {
      const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

      // Deliberately no .eq("organization_id", ...) - this is the one
      // AutonomousAgent subclass in this codebase meant to read across
      // every org's outcomes in a single pass.
      const { data: outcomeRows, error: outcomesError } = await this.supabase
        .from("outcomes")
        .select(
          "id, organization_id, application_id, result, awarded_amount, requested_amount, funder_category, opportunity_category, keywords_used, recorded_at, narrative_snapshot",
        )
        .eq("result", "awarded")
        .gte("recorded_at", cutoff)
        .order("recorded_at", { ascending: false })
        .limit(MAX_OUTCOMES_PER_RUN);

      if (outcomesError) {
        throw new Error(`Failed to load outcomes: ${outcomesError.message}`);
      }

      const outcomes = (outcomeRows ?? []) as OutcomeRow[];

      for (const outcome of outcomes) {
        try {
          const result = await this.processOutcome(outcome, runId);
          if (result.skippedAsDuplicate) {
            skippedAsDuplicate += 1;
            continue;
          }
          outcomesAnalyzed += 1;
          patternsCreated += result.created;
          patternsUpdated += result.updated;
          tokensUsed += result.tokensUsed;
          decisions.push(...result.decisionIds);
          touchedPatterns.push(...result.touchedPatterns);
        } catch (perOutcomeErr) {
          const message =
            perOutcomeErr instanceof Error
              ? perOutcomeErr.message
              : "Unknown error while processing outcome.";
          errors.push(`outcome ${outcome.id}: ${message}`);
        }
      }

      // Cross-NTEE analysis and the weekly digest run every invocation
      // regardless of how many *new* outcomes were found this run, since
      // both operate on the accumulated platform_learning_patterns table
      // rather than this run's own outcome batch.
      let universalPatternsCreated = 0;
      let crossNteeNote = "";
      try {
        const crossNtee = await this.runCrossNteeAnalysis(runId);
        universalPatternsCreated = crossNtee.universalPatternsCreated;
        crossNteeNote = crossNtee.note;
        tokensUsed += crossNtee.tokensUsed;
        decisions.push(...crossNtee.decisionIds);
      } catch (crossNteeErr) {
        const message =
          crossNteeErr instanceof Error ? crossNteeErr.message : "Cross-NTEE analysis failed.";
        errors.push(message);
      }

      let digestMessage = "";
      try {
        const digest = await this.generateWeeklyDigest({
          runId,
          patternsCreated,
          patternsUpdated,
          universalPatternsCreated,
          touchedPatterns,
        });
        digestMessage = digest.message;
        decisions.push(digest.decisionId);
      } catch (digestErr) {
        const message = digestErr instanceof Error ? digestErr.message : "Weekly digest failed.";
        errors.push(message);
      }

      const summary =
        `Analyzed ${outcomesAnalyzed} of ${outcomes.length} awarded outcome(s) from the last ` +
        `${LOOKBACK_DAYS} days (${skippedAsDuplicate} already contributed in a prior run, skipped); ` +
        `created ${patternsCreated} new platform_learning_patterns row(s) and updated ` +
        `${patternsUpdated} existing row(s); ${universalPatternsCreated} cross-NTEE universal ` +
        `pattern(s) identified. ${crossNteeNote} ${digestMessage}`.trim();

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: outcomes.length,
        itemsProcessed: outcomesAnalyzed,
        itemsQueued: 0,
        tokensUsed,
        outputPayload: {
          skippedAsDuplicate,
          patternsCreated,
          patternsUpdated,
          universalPatternsCreated,
          errors,
        },
      });

      return {
        success: true,
        itemsFound: outcomes.length,
        itemsProcessed: outcomesAnalyzed,
        itemsQueued: 0,
        decisions,
        nextActions:
          patternsCreated + patternsUpdated + universalPatternsCreated > 0
            ? ["Review updated cross-org patterns via the Knowledge Engine (/intelligence/learning-network)."]
            : [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Learning network aggregation run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: outcomesAnalyzed,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
