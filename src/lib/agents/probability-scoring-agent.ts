// Grant Probability Scoring Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 5
// (Grant Probability Engine), AGENTS_v2.md AG-15.
//
// FULL AGENTIC UPGRADE (July 2026): this agent no longer just wraps the
// deterministic computeGrantProbability() and pass its numbers through. It
// now runs a self-calibration loop: it reads this org's own award/denial
// history to see whether its own past predictions ran hot or cold, feeds
// that calibration note into a Claude scoring pass with an explicit 5-factor
// weighted rubric, derives a deterministic confidence band from how much
// real data actually backed the call (never trusts the model's own claim
// about its data quality), and only then decides whether to chain into
// draft generation, fundability diagnosis, or a "consider skipping" alert.
// computeGrantProbability() is still called first as a grounding baseline
// signal fed into the Claude prompt — the calibrated score it produces here
// is what gets persisted as this opportunity's final overall_score.
//
// Known deviations from the literal task spec, documented per this
// project's established practice of not silently reshaping the schema to
// fit a task description that collides with what's actually live (see
// migration 091/093's own header comments for prior instances):
//   - "NTEE alignment" factor: this schema has no NTEE code on
//     `opportunities` or `organizations` (NTEE only exists on
//     `foundation_directory`, a different table entirely). This factor is
//     graded from funding-category + mission-statement alignment instead,
//     and the Claude prompt says so explicitly rather than silently
//     pretending an NTEE lookup happened.
//   - "Insert into opportunity_probability_scores even if a record exists,
//     to track score history": opportunity_probability_scores has a real
//     UNIQUE(opportunity_id, organization_id) constraint (migration 093)
//     that computeGrantProbability()'s own upsert — used by the manual
//     /api/intelligence/grant-probability route and
//     scripts/batch-score-opportunities.ts, neither of which this task
//     touches — depends on for correct single-row-per-opportunity
//     semantics. Duplicating rows here would break those callers or require
//     a schema change well beyond this file's scope. Score history is
//     instead read from `agent_decisions`, which already logs one new
//     row per run (decision_type="probability_scored", entity_id=
//     opportunity id, confidence_score=the computed score, created_at=the
//     timestamp) and is never overwritten — i.e. it already IS an
//     append-only score history for this exact purpose. loadScoreTrend()
//     below reads it back out to detect improving/declining/stable trends.
//   - agent_type enum: "ag-15-probability" is now a value in the agent_type
//     enum (migration 178) and in the AgentType TS union (src/types/agents.ts)
//     — previously flagged here as missing per AGENTS_v2.md §1.2, which made
//     every startRun() on this agent fail before any scoring logic executed.
//
// agentId is "ag-15-probability" to match the id OpportunityDiscoveryAgent
// (src/lib/agents/opportunity-discovery-agent.ts) already uses when it
// chains new discoveries into this agent via queueChainedAgent — the
// chain-scope lookup below (triggerSource === "chain") depends on that
// literal string matching the agent_queue row the queue processor is
// currently running.

import type { SupabaseClient } from "@supabase/supabase-js";
import { subDays } from "date-fns";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  computeGrantProbability,
  type GrantProbabilityFactor,
  type GrantProbabilityResult,
} from "@/lib/intelligence/grant-probability-engine";

const STALE_AFTER_DAYS = 7;
/** Every opportunity now costs one real Claude call (unlike the pure
 * deterministic engine this agent used to just wrap) — cap nightly volume
 * so a large open-opportunity backlog can't blow the token budget in one run. */
const MAX_PER_RUN = 20;
const CALIBRATION_LOOKBACK_DAYS = 180;
const MIN_CALIBRATION_SAMPLES = 5;
const MAX_TOKENS = 1200;

/** Sums to 1.0. Order matches the task-mandated weighting order exactly. */
const FACTOR_WEIGHTS = {
  ntee_alignment: 0.3,
  geographic_eligibility: 0.25,
  financial_capacity_match: 0.2,
  track_record: 0.15,
  program_fit: 0.1,
} as const;

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";
type ConfidenceBand = "high" | "medium" | "low";
type RubricLabel = "strong_apply" | "apply" | "review" | "likely_pass";

interface OpportunityScopeRow {
  id: string;
  name: string | null;
  funder_id: string | null;
}

interface ScoreRow {
  opportunity_id: string;
  computed_at: string | null;
}

interface OrgProfile {
  name: string;
  tax_status: string | null;
  mission_statement: string | null;
  service_area: string | null;
  target_population: string | null;
  annual_budget: number | null;
}

