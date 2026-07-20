// AG-39 ROI Optimizer Agent (AutonomousAgent, migration 089:
// submission_variables + roi_insights). Phase 5 per
// AUTONOMOUS_PLATFORM_VISION.md §7 ("ROI Optimization Engine").
//
// Two responsibilities, deliberately not both wrapped the same way:
//   - trackSubmissionVariables() is a per-submission telemetry write, called
//     synchronously off the stage-transition flow (see
//     src/app/api/autonomous/track-submission/route.ts). It does not open an
//     agent_runs row or log an agent_decisions row - recording a submission's
//     variables isn't itself an autonomous "decision" any more than AG-03
//     (Deadline Extraction, BaseAgent pattern) logs one for inserting a
//     deadline row. It intentionally never throws on a Claude failure for the
//     readability sub-score - a missing score just leaves that one column
//     null rather than losing the rest of the row's data.
//   - run() is the monthly correlation pass: it DOES open an agent_runs row
//     and logs one agent_decisions row per significant pattern it persists to
//     roi_insights, since surfacing "this variable correlates with award
//     rate" is the actual autonomous judgment call this agent makes.
//
// ENTERPRISE HARDENING (this session) - deviations from the task-given spec,
// following this project's established practice of checking real schema/code
// state before applying a literal spec verbatim (see
// opportunity-discovery-agent.ts's header for a prior instance of this same
// pattern):
//   - `platform_patterns_applied` (task spec item 1) has no column on
//     submission_variables (migration 089's actual columns: id,
//     application_id, org_id, submission_day_of_week, days_before_deadline,
//     prompt_version, word_count, attachment_count, has_budget,
//     has_logic_model, has_board_list, narrative_readability_score,
//     executive_contact_name, outcome_result, outcome_amount, created_at - no
//     jsonb column either). It IS read here (applications.platform_patterns_
//     applied, migration 084) so nothing is silently skipped, but it is not
//     sent in the submission_variables insert payload - Postgrest throws on
//     an insert with a column the table doesn't have. Persisting it requires
//     a schema migration, out of scope for a single-file agent rewrite.
//   - `has_logic_model` / `has_board_list` (columns DO exist, but the task's
//     "SELECT EXISTS(... document_type='logic_model')" has no backing
//     column - `documents` has no document_type field, only `category`
//     (document_category enum: tax_documents/legal_documents/
//     financial_documents/program_documents/marketing_materials/
//     letters_of_support/application_attachments/photos - migration 001).
//     None of those values map to "logic model" or "board list" specifically.
//     Detection here instead keyword-matches `documents.file_name` /
//     `.description`, the only queryable free-text signal in the live
//     schema - see LOGIC_MODEL_KEYWORDS / BOARD_LIST_KEYWORDS below.
//   - The correlation engine (task item 2) is fully deterministic arithmetic
//     against submission_variables + outcomes, not a Claude prompt asking an
//     LLM to eyeball correlations from a JSON blob (the prior version of this
//     file did the latter). A two-proportion z-test converted to a 0-1
//     confidence value backs every persisted insight's `confidence` column,
//     satisfying task item 3's "confidence >= 0.65 (correlation strength, not
//     just sample size)" requirement precisely - sample size alone no longer
//     drives confidence.
//   - getSubmissionRecommendations() takes `(orgId, supabase)`, not the
//     task's literal `(orgId: string)`. Every other plain function in this
//     codebase that reads org-scoped data (generateDraft() in
//     src/lib/drafts/generator.ts, checkEntityReputation(), etc.) receives
//     its Supabase client as a parameter instead of constructing one
//     internally - this follows that existing convention.
//
// Per-org scope: like every other AutonomousAgent (see
// outcome-analyzer-agent.ts), this class operates on `this.orgId` only - the
// task's "for each org with >= 10 records" framing maps to how a future
// worker/autonomous-orchestrator.ts registration would loop over active orgs
// and instantiate one agent per org, not to a multi-org loop inside this
// class. Wiring that orchestrator registration is out of scope here (AG-39 is
// still PLANNED per AGENTS_v2.md - it explicitly depends on AutoApply Full
// Autonomous Mode shipping first for there to be enough submission volume to
// correlate against).

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude } from "@/lib/ai/claude";
import type { Enums } from "@/types/database";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";
type OutcomeResult = Enums<"outcome_result">;

