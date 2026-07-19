// AG-36 Learning Network Aggregator Agent (AutonomousAgent, migration 080
// infrastructure + migration 083 substrate: platform_learning_patterns,
// org_learning_contributions). Phase 4, AUTONOMOUS_PLATFORM_VISION.md
// "Global Learning Network" section: anonymizes and aggregates successful
// grant patterns (narrative language, budget structure, keywords, timing,
// attachment types) across every org's awarded outcomes, so every org's
// Knowledge Engine benefits from outcomes it never personally generated.
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
// `NOT NULL ... REFERENCES organizations(id)` (see migration
// 080_autonomous_agent_infrastructure.sql). A service-role client bypasses
// Row Level Security, but it does NOT bypass foreign-key constraints - a
// bare sentinel UUID or a null would fail the insert outright. Rather than
// modify autonomous-base.ts (out of scope; it is shared by 17 other
// classes), this file lazily provisions one real, well-known "system"
// organization row (`ensureSystemOrg()`) the first time it runs, and uses
// that row's id for every base-class call. This satisfies the FK
// constraint while keeping every actual data query in this file unscoped
// across all real tenant orgs.
//
// Numbering collision, flagged per the convention in AGENTS_v2.md §1.4:
// the task that produced this file calls this agent "AG-36" directly.
// AGENTS_v2.md's own "Phase 2-5 Agent Specifications" section already
// warns that its sequential AG-29..AG-40 numbering disagrees with
// AUTONOMOUS_PLATFORM_VISION.md §7 on five of twelve agents - and this is
// one of them. AUTONOMOUS_PLATFORM_VISION.md itself says the Learning
// Network Aggregator concept has "no new agent number - extends AG-29"
// (Knowledge Engine Indexer), while AGENTS_v2.md's own AG-36 slot
// (Section 5) is already the *live* Knowledge Engine Indexer's collision
// partner for a different reason, and AUTONOMOUS_PLATFORM_VISION.md's own
// "AG-36" elsewhere refers to the Autonomous Continuous Improvement Engine
// (this document's AG-38). None of that is resolved here - this file uses
// the literal agentId "ag-36-learning-network" so it cannot collide with
// any string that is actually live in the agent_type enum today, and
// leaves true renumbering to whoever wires the Phase 4 roster for real.
//
// Known, unresolved gap (matches the pattern documented in AGENTS_v2.md
// §1.2 for AG-02/03/04/05/06/07/15/17/19/25/28/digest): "ag-36-learning-
// network" is not yet a value in the `agent_type` Postgres enum. Until a
// migration adds it (`ALTER TYPE agent_type ADD VALUE IF NOT EXISTS
// 'ag-36-learning-network'`), `startRun()`'s insert into `agent_runs` will
// throw before any aggregation happens - the same failure mode already
// documented for the other unreachable Generation-2 agents. Not fixed here
// since a schema migration is out of scope for this task.
//
// Deviation from the task-given spec: the task says "load the associated
// application draft_content." `applications.draft_content` is used as the
// primary narrative source (per that instruction literally), but falls
// back to `outcomes.narrative_snapshot` when draft_content is null -
// SCHEMA_REGISTRY_v2.md documents narrative_snapshot as "Narrative
// snapshot frozen at submission," which is the more faithful record of
// what was actually awarded (draft_content can be overwritten by later,
// unrelated draft regeneration on the same application row).
//
// No chain target: AUTONOMOUS_PLATFORM_VISION.md §7's Phase 4 table lists
// this feature as "Internal only - no client-facing route," and this
// agent is the terminal step of its own pass (results surface indirectly
// through the existing Knowledge Engine query UI, not through a queued
// downstream agent). `queueChainedAgent()` is intentionally never called.

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
 * spend and run duration predictable on a weekly cadence. */
const MAX_OUTCOMES_PER_RUN = 50;
/** winning_examples is a jsonb array with no DB-side cap - bound it here so
 * a long-lived pattern row doesn't grow unbounded. */
const WINNING_EXAMPLES_CAP = 25;
/** Matches the task's "anonymized excerpt max 200 chars" instruction. */
const EXCERPT_MAX_LENGTH = 200;
const MAX_PHRASES = 10;
const MAX_KEYWORDS = 8;
/** Narrative text sent to Claude is capped, not to save cost on any single
 * call but to bound worst-case run time across up to MAX_OUTCOMES_PER_RUN. */
const MAX_NARRATIVE_CHARS_FOR_CLAUDE = 6000;
/** success_rate here is a confidence proxy, not a true win rate - see the
 * comment on computeConfidenceProxy() below for why. */
const SUCCESS_RATE_CONFIDENCE_TARGET = 20;

type PatternType =
  | "narrative_language"
  | "budget_structure"
  | "keyword"
  | "timing"
  | "attachment_type";

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