interface FunderRow {
  name: string;
  category: string | null;
  geographic_focus: string | null;
  annual_giving_budget: number | null;
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

interface DigitalTwinRow {
  mission: string | null;
  service_areas: string[] | null;
  twin_completeness_score: number | null;
  key_strengths: string[] | null;
  proven_narrative_patterns: string[] | null;
}

interface CalibrationSummary {
  sampleSize: number;
  avgAwardedScore: number | null;
  avgDeniedScore: number | null;
}

interface CategoryOutcomeStats {
  count: number;
  awardRate: number | null;
}

interface ScoreTrend {
  direction: "improving" | "declining" | "stable" | "insufficient_data";
  history: number[];
}

interface FactorScores {
  ntee_alignment: number;
  geographic_eligibility: number;
  financial_capacity_match: number;
  track_record: number;
  program_fit: number;
}

interface ParsedCalibratedScore {
  factorScores: FactorScores;
  confidenceBand: ConfidenceBand;
  recommendationLabel: RubricLabel;
  recommendationText: string;
  keyRisks: string[];
  keyStrengths: string[];
}

function factorPercent(
  factors: GrantProbabilityFactor[],
  name: string,
): number {
  const found = factors.find((f) => f.name === name);
  return found ? Math.round(found.value * 100) : 0;
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

/** Deterministic — never trust the model's own claim about how much real
 * data backed its answer. Counts how many of the 5 rubric factors actually
 * had real facts behind them (vs. the model having to reason from gaps). */
function bandFromDataAvailability(count: number): ConfidenceBand {
  if (count >= 4) return "high";
  if (count >= 2) return "medium";
  return "low";
}

/** Mirrors grant-probability-engine.ts's own recommendation thresholds
 * exactly, so opportunity_probability_scores.recommendation keeps the same
 * apply/consider/skip domain every existing caller already expects. */
function deriveLegacyRecommendation(
  score: number,
): "apply" | "consider" | "skip" {
  return score >= 70 ? "apply" : score >= 40 ? "consider" : "skip";
}

/** The task-mandated 4-tier rubric (75+/60-74/45-59/<45) — a distinct,
 * richer label surfaced in decision reasoning and recommendation text, kept
 * separate from the legacy 3-tier DB column domain above on purpose. */
function deriveRubricLabel(score: number): RubricLabel {
  if (score >= 75) return "strong_apply";
  if (score >= 60) return "apply";
  if (score >= 45) return "review";
  return "likely_pass";
}

function mergeUnique(a: string[], b: string[], cap: number): string[] {
  const out: string[] = [];
  for (const item of [...a, ...b]) {
    const trimmed = item.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

function buildCalibratedPrompt(args: {
  org: OrgProfile;
  funder: FunderRow | null;
  opportunity: OpportunityFacts;
  baseline: GrantProbabilityResult;
  twin: DigitalTwinRow | null;
  kbCategories: string[];
  categoryStats: CategoryOutcomeStats;
  calibration: CalibrationSummary;
  trend: ScoreTrend;
}): { system: string; prompt: string } {
  const {
    org,
    funder,
    opportunity,
    baseline,
    twin,
    kbCategories,
    categoryStats,
    calibration,
    trend,
  } = args;

  const calibrationParagraph =
    calibration.sampleSize >= MIN_CALIBRATION_SAMPLES &&
    calibration.avgAwardedScore != null &&
    calibration.avgDeniedScore != null
      ? `Historical calibration: over the last ${CALIBRATION_LOOKBACK_DAYS} days, this organization's winning grants averaged a predicted score of ${Math.round(
          calibration.avgAwardedScore,
        )} out of 100, and its denied grants averaged a predicted score of ${Math.round(
          calibration.avgDeniedScore,
        )} out of 100 at the time they were assessed, across ${
          calibration.sampleSize
        } outcomes. Calibrate your factor scores accordingly — if this opportunity resembles the pattern behind this organization's past winners more than its past losses, score it nearer the winning average; if it resembles the pattern behind past losses, score it nearer the denied average. Do not ignore this signal.`
      : `No calibration data is available yet for this organization (fewer than ${MIN_CALIBRATION_SAMPLES} outcomes with a matching probability score recorded in the last ${CALIBRATION_LOOKBACK_DAYS} days — currently ${calibration.sampleSize}). Score this opportunity on the rubric below without a historical adjustment, and note in your reasoning that calibration accuracy will improve as more outcomes are recorded.`;

  const system = [
    "You are the Grant Probability Engine's calibration layer for a nonprofit grant-management platform. Your job is to produce a self-calibrating 0-100 probability-of-award score for one specific funding opportunity, grounded strictly in the organizational, funder, opportunity, and historical outcome facts provided below. Never invent a fact about the organization, the funder, or the opportunity that was not given to you. Where a needed fact is missing or unknown, say so explicitly in your reasoning rather than assuming it is favorable, and score the affected factor conservatively rather than optimistically.",
    "",
    "Score using this exact 0-100 rubric: 75 or higher means strong apply — this organization should prioritize this opportunity above most others currently in its pipeline. 60 to 74 means apply — a solid, worthwhile use of staff time and effort. 45 to 59 means review — a borderline case that needs a human to weigh the effort required against the realistic odds before committing resources. Below 45 means likely pass — the effort required to apply is unlikely to be justified by the probability of an award.",
    "",
    "Weight the following five factors, in this exact order of importance, when forming your judgment: (1) NTEE/mission alignment at 30% — this platform does not store IRS NTEE classification codes on opportunities or organizations, so grade this factor from how directly the opportunity's funding category and description match the organization's stated mission and program focus instead; (2) geographic eligibility at 25% — does the opportunity's geographic restriction, if any, actually include this organization's service area; (3) financial capacity match at 20% — does the opportunity's award range realistically fit this organization's annual budget and grant-seeking capacity; (4) track record at 15% — this organization's actual historical win rate on opportunities in the same funding category; (5) program fit at 10% — how well the organization's existing programs, Digital Twin profile, and Knowledge Base content already answer what this funder is looking for.",
    "",
    calibrationParagraph,
    "",
    "recommendation_text must be a specific, evidence-based explanation of 2 to 3 full sentences — never a single word like \"Apply\" and never a vague generality. For example: \"Strong apply — NTEE/mission alignment is direct because this is a housing-focused grant and the organization's core program is transitional housing, the award range fits comfortably within the organization's annual budget, and a recent similar award to a comparable organization in the same state supports high confidence.\" Ground every claim you make in the facts given below — do not cite a fact that was not provided to you.",
    "",
    "Respond with ONLY a single JSON object, no prose, no markdown code fences, in exactly this shape and these types: " +
      '{"factor_scores": {"ntee_alignment": <integer 0-100>, "geographic_eligibility": <integer 0-100>, "financial_capacity_match": <integer 0-100>, "track_record": <integer 0-100>, "program_fit": <integer 0-100>}, "confidence_band": <string, one of "high" | "medium" | "low">, "recommendation_label": <string, one of "strong_apply" | "apply" | "review" | "likely_pass">, "recommendation_text": <string, 2-3 full sentences>, "key_risks": <array of strings>, "key_strengths": <array of strings>}. ' +
      "Every field is required.",
  ].join("\n");

  const orgLines: string[] = [];
  const add = (label: string, value: string | null) => {
    if (value != null && `${value}`.trim() !== "") orgLines.push(`- ${label}: ${value}`);
  };
  add("Legal name", org.name);
  add("Tax status", org.tax_status);
  add("Mission", org.mission_statement);
  add("Service area", org.service_area);
  add("Target population", org.target_population);
  add("Annual budget", formatCurrency(org.annual_budget));
  add(
    "Knowledge Base category coverage",
    kbCategories.length > 0
      ? kbCategories.join(", ")
      : "No Knowledge Base entries on file at all.",
  );
  if (twin) {
    add(
      "Organizational Digital Twin completeness",
      twin.twin_completeness_score != null ? `${twin.twin_completeness_score}%` : null,
    );
    add("Digital Twin mission statement", twin.mission);
    if (twin.service_areas && twin.service_areas.length > 0) {
      add("Digital Twin service areas", twin.service_areas.join(", "));
    }
    if (twin.key_strengths && twin.key_strengths.length > 0) {
      add("Twin-documented strengths", twin.key_strengths.join("; "));
    }
    if (twin.proven_narrative_patterns && twin.proven_narrative_patterns.length > 0) {
      add("Proven narrative patterns on file", twin.proven_narrative_patterns.join("; "));
    }
  } else {
    orgLines.push("- Organizational Digital Twin: none built yet for this org.");
  }
  if (categoryStats.count > 0 && categoryStats.awardRate != null) {
    orgLines.push(
      `- Track record in this funding category: ${categoryStats.count} past outcome(s), ${Math.round(
        categoryStats.awardRate * 100,
      )}% award rate.`,
    );
  } else {
    orgLines.push("- Track record in this funding category: no past outcomes on file yet.");
  }
  if (trend.direction !== "insufficient_data") {
    orgLines.push(
      `- This opportunity's own probability score trend across prior runs: ${trend.direction} (history: ${trend.history.join(" -> ")}).`,
    );
  }

  const funderLines: string[] = [];
  if (funder) {
    if (funder.category) funderLines.push(`- Funder category: ${funder.category}`);
    if (funder.geographic_focus) funderLines.push(`- Funder geographic focus: ${funder.geographic_focus}`);
    const funderBudget = formatCurrency(funder.annual_giving_budget);
    if (funderBudget) funderLines.push(`- Funder annual giving budget: ${funderBudget}`);
  } else {
    funderLines.push("- No linked funder record for this opportunity.");
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
  oppLines.push(
    `- Deterministic Grant Probability Engine baseline: ${baseline.score}/100 ` +
      `(confidence ${baseline.confidence}; mission/twin-completeness factor ${factorPercent(
        baseline.factors,
        "twin_completeness",
      )}%; deadline urgency factor ${factorPercent(baseline.factors, "deadline_proximity")}%).`,
  );

  const prompt = [
    "## Organization",
    orgLines.join("\n"),
    "",
    "## Funder",
    funderLines.join("\n"),
    "",
    "## Opportunity",
    oppLines.join("\n"),
    "",
    "Diagnose and score this opportunity now. Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}

function parseCalibratedResponse(text: string): ParsedCalibratedScore {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The calibration model returned an unreadable response.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The calibration model returned malformed JSON.");
  }

  const obj = (raw ?? {}) as {
    factor_scores?: Record<string, unknown>;
    confidence_band?: unknown;
    recommendation_label?: unknown;
    recommendation_text?: unknown;
    key_risks?: unknown;
    key_strengths?: unknown;
  };

  const rawFactors = obj.factor_scores ?? {};
  const factorScores: FactorScores = {
    ntee_alignment: clampScore(rawFactors.ntee_alignment, 50),
    geographic_eligibility: clampScore(rawFactors.geographic_eligibility, 50),
    financial_capacity_match: clampScore(rawFactors.financial_capacity_match, 50),
    track_record: clampScore(rawFactors.track_record, 30),
    program_fit: clampScore(rawFactors.program_fit, 30),
  };

  const rawBand =
    typeof obj.confidence_band === "string" ? obj.confidence_band.toLowerCase() : "";
  const confidenceBand: ConfidenceBand =
    rawBand === "high" || rawBand === "medium" || rawBand === "low" ? rawBand : "low";

  const rawLabel =
    typeof obj.recommendation_label === "string" ? obj.recommendation_label.toLowerCase() : "";
  const validLabels: RubricLabel[] = ["strong_apply", "apply", "review", "likely_pass"];
  const recommendationLabel: RubricLabel = validLabels.includes(rawLabel as RubricLabel)
    ? (rawLabel as RubricLabel)
    : "review";

  const recommendationText =
    typeof obj.recommendation_text === "string" && obj.recommendation_text.trim() !== ""
      ? obj.recommendation_text.trim()
      : "";

  const keyRisks = Array.isArray(obj.key_risks)
    ? obj.key_risks.filter((r): r is string => typeof r === "string")
    : [];
  const keyStrengths = Array.isArray(obj.key_strengths)
    ? obj.key_strengths.filter((r): r is string => typeof r === "string")
    : [];

  return {
    factorScores,
    confidenceBand,
    recommendationLabel,
    recommendationText,
    keyRisks,
    keyStrengths,
  };
}

export class ProbabilityScoringAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-15-probability", supabase);
  }

  /**
   * "chain" scope: the discovery agent enqueues this agent's own agent_queue
   * row with input_payload.opportunityIds — read the row the queue processor
   * marked "processing" (this run) rather than re-querying the queue by id,
   * since AutonomousAgent has no queue-item id passed into run().
   */
  private async loadChainScope(): Promise<OpportunityScopeRow[]> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as {
      opportunityIds?: unknown;
    };
    const opportunityIds = Array.isArray(payload.opportunityIds)
      ? payload.opportunityIds.filter((id): id is string => typeof id === "string")
      : [];

    if (opportunityIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from("opportunities")
      .select("id, name, funder_id")
      .eq("organization_id", this.orgId)
      .in("id", opportunityIds);

    if (error) {
      throw new Error(`Failed to load chained opportunities: ${error.message}`);
    }
    return (data ?? []) as OpportunityScopeRow[];
  }

  /**
   * Default scope: every open opportunity for this org with no score row yet,
   * or whose score is more than STALE_AFTER_DAYS old — mirrors
   * scripts/batch-score-opportunities.ts's staleness rule, scoped to one org.
   */
  private async loadDefaultScope(): Promise<OpportunityScopeRow[]> {
    const [opportunitiesRes, scoresRes] = await Promise.all([
      this.supabase
        .from("opportunities")
        .select("id, name, funder_id")
        .eq("organization_id", this.orgId)
        .eq("status", "open"),
      this.supabase
        .from("opportunity_probability_scores")
        .select("opportunity_id, computed_at")
        .eq("organization_id", this.orgId),
    ]);

    if (opportunitiesRes.error) {
      throw new Error(
        `Failed to load open opportunities: ${opportunitiesRes.error.message}`,
      );
    }
    if (scoresRes.error) {
      throw new Error(
        `Failed to load existing probability scores: ${scoresRes.error.message}`,
      );
    }

    const scoreMap = new Map<string, string | null>();
    for (const row of (scoresRes.data ?? []) as ScoreRow[]) {
      scoreMap.set(row.opportunity_id, row.computed_at);
    }

    const staleThreshold = subDays(new Date(), STALE_AFTER_DAYS);
    const opportunities = (opportunitiesRes.data ?? []) as OpportunityScopeRow[];

    return opportunities
      .filter((opp) => {
        if (!scoreMap.has(opp.id)) return true;
        const computedAt = scoreMap.get(opp.id);
        if (!computedAt) return true;
        return new Date(computedAt) < staleThreshold;
      })
      .slice(0, MAX_PER_RUN);
  }

  private async loadOrgProfile(): Promise<OrgProfile | null> {
    const { data } = await this.supabase
      .from("organizations")
      .select("name, tax_status, mission_statement, service_area, target_population, annual_budget")
      .eq("id", this.orgId)
      .maybeSingle();
    return (data ?? null) as OrgProfile | null;
  }

  private async loadFunder(funderId: string | null): Promise<FunderRow | null> {
    if (!funderId) return null;
    const { data } = await this.supabase
      .from("funders")
      .select("name, category, geographic_focus, annual_giving_budget")
      .eq("id", funderId)
      .eq("organization_id", this.orgId)
      .maybeSingle();
    return (data ?? null) as FunderRow | null;
  }

  private async loadOpportunityFacts(opportunityId: string): Promise<OpportunityFacts | null> {
    const { data } = await this.supabase
      .from("opportunities")
      .select(
        "id, name, category, description, eligibility_requirements, geographic_restrictions, amount_min, amount_max, deadline, eligibility_score",
      )
      .eq("id", opportunityId)
      .eq("organization_id", this.orgId)
      .maybeSingle();
    return (data ?? null) as OpportunityFacts | null;
  }

  private async loadDigitalTwin(): Promise<DigitalTwinRow | null> {
    const { data } = await this.supabase
      .from("organizational_digital_twins")
      .select("mission, service_areas, twin_completeness_score, key_strengths, proven_narrative_patterns")
      .eq("organization_id", this.orgId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data ?? null) as DigitalTwinRow | null;
  }

  private async loadKnowledgeBaseCategories(): Promise<string[]> {
    const { data } = await this.supabase
      .from("knowledge_base")
      .select("category")
      .eq("organization_id", this.orgId);

    const categories = new Set<string>();
    for (const row of (data ?? []) as { category: string | null }[]) {
      if (row.category) categories.add(row.category);
    }
    return Array.from(categories);
  }

  private async loadCategoryOutcomeStats(
    category: string | null,
  ): Promise<CategoryOutcomeStats> {
    if (!category) return { count: 0, awardRate: null };
    const { data } = await this.supabase
      .from("outcomes")
      .select("result")
      .eq("organization_id", this.orgId)
      .eq("funder_category", category);
    const rows = (data ?? []) as { result: string }[];
    if (rows.length === 0) return { count: 0, awardRate: null };
    const awarded = rows.filter((r) => r.result === "awarded").length;
    return { count: rows.length, awardRate: awarded / rows.length };
  }

  /**
   * CALIBRATION QUERY: this org's award/denial outcomes over the last
   * CALIBRATION_LOOKBACK_DAYS days, joined back to whatever probability
   * score existed for that opportunity, to see whether this agent's own
   * past predictions ran hot (winners scored higher than losers, as they
   * should) or cold. outcomes has no opportunity_id column directly — it
   * only has application_id — so the join goes outcomes -> applications ->
   * opportunity_id -> opportunity_probability_scores, not the single-table
   * join a literal reading of the task's SQL sketch would suggest.
   */
  private async loadCalibrationSummary(): Promise<CalibrationSummary> {
    const empty: CalibrationSummary = {
      sampleSize: 0,
      avgAwardedScore: null,
      avgDeniedScore: null,
    };

    const cutoff = subDays(new Date(), CALIBRATION_LOOKBACK_DAYS).toISOString();

    const { data: outcomeRows, error: outcomeError } = await this.supabase
      .from("outcomes")
      .select("result, application_id")
      .eq("organization_id", this.orgId)
      .gte("created_at", cutoff);

    if (outcomeError || !outcomeRows || outcomeRows.length === 0) return empty;

    const typedOutcomes = outcomeRows as { result: string; application_id: string }[];
    const applicationIds = Array.from(new Set(typedOutcomes.map((r) => r.application_id)));

    const { data: appRows } = await this.supabase
      .from("applications")
      .select("id, opportunity_id")
      .eq("organization_id", this.orgId)
      .in("id", applicationIds);

    const appToOpp = new Map<string, string>();
    for (const row of (appRows ?? []) as { id: string; opportunity_id: string }[]) {
      appToOpp.set(row.id, row.opportunity_id);
    }

    const opportunityIds = Array.from(new Set(Array.from(appToOpp.values())));
    if (opportunityIds.length === 0) return empty;

    const { data: scoreRows } = await this.supabase
      .from("opportunity_probability_scores")
      .select("opportunity_id, overall_score")
      .eq("organization_id", this.orgId)
      .in("opportunity_id", opportunityIds);

    const oppToScore = new Map<string, number>();
    for (const row of (scoreRows ?? []) as {
      opportunity_id: string;
      overall_score: number | null;
    }[]) {
      if (row.overall_score != null) oppToScore.set(row.opportunity_id, row.overall_score);
    }

    const awardedScores: number[] = [];
    const deniedScores: number[] = [];
    for (const row of typedOutcomes) {
      const opportunityId = appToOpp.get(row.application_id);
      if (!opportunityId) continue;
      const score = oppToScore.get(opportunityId);
      if (score == null) continue;
      if (row.result === "awarded") awardedScores.push(score);
      else if (row.result === "denied") deniedScores.push(score);
    }

    const avg = (nums: number[]): number | null =>
      nums.length > 0 ? nums.reduce((sum, n) => sum + n, 0) / nums.length : null;

    return {
      sampleSize: awardedScores.length + deniedScores.length,
      avgAwardedScore: avg(awardedScores),
      avgDeniedScore: avg(deniedScores),
    };
  }

  /**
   * SCORE HISTORY / trend detection: reads this agent's own prior
   * agent_decisions rows for this opportunity (append-only — a new row is
   * logged every run, never overwritten) to detect whether the score is
   * improving, declining, or stable as the org's data improves over time.
   */
  private async loadScoreTrend(opportunityId: string): Promise<ScoreTrend> {
    const { data } = await this.supabase
      .from("agent_decisions")
      .select("confidence_score, created_at")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("decision_type", "probability_scored")
      .eq("entity_id", opportunityId)
      .order("created_at", { ascending: true })
      .limit(20);

    const rows = (data ?? []) as { confidence_score: number | null }[];
    const history = rows
      .map((r) => r.confidence_score)
      .filter((n): n is number => n != null);

    if (history.length < 2) {
      return { direction: "insufficient_data", history };
    }

    const first = history[0] as number;
    const last = history[history.length - 1] as number;
    const delta = last - first;
    const direction: ScoreTrend["direction"] =
      delta >= 5 ? "improving" : delta <= -5 ? "declining" : "stable";

    return { direction, history };
  }

  private countAvailableFactors(args: {
    org: OrgProfile;
    funder: FunderRow | null;
    opportunity: OpportunityFacts;
    twin: DigitalTwinRow | null;
    kbCategories: string[];
    categoryStats: CategoryOutcomeStats;
  }): number {
    const { org, funder, opportunity, twin, kbCategories, categoryStats } = args;
    let count = 0;

    if (opportunity.category != null && org.mission_statement != null) count++;

    const hasGeoRestriction =
      opportunity.geographic_restrictions != null || funder?.geographic_focus != null;
    const hasOrgServiceArea =
      org.service_area != null || (twin?.service_areas?.length ?? 0) > 0;
    if (hasGeoRestriction && hasOrgServiceArea) count++;

    const hasAmountRange = opportunity.amount_min != null || opportunity.amount_max != null;
    if (hasAmountRange && org.annual_budget != null) count++;

    if (categoryStats.count > 0) count++;

    if ((twin?.mission != null) || kbCategories.length > 0) count++;

    return count;
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    const nextActions: string[] = [];
    let tokensUsed = 0;
    let scored = 0;
    let draftQueued = 0;
    let fundabilityQueued = 0;
    const lowProbabilityNames: string[] = [];

    try {
      const scope = (
        triggerSource === "chain"
          ? await this.loadChainScope()
          : await this.loadDefaultScope()
      ).slice(0, MAX_PER_RUN);

      const [org, twin, kbCategories, calibration, config] = await Promise.all([
        this.loadOrgProfile(),
        this.loadDigitalTwin(),
        this.loadKnowledgeBaseCategories(),
        this.loadCalibrationSummary(),
        this.getOrgConfig(),
      ]);

      if (!org) throw new Error(`Could not load organization ${this.orgId}.`);

      for (const opp of scope) {
        try {
          // Deterministic baseline — still the grounding signal fed into the
          // calibrated Claude pass, and still persisted immediately so a
          // Claude failure below degrades to a usable score rather than none.
          const baseline = await computeGrantProbability(opp.id, this.orgId, this.supabase);

          const [opportunity, funder, trend] = await Promise.all([
            this.loadOpportunityFacts(opp.id),
            this.loadFunder(opp.funder_id),
            this.loadScoreTrend(opp.id),
          ]);

          if (!opportunity) {
            errors.push(`Opportunity ${opp.id} not found or not in this org — skipped.`);
            continue;
          }

          const realCategoryStats = await this.loadCategoryOutcomeStats(opportunity.category);

          const { system, prompt } = buildCalibratedPrompt({
            org,
            funder,
            opportunity,
            baseline,
            twin,
            kbCategories,
            categoryStats: realCategoryStats,
            calibration,
            trend,
          });

          const response = await callClaude({
            system,
            prompt,
            model: DEFAULT_MODEL,
            maxTokens: MAX_TOKENS,
          });
          tokensUsed += response.usage.totalTokens;

          const parsed = parseCalibratedResponse(response.text);
          scored++;

          const weighted =
            FACTOR_WEIGHTS.ntee_alignment * parsed.factorScores.ntee_alignment +
            FACTOR_WEIGHTS.geographic_eligibility * parsed.factorScores.geographic_eligibility +
            FACTOR_WEIGHTS.financial_capacity_match *
              parsed.factorScores.financial_capacity_match +
            FACTOR_WEIGHTS.track_record * parsed.factorScores.track_record +
            FACTOR_WEIGHTS.program_fit * parsed.factorScores.program_fit;
          const overallScore = Math.max(0, Math.min(100, Math.round(weighted)));

          const availableFactorCount = this.countAvailableFactors({
            org,
            funder,
            opportunity,
            twin,
            kbCategories,
            categoryStats: realCategoryStats,
          });
          // Deterministic band overrides whatever band Claude claimed — a
          // model asserting "high" confidence off two known facts is not
          // trustworthy about its own data completeness.
          const confidenceBand = bandFromDataAvailability(availableFactorCount);

          const rubricLabel = deriveRubricLabel(overallScore);
          const legacyRecommendation = deriveLegacyRecommendation(overallScore);

          const keyRisks = mergeUnique(parsed.keyRisks, baseline.key_risks, 6);
          const keyStrengths = mergeUnique(parsed.keyStrengths, baseline.key_strengths, 6);

          const recommendationText =
            parsed.recommendationText ||
            `${rubricLabel === "strong_apply" ? "Strong apply" : rubricLabel === "apply" ? "Apply" : rubricLabel === "review" ? "Review" : "Likely pass"} — ` +
              `calibrated score ${overallScore}/100 from NTEE/mission fit ${parsed.factorScores.ntee_alignment}, ` +
              `geographic eligibility ${parsed.factorScores.geographic_eligibility}, financial capacity match ` +
              `${parsed.factorScores.financial_capacity_match}, track record ${parsed.factorScores.track_record}, ` +
              `and program fit ${parsed.factorScores.program_fit}.`;

          const factors: GrantProbabilityFactor[] = [
            {
              name: "ntee_alignment",
              weight: FACTOR_WEIGHTS.ntee_alignment,
              value: parsed.factorScores.ntee_alignment / 100,
              contribution: FACTOR_WEIGHTS.ntee_alignment * parsed.factorScores.ntee_alignment,
            },
            {
              name: "geographic_eligibility",
              weight: FACTOR_WEIGHTS.geographic_eligibility,
              value: parsed.factorScores.geographic_eligibility / 100,
              contribution:
                FACTOR_WEIGHTS.geographic_eligibility * parsed.factorScores.geographic_eligibility,
            },
            {
              name: "financial_capacity_match",
              weight: FACTOR_WEIGHTS.financial_capacity_match,
              value: parsed.factorScores.financial_capacity_match / 100,
              contribution:
                FACTOR_WEIGHTS.financial_capacity_match *
                parsed.factorScores.financial_capacity_match,
            },
            {
              name: "track_record",
              weight: FACTOR_WEIGHTS.track_record,
              value: parsed.factorScores.track_record / 100,
              contribution: FACTOR_WEIGHTS.track_record * parsed.factorScores.track_record,
            },
            {
              name: "program_fit",
              weight: FACTOR_WEIGHTS.program_fit,
              value: parsed.factorScores.program_fit / 100,
              contribution: FACTOR_WEIGHTS.program_fit * parsed.factorScores.program_fit,
            },
          ];

          const { error: upsertError } = await this.supabase
            .from("opportunity_probability_scores")
            .upsert(
              {
                opportunity_id: opp.id,
                organization_id: this.orgId,
                overall_score: overallScore,
                confidence: confidenceBand,
                factors,
                recommendation: legacyRecommendation,
                key_risks: keyRisks,
                key_strengths: keyStrengths,
                estimated_roi: baseline.estimated_roi,
                time_to_complete: baseline.time_to_complete,
                computed_at: new Date().toISOString(),
              },
              { onConflict: "opportunity_id,organization_id" },
            );

          if (upsertError) {
            errors.push(
              `Failed to persist calibrated score for "${opportunity.name}": ${upsertError.message}`,
            );
            continue;
          }

          const name = opportunity.name;
          const decisionId = await this.logDecision({
            decisionType: "probability_scored",
            agentRunId: runId,
            entityType: "opportunity",
            entityId: opp.id,
            reasoning:
              `Calibrated score for "${name}": ${overallScore}/100 (${rubricLabel}, ` +
              `${confidenceBand} confidence from ${availableFactorCount}/5 factors with real data). ` +
              `${recommendationText} ` +
              `Score trend: ${trend.direction}.`,
            confidenceScore: overallScore,
            actionTaken: "upserted_calibrated_probability_score",
            actionPayload: {
              factor_scores: parsed.factorScores,
              model_claimed_band: parsed.confidenceBand,
              deterministic_band: confidenceBand,
              rubric_label: rubricLabel,
              legacy_recommendation: legacyRecommendation,
              baseline_score: baseline.score,
              calibration_sample_size: calibration.sampleSize,
            },
          });
          decisions.push(decisionId);

          // CHAIN DECISION — three disjoint bands, independent of the
          // rubric label thresholds above (task-mandated 80/65-79/<45).
          if (overallScore >= 80) {
            if (config.auto_draft_enabled && overallScore >= config.auto_draft_threshold) {
              await this.queueChainedAgent("ag-05-draft", 8, {
                opportunityId: opp.id,
                score: overallScore,
                title: name,
                funderId: opp.funder_id,
              });
              draftQueued++;
              nextActions.push("ag-05-draft");
            }
          } else if (overallScore >= 65) {
            await this.queueChainedAgent("ag-29-fundability", 9, {
              opportunityIds: [opp.id],
            });
            fundabilityQueued++;
            nextActions.push("ag-29-fundability");
          } else if (overallScore < 45) {
            lowProbabilityNames.push(`${name} (${overallScore}/100)`);
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to score opportunity.";
          errors.push(`opportunity ${opp.id}: ${message}`);
        }
      }

      if (lowProbabilityNames.length > 0) {
        const shown = lowProbabilityNames.slice(0, 5).join(", ");
        const extra =
          lowProbabilityNames.length > 5 ? ` and ${lowProbabilityNames.length - 5} more` : "";
        await this.createNotification(
          "low_probability",
          "Low probability — consider skipping",
          `${shown}${extra}`,
        );
      }

      const itemsQueued = draftQueued + fundabilityQueued;

      await this.completeRun(runId, {
        outputSummary: JSON.stringify({
          scored,
          draftQueued,
          fundabilityQueued,
          lowProbabilityCount: lowProbabilityNames.length,
        }),
        itemsFound: scope.length,
        itemsProcessed: scored,
        itemsQueued,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: scope.length,
        itemsProcessed: scored,
        itemsQueued,
        decisions,
        nextActions,
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Probability scoring failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: scored,
        itemsQueued: draftQueued + fundabilityQueued,
        decisions,
        nextActions,
        errors: [...errors, message],
      };
    }
  }
}