const MIN_RECORDS_FOR_ANALYSIS = 10;
/** Minimum rows per bucket before a bucket is even eligible to be compared
 * (task item 2: "n >= 8 per bucket before reporting insight"). */
const MIN_SAMPLE_SIZE = 8;
/** Minimum two-proportion-z-test-derived confidence (task item 3). */
const MIN_CONFIDENCE = 0.65;
/** Minimum win-rate spread between the best and worst bucket, in raw
 * proportion terms (0.10 = 10 percentage points, task item 3). */
const MIN_DIFF_PROPORTION = 0.1;
const MAX_NARRATIVE_CHARS_FOR_READABILITY = 6000;
/** getSubmissionRecommendations() returns at most this many instructions. */
const TOP_RECOMMENDATIONS_COUNT = 3;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Mirrors the buckets /api/reports/roi/route.ts already charts, so an
 * agent-generated insight's word-count range lines up with what the
 * /reports/roi dashboard shows for the same data. */
const WORD_COUNT_BUCKETS: Array<{ min: number; max: number | null; label: string }> = [
  { min: 0, max: 500, label: "0-500" },
  { min: 500, max: 1000, label: "500-1000" },
  { min: 1000, max: 1500, label: "1000-1500" },
  { min: 1500, max: 2000, label: "1500-2000" },
  { min: 2000, max: 2500, label: "2000-2500" },
  { min: 2500, max: null, label: "2500+" },
];

/** Task item 2's exact bucket boundaries: 0-3, 4-7, 8-14, 15-30, 30+ days. */
const DEADLINE_BUCKETS: Array<{ min: number; max: number | null; label: string }> = [
  { min: 0, max: 4, label: "0-3 days" },
  { min: 4, max: 8, label: "4-7 days" },
  { min: 8, max: 15, label: "8-14 days" },
  { min: 15, max: 31, label: "15-30 days" },
  { min: 31, max: null, label: "30+ days" },
];

const LOGIC_MODEL_KEYWORDS = ["logic model", "logic-model", "theory of change"];
const BOARD_LIST_KEYWORDS = [
  "board list",
  "board roster",
  "board of directors",
  "board members",
];

interface ApplicationForTracking {
  id: string;
  organization_id: string;
  opportunity_id: string | null;
  draft_content: string | null;
  budget_data: Record<string, unknown> | null;
  submitted_at: string | null;
  draft_source: string | null;
  platform_patterns_applied: number | null;
}

interface DocumentTextRow {
  file_name: string;
  description: string | null;
}

interface SubmissionVariableRow {
  application_id: string;
  submission_day_of_week: number | null;
  days_before_deadline: number | null;
  word_count: number | null;
  has_budget: boolean | null;
  has_logic_model: boolean | null;
  has_board_list: boolean | null;
}

interface OutcomeRow {
  application_id: string;
  result: OutcomeResult;
}

/** One decided (has an outcome) submission_variables record, joined to its
 * outcome. Input shape for every deterministic analyze* function below. */
interface DecidedRecord {
  submission_day_of_week: number | null;
  days_before_deadline: number | null;
  word_count: number | null;
  has_budget: boolean | null;
  has_logic_model: boolean | null;
  has_board_list: boolean | null;
  outcome_result: OutcomeResult;
}

interface RoiPattern {
  /** Deterministic, machine-parseable - see the header note above and
   * isDeterministicViolation() below, which parses this exact format to
   * decide whether a new submission violates a previously-recorded insight. */
  insight_type: string;
  insight_description: string;
  winning_pattern: string;
  losing_pattern: string;
  sample_size: number;
  confidence: number;
  recommended_action: string;
}

interface RoiInsightRow {
  insight_type: string;
  recommended_action: string | null;
}