interface PatternCandidate {
  patternType: PatternType;
  excerpts: string[];
}

interface UpsertPatternResult {
  id: string;
  created: boolean;
  sampleCount: number;
}

interface ProcessOutcomeResult {
  created: number;
  updated: number;
  tokensUsed: number;
  decisionIds: string[];
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
const ADMIN_KEYWORDS = [
  "admin",
  "overhead",
  "indirect",
  "operations",
  "operating",
];

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_PATTERN = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const EIN_PATTERN = /\b\d{2}-\d{7}\b/g;

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

/** Strips org-identifying text before anything derived from it is ever
 * written to the shared platform_learning_patterns table. Redacts known
 * org fields first (longest value first, so a short token inside a longer
 * one - e.g. a city name that is also a common word - doesn't get
 * double-processed), then applies generic email/phone/EIN patterns as a
 * safety net regardless of what the org profile lookup found. */
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

  result = result.replace(EMAIL_PATTERN, "[CONTACT]");
  result = result.replace(PHONE_PATTERN, "[CONTACT]");
  result = result.replace(EIN_PATTERN, "[CONTACT]");
  return result;
}

/** Local, non-Claude keyword fallback used only when an outcome has no
 * `keywords_used` array of its own - keeps every-outcome Claude spend down
 * to a single call (narrative phrase extraction). */
function extractKeywordsLocally(text: string, cap = MAX_KEYWORDS): string[] {
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
    .map(([word]) => word);
}

/** personnel/programs/admin ratio from applications.budget_data. Format is
 * not strictly typed in the schema (jsonb "structured budget snapshot");
 * defensively accepts either `lineItems` or `line_items`, matching
 * grant_budgets.line_items' documented shape
 * ([{category, description, amount, justification}]). Returns null when
 * the field is empty or unusable rather than fabricating a ratio. */
function computeBudgetRatio(
  budgetData: unknown,
): { personnel: number; programs: number; admin: number } | null {
  if (!budgetData || typeof budgetData !== "object") return null;
  const obj = budgetData as Record<string, unknown>;
  const rawItems = obj.lineItems ?? obj.line_items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) return null;

  let personnel = 0;
  let admin = 0;
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
    } else if (ADMIN_KEYWORDS.some((k) => category.includes(k))) {
      admin += amount;
    } else {
      programs += amount;
    }
  }

  const total = personnel + admin + programs;
  if (total <= 0) return null;

  return {
    personnel: Number((personnel / total).toFixed(3)),
    programs: Number((programs / total).toFixed(3)),
    admin: Number((admin / total).toFixed(3)),
  };
}

function computeDaysBeforeDeadline(
  submittedAt: string | null,
  deadline: string | null,
): number | null {
  if (!submittedAt || !deadline) return null;
  const submitted = new Date(submittedAt).getTime();
  const due = new Date(deadline).getTime();
  if (Number.isNaN(submitted) || Number.isNaN(due)) return null;
  return Math.round((due - submitted) / (24 * 60 * 60 * 1000));
}