function hasMeaningfulContent(value: Record<string, unknown> | null): boolean {
  return !!value && typeof value === "object" && Object.keys(value).length > 0;
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function bucketRangeLabel(min: number, max: number | null): string {
  return `${min}-${max === null ? "Infinity" : max}`;
}

/**
 * Abramowitz-Stegun approximation of the error function (max error ~1.5e-7).
 * No stats dependency exists in this codebase (confirmed - only
 * src/lib/autoapply/ab-testing.ts has a comparable zScore() helper, which
 * stops at a fixed z > 1.96 threshold rather than a continuous confidence
 * value); this is the smallest self-contained way to turn a z-score into a
 * 0-1 confidence number.
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

/**
 * Two-proportion z-test converted to a 0-1 confidence value via the normal
 * CDF: erf(|z| / sqrt(2)) is the probability the observed gap between two
 * win rates reflects a real difference rather than sampling noise. This is
 * what makes "confidence >= 0.65" (task item 3) mean something distinct from
 * "sample_size >= 8" - a wide gap on a tiny or noisy sample still returns a
 * low confidence here even though sample_size alone might clear the bar.
 */
function twoProportionConfidence(n1: number, s1: number, n2: number, s2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const p1 = s1 / n1;
  const p2 = s2 / n2;
  const pPooled = (s1 + s2) / (n1 + n2);
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  const z = Math.abs((p1 - p2) / se);
  return Math.max(0, Math.min(1, erf(z / Math.SQRT2)));
}

/** Linear-interpolation percentile over an already-sorted ascending array. */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = (sortedValues.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedValues[lower]!;
  const weight = idx - lower;
  return sortedValues[lower]! * (1 - weight) + sortedValues[upper]! * weight;
}

/**
 * Win rate by submission_day_of_week. Reports the single best vs single
 * worst day (each with sample_size >= MIN_SAMPLE_SIZE) when their spread
 * clears MIN_DIFF_PROPORTION and the z-test confidence clears MIN_CONFIDENCE.
 */
function analyzeDayOfWeek(decided: DecidedRecord[]): RoiPattern | null {
  const buckets = DAY_NAMES.map((label, day) => {
    const rows = decided.filter((r) => r.submission_day_of_week === day);
    const awarded = rows.filter((r) => r.outcome_result === "awarded").length;
    return {
      day,
      label,
      sampleSize: rows.length,
      awarded,
      winRate: rows.length > 0 ? awarded / rows.length : null,
    };
  }).filter((b) => b.sampleSize >= MIN_SAMPLE_SIZE && b.winRate !== null);

  if (buckets.length < 2) return null;

  const sorted = [...buckets].sort((a, b) => b.winRate! - a.winRate!);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  if (best.day === worst.day) return null;

  const diff = best.winRate! - worst.winRate!;
  if (diff < MIN_DIFF_PROPORTION) return null;

  const confidence = twoProportionConfidence(best.sampleSize, best.awarded, worst.sampleSize, worst.awarded);
  if (confidence < MIN_CONFIDENCE) return null;

  return {
    insight_type: `day_of_week:${worst.day}`,
    insight_description:
      `${best.label} submissions win ${pct(best.winRate!)} of the time (n=${best.sampleSize}) versus ` +
      `${pct(worst.winRate!)} on ${worst.label} (n=${worst.sampleSize}) - a ${pct(diff)} spread.`,
    winning_pattern: `${best.label} submissions: ${pct(best.winRate!)} win rate (n=${best.sampleSize}).`,
    losing_pattern: `${worst.label} submissions: ${pct(worst.winRate!)} win rate (n=${worst.sampleSize}).`,
    sample_size: Math.min(best.sampleSize, worst.sampleSize),
    confidence,
    recommended_action:
      `Submit applications on ${best.label}s instead of ${worst.label}s - ${pct(diff)} higher win rate ` +
      `vs ${worst.label} submissions (${best.label} n=${best.sampleSize}, ${worst.label} n=${worst.sampleSize}).`,
  };
}

/**
 * Win rate by word_count bucket, plus the interquartile range of awarded
 * drafts' word counts as the "winning range" descriptive detail (task item
 * 2's literal "find quartile of word_count for awarded vs denied" ask) layered
 * on top of the bucket-based significance test that actually gates whether
 * this becomes a persisted insight.
 */
function analyzeWordCount(decided: DecidedRecord[]): RoiPattern | null {
  const buckets = WORD_COUNT_BUCKETS.map((bucket) => {
    const rows = decided.filter(
      (r) =>
        r.word_count !== null &&
        r.word_count >= bucket.min &&
        (bucket.max === null || r.word_count < bucket.max),
    );
    const awarded = rows.filter((r) => r.outcome_result === "awarded").length;
    return {
      ...bucket,
      sampleSize: rows.length,
      awarded,
      winRate: rows.length > 0 ? awarded / rows.length : null,
    };
  }).filter((b) => b.sampleSize >= MIN_SAMPLE_SIZE && b.winRate !== null);

  if (buckets.length < 2) return null;

  const sorted = [...buckets].sort((a, b) => b.winRate! - a.winRate!);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  if (best.label === worst.label) return null;

  const diff = best.winRate! - worst.winRate!;
  if (diff < MIN_DIFF_PROPORTION) return null;

  const confidence = twoProportionConfidence(best.sampleSize, best.awarded, worst.sampleSize, worst.awarded);
  if (confidence < MIN_CONFIDENCE) return null;

  const awardedWordCounts = decided
    .filter((r) => r.outcome_result === "awarded" && r.word_count !== null)
    .map((r) => r.word_count as number)
    .sort((a, b) => a - b);
  let quartileNote = "";
  if (awardedWordCounts.length >= MIN_SAMPLE_SIZE) {
    const q1 = Math.round(percentile(awardedWordCounts, 0.25));
    const q3 = Math.round(percentile(awardedWordCounts, 0.75));
    quartileNote = ` The middle 50% of awarded drafts fall between ${q1}-${q3} words.`;
  }

  return {
    insight_type: `word_count:${bucketRangeLabel(worst.min, worst.max)}`,
    insight_description:
      `Drafts of ${best.label} words win ${pct(best.winRate!)} of the time (n=${best.sampleSize}) versus ` +
      `${pct(worst.winRate!)} for ${worst.label} words (n=${worst.sampleSize}).${quartileNote}`,
    winning_pattern: `${best.label} words - the winning range: ${pct(best.winRate!)} win rate (n=${best.sampleSize}).`,
    losing_pattern: `${worst.label} words: ${pct(worst.winRate!)} win rate (n=${worst.sampleSize}).`,
    sample_size: Math.min(best.sampleSize, worst.sampleSize),
    confidence,
    recommended_action:
      `Target a draft length of ${best.label} words - ${pct(diff)} higher win rate than ${worst.label} words ` +
      `(n=${best.sampleSize} vs n=${worst.sampleSize}).`,
  };
}

/**
 * With-vs-without win rate for one boolean attachment flag
 * (has_budget / has_logic_model / has_board_list).
 */
function analyzeAttachmentFlag(
  decided: DecidedRecord[],
  flagKey: "has_budget" | "has_logic_model" | "has_board_list",
  flagLabel: string,
): RoiPattern | null {
  const withRows = decided.filter((r) => r[flagKey] === true);
  const withoutRows = decided.filter((r) => r[flagKey] === false);
  if (withRows.length < MIN_SAMPLE_SIZE || withoutRows.length < MIN_SAMPLE_SIZE) return null;

  const withAwarded = withRows.filter((r) => r.outcome_result === "awarded").length;
  const withoutAwarded = withoutRows.filter((r) => r.outcome_result === "awarded").length;
  const withRate = withAwarded / withRows.length;
  const withoutRate = withoutAwarded / withoutRows.length;
  const diff = withRate - withoutRate;
  if (Math.abs(diff) < MIN_DIFF_PROPORTION) return null;

  const confidence = twoProportionConfidence(withRows.length, withAwarded, withoutRows.length, withoutAwarded);
  if (confidence < MIN_CONFIDENCE) return null;

  const havingItWins = diff > 0;
  const totalSample = withRows.length + withoutRows.length;

  return {
    insight_type: `attachment:${flagKey}:${havingItWins ? "missing" : "present"}`,
    insight_description:
      `Applications WITH ${flagLabel} win ${pct(withRate)} of the time (n=${withRows.length}) versus ` +
      `${pct(withoutRate)} WITHOUT it (n=${withoutRows.length}).`,
    winning_pattern: havingItWins
      ? `WITH ${flagLabel}: ${pct(withRate)} win rate (n=${withRows.length}).`
      : `WITHOUT ${flagLabel}: ${pct(withoutRate)} win rate (n=${withoutRows.length}).`,
    losing_pattern: havingItWins
      ? `WITHOUT ${flagLabel}: ${pct(withoutRate)} win rate (n=${withoutRows.length}).`
      : `WITH ${flagLabel}: ${pct(withRate)} win rate (n=${withRows.length}).`,
    sample_size: Math.min(withRows.length, withoutRows.length),
    confidence,
    recommended_action: havingItWins
      ? `Include ${flagLabel} - wins ${pct(withRate)} WITH vs ${pct(withoutRate)} WITHOUT (n=${totalSample}).`
      : `Omitting ${flagLabel} correlates with a higher win rate (${pct(withoutRate)} WITHOUT vs ` +
        `${pct(withRate)} WITH, n=${totalSample}) - review whether this reflects a confound before acting on it.`,
  };
}

/** Win rate by days_before_deadline bucket (task item 2's 0-3/4-7/8-14/15-30/30+ buckets). */
function analyzeDaysBeforeDeadline(decided: DecidedRecord[]): RoiPattern | null {
  const buckets = DEADLINE_BUCKETS.map((bucket) => {
    const rows = decided.filter(
      (r) =>
        r.days_before_deadline !== null &&
        r.days_before_deadline >= bucket.min &&
        (bucket.max === null || r.days_before_deadline < bucket.max),
    );
    const awarded = rows.filter((r) => r.outcome_result === "awarded").length;
    return {
      ...bucket,
      sampleSize: rows.length,
      awarded,
      winRate: rows.length > 0 ? awarded / rows.length : null,
    };
  }).filter((b) => b.sampleSize >= MIN_SAMPLE_SIZE && b.winRate !== null);

  if (buckets.length < 2) return null;

  const sorted = [...buckets].sort((a, b) => b.winRate! - a.winRate!);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  if (best.label === worst.label) return null;

  const diff = best.winRate! - worst.winRate!;
  if (diff < MIN_DIFF_PROPORTION) return null;

  const confidence = twoProportionConfidence(best.sampleSize, best.awarded, worst.sampleSize, worst.awarded);
  if (confidence < MIN_CONFIDENCE) return null;

  return {
    insight_type: `days_before_deadline:${bucketRangeLabel(worst.min, worst.max)}`,
    insight_description:
      `Submitting ${best.label} before the deadline wins ${pct(best.winRate!)} of the time (n=${best.sampleSize}) ` +
      `versus ${pct(worst.winRate!)} when submitted ${worst.label} out (n=${worst.sampleSize}).`,
    winning_pattern: `${best.label} before deadline: ${pct(best.winRate!)} win rate (n=${best.sampleSize}).`,
    losing_pattern: `${worst.label} before deadline: ${pct(worst.winRate!)} win rate (n=${worst.sampleSize}).`,
    sample_size: Math.min(best.sampleSize, worst.sampleSize),
    confidence,
    recommended_action:
      `Submit ${best.label} before the deadline rather than ${worst.label} out - ${pct(diff)} higher win rate ` +
      `(n=${best.sampleSize} vs n=${worst.sampleSize}).`,
  };
}

/**
 * Parses a persisted roi_insights.insight_type (see the RoiPattern.insight_type
 * doc comment for the format each analyze* function writes) and decides
 * whether the current in-flight submission matches the losing side of that
 * insight. Used by RoiOptimizerAgent.checkForViolations() below.
 */
function isDeterministicViolation(
  insightType: string,
  current: {
    submissionDayOfWeek: number;
    wordCount: number;
    daysBeforeDeadline: number | null;
    hasBudget: boolean;
    hasLogicModel: boolean;
    hasBoardList: boolean;
  },
): boolean {
  const [dimension, ...rest] = insightType.split(":");

  if (dimension === "day_of_week") {
    const losingDay = parseInt(rest[0] ?? "", 10);
    return !Number.isNaN(losingDay) && losingDay === current.submissionDayOfWeek;
  }

  if (dimension === "word_count" || dimension === "days_before_deadline") {
    const range = rest[0] ?? "";
    const [minStr, maxStr] = range.split("-");
    const min = Number(minStr);
    if (Number.isNaN(min)) return false;
    const max = maxStr === "Infinity" || maxStr === undefined ? null : Number(maxStr);
    const value = dimension === "word_count" ? current.wordCount : current.daysBeforeDeadline;
    if (value === null) return false;
    return value >= min && (max === null || value < max);
  }

  if (dimension === "attachment") {
    const flagKey = rest[0];
    const direction = rest[1];
    const flagValue =
      flagKey === "has_budget"
        ? current.hasBudget
        : flagKey === "has_logic_model"
          ? current.hasLogicModel
          : flagKey === "has_board_list"
            ? current.hasBoardList
            : null;
    if (flagValue === null) return false;
    if (direction === "missing") return flagValue === false;
    if (direction === "present") return flagValue === true;
    return false;
  }

  return false;
}

export class RoiOptimizerAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-39-roi-optimizer", supabase);
  }

  /**
   * Keyword-matches documents.file_name / .description for the two
   * attachment types the task spec wants as a real column (has_logic_model,
   * has_board_list) but that have no dedicated document_type/category value
   * in the live schema - see the file header's schema-gap note.
   */
  private async detectAttachmentFlags(
    applicationId: string,
  ): Promise<{ hasLogicModel: boolean; hasBoardList: boolean }> {
    const { data: linkRows } = await this.supabase
      .from("application_documents")
      .select("document_id")
      .eq("application_id", applicationId);

    const documentIds = ((linkRows ?? []) as Array<{ document_id: string }>).map(
      (r) => r.document_id,
    );
    if (documentIds.length === 0) return { hasLogicModel: false, hasBoardList: false };

    const { data: docRows } = await this.supabase
      .from("documents")
      .select("file_name, description")
      .in("id", documentIds);

    let hasLogicModel = false;
    let hasBoardList = false;
    for (const doc of (docRows ?? []) as DocumentTextRow[]) {
      const haystack = `${doc.file_name} ${doc.description ?? ""}`.toLowerCase();
      if (!hasLogicModel && LOGIC_MODEL_KEYWORDS.some((kw) => haystack.includes(kw))) {
        hasLogicModel = true;
      }
      if (!hasBoardList && BOARD_LIST_KEYWORDS.some((kw) => haystack.includes(kw))) {
        hasBoardList = true;
      }
    }
    return { hasLogicModel, hasBoardList };
  }

  /**
   * Task item 6: warns (never blocks - AUTONOMOUS_HARD_LIMITS has no
   * "block a submission" concept, and trackSubmissionVariables() is called
   * after the submit transition already happened, see the route's own
   * comment) when the just-tracked submission matches the losing side of an
   * already-persisted roi_insights row.
   */
  private async checkForViolations(current: {
    submissionDayOfWeek: number;
    wordCount: number;
    daysBeforeDeadline: number | null;
    hasBudget: boolean;
    hasLogicModel: boolean;
    hasBoardList: boolean;
  }): Promise<void> {
    const { data: insightRows } = await this.supabase
      .from("roi_insights")
      .select("insight_type, recommended_action")
      .eq("org_id", this.orgId);

    const insights = (insightRows ?? []) as RoiInsightRow[];
    if (insights.length === 0) return;

    const violations = insights
      .filter((insight) => isDeterministicViolation(insight.insight_type, current))
      .map((insight) => insight.recommended_action)
      .filter((action): action is string => !!action && action.trim().length > 0);

    if (violations.length === 0) return;

    await this.createNotification(
      "roi_violation",
      "This submission goes against a known ROI pattern",
      violations.join(" "),
      undefined,
      "warning",
    );
  }

  /**
   * Records the measurable submission-time variables for one application into
   * submission_variables. Called once, when an application is submitted (see
   * /api/autonomous/track-submission).
   */
  async trackSubmissionVariables(applicationId: string): Promise<void> {
    const { data: applicationRow, error: applicationError } = await this.supabase
      .from("applications")
      .select(
        "id, organization_id, opportunity_id, draft_content, budget_data, submitted_at, draft_source, platform_patterns_applied",
      )
      .eq("id", applicationId)
      .eq("organization_id", this.orgId)
      .maybeSingle();

    if (applicationError || !applicationRow) {
      throw new Error(
        `Could not load application ${applicationId} for submission tracking: ${
          applicationError?.message ?? "not found"
        }`,
      );
    }

    const application = applicationRow as ApplicationForTracking;
    // Read for completeness per task item 1 ("capture ALL ... without
    // exception"); not sent in the insert below - see the file header's
    // schema-gap note on why submission_variables has no column for it yet.
    void application.platform_patterns_applied;

    const submittedAt = application.submitted_at
      ? new Date(application.submitted_at)
      : new Date();
    const submissionDayOfWeek = submittedAt.getDay();

    let daysBeforeDeadline: number | null = null;
    if (application.opportunity_id) {
      const { data: opportunityRow } = await this.supabase
        .from("opportunities")
        .select("deadline")
        .eq("id", application.opportunity_id)
        .maybeSingle();

      const deadline = (opportunityRow as { deadline: string | null } | null)
        ?.deadline;
      if (deadline) {
        daysBeforeDeadline = Math.round(
          (new Date(deadline).getTime() - submittedAt.getTime()) / 86_400_000,
        );
      }
    }

    const { count: attachmentCount } = await this.supabase
      .from("application_documents")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId);

    const draftContent = application.draft_content?.trim() ?? "";
    const wordCount = draftContent
      ? draftContent.split(/\s+/).filter(Boolean).length
      : 0;

    const hasBudget = hasMeaningfulContent(application.budget_data);
    const { hasLogicModel, hasBoardList } = await this.detectAttachmentFlags(applicationId);
    const promptVersion = application.draft_source?.trim() || "unknown";

    let narrativeReadabilityScore: number | null = null;
    if (draftContent) {
      try {
        const readability = await callClaude({
          maxTokens: 10,
          temperature: 0,
          system:
            "Rate readability 0-100. Return only a JSON number. 100=perfectly clear, " +
            "0=incomprehensible. Consider: sentence length, jargon density, active vs " +
            "passive voice, clarity of impact statements.",
          prompt: draftContent.slice(0, MAX_NARRATIVE_CHARS_FOR_READABILITY),
        });
        const match = readability.text.match(/\d+/);
        if (match) {
          narrativeReadabilityScore = Math.min(100, Math.max(0, parseInt(match[0], 10)));
        }
      } catch {
        // Never let a Claude failure block recording the rest of this row.
        narrativeReadabilityScore = null;
      }
    }

    const { error: insertError } = await this.supabase
      .from("submission_variables")
      .insert({
        application_id: applicationId,
        org_id: this.orgId,
        submission_day_of_week: submissionDayOfWeek,
        days_before_deadline: daysBeforeDeadline,
        prompt_version: promptVersion,
        word_count: wordCount,
        attachment_count: attachmentCount ?? 0,
        has_budget: hasBudget,
        has_logic_model: hasLogicModel,
        has_board_list: hasBoardList,
        narrative_readability_score: narrativeReadabilityScore,
      });

    if (insertError) {
      throw new Error(
        `Failed to record submission variables: ${insertError.message}`,
      );
    }

    await this.checkForViolations({
      submissionDayOfWeek,
      wordCount,
      daysBeforeDeadline,
      hasBudget,
      hasLogicModel,
      hasBoardList,
    });
  }

  /**
   * Monthly ROI analysis for this org: deterministically correlates
   * submission_variables against outcomes across four dimensions (day of
   * week, word count, attachment presence x3, days before deadline) and
   * persists any pattern clearing all three significance thresholds
   * (sample_size >= MIN_SAMPLE_SIZE per bucket, confidence >= MIN_CONFIDENCE,
   * spread >= MIN_DIFF_PROPORTION) to roi_insights.
   */
  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    try {
      const { data: variableRows, error: variablesError } = await this.supabase
        .from("submission_variables")
        .select(
          "application_id, submission_day_of_week, days_before_deadline, word_count, has_budget, has_logic_model, has_board_list",
        )
        .eq("org_id", this.orgId);

      if (variablesError) {
        throw new Error(
          `Failed to load submission variables: ${variablesError.message}`,
        );
      }

      const variables = (variableRows ?? []) as SubmissionVariableRow[];

      if (variables.length < MIN_RECORDS_FOR_ANALYSIS) {
        const summary = `Only ${variables.length} submission_variables record(s) on file - need at least ${MIN_RECORDS_FOR_ANALYSIS} before running correlation analysis.`;
        await this.completeRun(runId, {
          outputSummary: summary,
          itemsFound: variables.length,
          itemsProcessed: 0,
          itemsQueued: 0,
        });
        return {
          success: true,
          itemsFound: variables.length,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      const { data: outcomeRows, error: outcomesError } = await this.supabase
        .from("outcomes")
        .select("application_id, result")
        .eq("organization_id", this.orgId);

      if (outcomesError) {
        throw new Error(`Failed to load outcomes: ${outcomesError.message}`);
      }

      const outcomeByApplication = new Map<string, OutcomeResult>();
      for (const o of (outcomeRows ?? []) as OutcomeRow[]) {
        outcomeByApplication.set(o.application_id, o.result);
      }

      const decided: DecidedRecord[] = variables
        .filter((v) => outcomeByApplication.has(v.application_id))
        .map((v) => ({
          submission_day_of_week: v.submission_day_of_week,
          days_before_deadline: v.days_before_deadline,
          word_count: v.word_count,
          has_budget: v.has_budget,
          has_logic_model: v.has_logic_model,
          has_board_list: v.has_board_list,
          outcome_result: outcomeByApplication.get(v.application_id)!,
        }));

      if (decided.length === 0) {
        const summary = `${variables.length} submission_variables record(s) on file, but none have a recorded outcome yet - nothing to correlate.`;
        await this.completeRun(runId, {
          outputSummary: summary,
          itemsFound: variables.length,
          itemsProcessed: 0,
          itemsQueued: 0,
        });
        return {
          success: true,
          itemsFound: variables.length,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      const patterns = [
        analyzeDayOfWeek(decided),
        analyzeWordCount(decided),
        analyzeAttachmentFlag(decided, "has_budget", "a Budget document"),
        analyzeAttachmentFlag(decided, "has_logic_model", "a Logic Model document"),
        analyzeAttachmentFlag(decided, "has_board_list", "a Board List document"),
        analyzeDaysBeforeDeadline(decided),
      ].filter((p): p is RoiPattern => p !== null);

      let itemsQueued = 0;
      for (const pattern of patterns) {
        const { data: inserted, error: insightError } = await this.supabase
          .from("roi_insights")
          .insert({
            org_id: this.orgId,
            insight_type: pattern.insight_type,
            insight_description: pattern.insight_description,
            winning_pattern: pattern.winning_pattern,
            losing_pattern: pattern.losing_pattern,
            sample_size: pattern.sample_size,
            confidence: pattern.confidence,
            recommended_action: pattern.recommended_action,
          })
          .select("id")
          .single();

        if (insightError || !inserted) {
          errors.push(
            `Failed to save insight "${pattern.insight_type}": ${
              insightError?.message ?? "no row returned"
            }`,
          );
          continue;
        }

        itemsQueued += 1;
        decisions.push(
          await this.logDecision({
            decisionType: "roi_pattern_detected",
            agentRunId: runId,
            entityType: "roi_insight",
            entityId: (inserted as { id: string }).id,
            reasoning: pattern.insight_description,
            confidenceScore: Math.round(pattern.confidence * 100),
            actionTaken: `Recorded ROI insight: ${pattern.insight_type}`,
            actionPayload: pattern as unknown as Record<string, unknown>,
          }),
        );
      }

      const thresholdNote = `sample >= ${MIN_SAMPLE_SIZE}, confidence >= ${MIN_CONFIDENCE}, spread >= ${Math.round(MIN_DIFF_PROPORTION * 100)}pp`;
      const summary =
        patterns.length > 0
          ? `Analyzed ${decided.length} submission(s) with outcomes; recorded ${patterns.length} significant ROI insight(s) (${thresholdNote}).`
          : `Analyzed ${decided.length} submission(s) with outcomes; no pattern met the significance threshold (${thresholdNote}).`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: variables.length,
        itemsProcessed: decided.length,
        itemsQueued,
      });

      return {
        success: true,
        itemsFound: variables.length,
        itemsProcessed: decided.length,
        itemsQueued,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "ROI optimization run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}

/**
 * Top current ROI insights as ready-to-inject instruction strings, ordered by
 * confidence then recency. Intended caller: the live draft generation path
 * (src/lib/drafts/generator.ts's generateDraft(), or
 * draft-generation-agent.ts's loadRoiRecommendations(), which currently reads
 * roi_insights directly because this export did not exist - see that file's
 * header note) - injecting these into a new draft's generation prompt is the
 * task's stated intent for this function, not something wired here (out of
 * scope for a single-agent-file rewrite).
 */
export async function getSubmissionRecommendations(
  orgId: string,
  supabase: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("roi_insights")
    .select("recommended_action, confidence, generated_at")
    .eq("org_id", orgId)
    .not("recommended_action", "is", null)
    .order("confidence", { ascending: false, nullsFirst: false })
    .order("generated_at", { ascending: false })
    .limit(TOP_RECOMMENDATIONS_COUNT);

  if (error || !data) return [];

  return (data as Array<{ recommended_action: string | null }>)
    .map((row) => row.recommended_action)
    .filter((action): action is string => !!action && action.trim().length > 0);
}