function bucketTiming(daysBeforeDeadline: number): string {
  if (daysBeforeDeadline < 0) return "submitted_after_deadline";
  if (daysBeforeDeadline <= 1) return "submitted_final_day";
  if (daysBeforeDeadline <= 6) return "submitted_1_to_6_days_before_deadline";
  if (daysBeforeDeadline <= 14) return "submitted_7_to_14_days_before_deadline";
  if (daysBeforeDeadline <= 30) return "submitted_15_to_30_days_before_deadline";
  return "submitted_more_than_30_days_before_deadline";
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

function describePatternContent(
  patternType: PatternType,
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

async function extractTopPhrasesViaClaude(
  anonymizedText: string,
): Promise<{ phrases: string[]; tokensUsed: number }> {
  const prompt = [
    "Below is an anonymized excerpt from a SUCCESSFULLY AWARDED grant",
    "application narrative. Identify up to 10 short phrases (3-12 words",
    "each) that represent strong, fundable grant-writing language - e.g.",
    "specific measurable outcomes, clear need statements, or concrete",
    "impact claims. Skip anything that still looks like it could identify",
    "a person, place, or organization even after redaction. Respond with",
    "ONLY a JSON array of strings - no prose, no markdown fences.",
    "",
    "Excerpt:",
    anonymizedText.slice(0, MAX_NARRATIVE_CHARS_FOR_CLAUDE),
  ].join("\n");

  const response = await callClaude({ prompt, maxTokens: 500, temperature: 0.2 });

  let phrases: string[] = [];
  try {
    const parsed: unknown = JSON.parse(response.text.trim());
    if (Array.isArray(parsed)) {
      phrases = parsed.filter((p): p is string => typeof p === "string");
    }
  } catch {
    const match = response.text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed: unknown = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          phrases = parsed.filter((p): p is string => typeof p === "string");
        }
      } catch {
        // Claude didn't return parseable JSON either way - phrases stays
        // empty rather than guessing at a malformed extraction.
      }
    }
  }

  return {
    phrases: phrases.slice(0, MAX_PHRASES),
    tokensUsed: response.usage.totalTokens,
  };
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

  /** Looks up an existing platform_learning_patterns row by
   * (pattern_type, funder_category, ntee_code) - the match key the task
   * specifies - and either increments it or inserts a new row. Both
   * funder_category and ntee_code are nullable, so null-safe `.is()` is
   * used instead of `.eq()` wherever the value is null. */
  private async upsertPattern(params: {
    patternType: PatternType;
    funderCategory: FunderCategory | null;
    nteeCode: string | null;
    excerpts: string[];
    awardAmount: number | null;
  }): Promise<UpsertPatternResult> {
    let query = this.supabase
      .from("platform_learning_patterns")
      .select("id, sample_count, avg_award_amount, winning_examples")
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
      const existingAvgAward =
        (existing.avg_award_amount as number | null) ?? null;
      const existingExamples: unknown[] = Array.isArray(
        existing.winning_examples,
      )
        ? (existing.winning_examples as unknown[])
        : [];

      const newSampleCount = existingSampleCount + 1;
      const mergedExamples = [...existingExamples, ...params.excerpts].slice(
        -WINNING_EXAMPLES_CAP,
      );
      const newAvgAward =
        params.awardAmount != null
          ? Math.round(
              ((existingAvgAward ?? 0) * existingSampleCount +
                params.awardAmount) /
                newSampleCount,
            )
          : existingAvgAward;

      const { error: updateError } = await this.supabase
        .from("platform_learning_patterns")
        .update({
          sample_count: newSampleCount,
          avg_award_amount: newAvgAward,
          winning_examples: mergedExamples,
          success_rate: computeConfidenceProxy(newSampleCount),
          last_updated: new Date().toISOString(),
        })
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
      };
    }

    const { data: inserted, error: insertError } = await this.supabase
      .from("platform_learning_patterns")
      .insert({
        pattern_type: params.patternType,
        funder_category: params.funderCategory,
        ntee_code: params.nteeCode,
        pattern_content: describePatternContent(
          params.patternType,
          params.funderCategory,
        ),
        success_rate: computeConfidenceProxy(1),
        sample_count: 1,
        avg_award_amount: params.awardAmount,
        winning_examples: params.excerpts,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      throw new Error(
        `Failed to insert platform_learning_patterns row: ${insertError?.message ?? "no row returned"}`,
      );
    }

    return { id: inserted.id as string, created: true, sampleCount: 1 };
  }

  /** Per-org, anonymized-only audit trail of which outcome fed which
   * platform pattern. No raw narrative/keyword/budget content is stored
   * here - only ids and the pattern_type label. */
  private async recordContribution(
    orgId: string,
    outcomeId: string,
    patternType: PatternType,
    patternId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from("org_learning_contributions")
      .insert({
        org_id: orgId,
        outcome_id: outcomeId,
        contribution_type: patternType,
        pattern_id: patternId,
      });

    if (error) {
      throw new Error(
        `Failed to record org_learning_contributions for outcome ${outcomeId}: ${error.message}`,
      );
    }
  }

  private async processOutcome(
    outcome: OutcomeRow,
    runId: string,
  ): Promise<ProcessOutcomeResult> {
    const { data: applicationRow, error: applicationError } =
      await this.supabase
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
    if (application.opportunity_id) {
      const { data: opportunityRow } = await this.supabase
        .from("opportunities")
        .select("deadline")
        .eq("id", application.opportunity_id)
        .maybeSingle();
      opportunityDeadline =
        (opportunityRow?.deadline as string | null) ?? null;
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

    const funderCategory: FunderCategory | null =
      outcome.opportunity_category ?? outcome.funder_category ?? null;
    // No reliable path from opportunities -> funders -> foundation_directory
    // by EIN exists in the current schema (funders has no ein/ntee_code
    // column; foundation_directory's ntee_code is keyed off EIN alone).
    // Left null rather than guessing - see AGENTS_v2.md's repeated
    // "never fabricates a field it can't extract" convention.
    const nteeCode: string | null = null;

    const narrativeSource =
      application.draft_content ?? outcome.narrative_snapshot ?? null;

    const candidates: PatternCandidate[] = [];
    let tokensUsed = 0;

    if (narrativeSource && narrativeSource.trim().length > 0) {
      const anonymized = anonymizeText(narrativeSource, orgProfile);

      const { phrases, tokensUsed: phraseTokens } =
        await extractTopPhrasesViaClaude(anonymized);
      tokensUsed += phraseTokens;
      if (phrases.length > 0) {
        candidates.push({
          patternType: "narrative_language",
          excerpts: phrases.map((p) => truncateExcerpt(p)),
        });
      }

      const keywords =
        outcome.keywords_used && outcome.keywords_used.length > 0
          ? outcome.keywords_used
          : extractKeywordsLocally(anonymized);
      if (keywords.length > 0) {
        candidates.push({
          patternType: "keyword",
          excerpts: keywords.map((k) => truncateExcerpt(k)),
        });
      }
    }

    const budgetRatio = computeBudgetRatio(application.budget_data);
    if (budgetRatio) {
      candidates.push({
        patternType: "budget_structure",
        excerpts: [
          truncateExcerpt(
            `personnel ${Math.round(budgetRatio.personnel * 100)}% / ` +
              `programs ${Math.round(budgetRatio.programs * 100)}% / ` +
              `admin ${Math.round(budgetRatio.admin * 100)}%`,
          ),
        ],
      });
    }

    const daysBeforeDeadline = computeDaysBeforeDeadline(
      application.submitted_at,
      opportunityDeadline,
    );
    if (daysBeforeDeadline !== null) {
      candidates.push({
        patternType: "timing",
        excerpts: [truncateExcerpt(bucketTiming(daysBeforeDeadline))],
      });
    }

    if (attachmentCategories.length > 0) {
      candidates.push({
        patternType: "attachment_type",
        excerpts: attachmentCategories.map((c) => truncateExcerpt(c)),
      });
    }

    let created = 0;
    let updated = 0;
    const decisionIds: string[] = [];

    for (const candidate of candidates) {
      const result = await this.upsertPattern({
        patternType: candidate.patternType,
        funderCategory,
        nteeCode,
        excerpts: candidate.excerpts,
        awardAmount: outcome.awarded_amount,
      });

      if (result.created) created += 1;
      else updated += 1;

      const decisionId = await this.logDecision({
        decisionType: "learning_pattern_updated",
        agentRunId: runId,
        entityType: "platform_learning_pattern",
        entityId: result.id,
        reasoning:
          `Awarded outcome ${outcome.id} (${funderCategory ?? "uncategorized"}) ` +
          `contributed ${candidate.excerpts.length} anonymized excerpt(s) to a ` +
          `${candidate.patternType} pattern; sample_count is now ${result.sampleCount}.`,
        confidenceScore: computeDecisionConfidence(result.sampleCount),
        actionTaken: result.created
          ? `Created platform_learning_patterns row for ${candidate.patternType}.`
          : `Updated platform_learning_patterns row for ${candidate.patternType}.`,
        actionPayload: {
          patternType: candidate.patternType,
          funderCategory,
          sampleCount: result.sampleCount,
        },
        requiredHumanReview: false,
      });
      decisionIds.push(decisionId);

      await this.recordContribution(
        application.organization_id,
        outcome.id,
        candidate.patternType,
        result.id,
      );
    }

    return { created, updated, tokensUsed, decisionIds };
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
    let patternsCreated = 0;
    let patternsUpdated = 0;

    try {
      const cutoff = new Date(
        Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

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

      if (outcomes.length === 0) {
        const summary =
          "No awarded outcomes in the last " +
          `${LOOKBACK_DAYS} days - nothing to aggregate.`;
        await this.completeRun(runId, {
          outputSummary: summary,
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
        });
        return {
          success: true,
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      for (const outcome of outcomes) {
        try {
          const result = await this.processOutcome(outcome, runId);
          outcomesAnalyzed += 1;
          patternsCreated += result.created;
          patternsUpdated += result.updated;
          tokensUsed += result.tokensUsed;
          decisions.push(...result.decisionIds);
        } catch (perOutcomeErr) {
          const message =
            perOutcomeErr instanceof Error
              ? perOutcomeErr.message
              : "Unknown error while processing outcome.";
          errors.push(`outcome ${outcome.id}: ${message}`);
        }
      }

      const summary =
        `Analyzed ${outcomesAnalyzed} of ${outcomes.length} awarded outcomes ` +
        `from the last ${LOOKBACK_DAYS} days; created ${patternsCreated} new ` +
        `platform_learning_patterns row(s) and updated ${patternsUpdated} ` +
        "existing row(s).";

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: outcomes.length,
        itemsProcessed: outcomesAnalyzed,
        itemsQueued: 0,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: outcomes.length,
        itemsProcessed: outcomesAnalyzed,
        itemsQueued: 0,
        decisions,
        nextActions:
          patternsCreated + patternsUpdated > 0
            ? [
                "Review updated cross-org patterns via the Knowledge Engine (/intelligence/knowledge).",
              ]
            : [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Learning network aggregation run failed.";
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
