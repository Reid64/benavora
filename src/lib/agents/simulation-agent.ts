// AG-37 Simulation Agent (AutonomousAgent, migration 080 infrastructure +
// migration 085_fundraising_simulator.sql substrate: simulation_scenarios).
// AUTONOMOUS_PLATFORM_VISION.md Phase 4, "Predictive Fundraising Simulator":
// what-if modeling (board expansion, staff hire, geographic expansion, new
// program, budget increase, partnership) projecting a proper 3-year
// financial model, not single-number estimates, so a board can evaluate an
// option before committing to it. Read-only projection - never writes to
// live financial/pipeline data, matching AG-28 (Impact Simulation Agent)'s
// own hard limit that "a simulation is read-only by definition."
//
// Numbering + schema conflict, not resolved here - see migration
// 085_fundraising_simulator.sql's header for the full citation trail.
// Short version: AGENTS_v2.md/BLUEPRINT_v2.md/AUTONOMOUS_PLATFORM_VISION.md
// all describe this exact feature as extending AG-28 and the existing
// `impact_simulations` table (migration 078_forecast_board.sql), not a new
// agent/table pair. This file uses the disambiguated literal
// "ag-37-simulation" (not a bare "ag-37") because AUTONOMOUS_PLATFORM_VISION.md
// separately uses "AG-37" for an unrelated agent (Autonomous Multi-Agent
// Negotiation, extending AG-12/AutoApply) - same convention
// learning-network-aggregator-agent.ts already used for "ag-36-learning-network"
// to avoid colliding with a differently-scoped bare "ag-36".
//
// Input contract: unlike a pure nightly-sweep agent, this agent needs a
// specific scenarioType + variables per invocation. AutonomousAgent's `run()`
// signature only takes `triggerSource` (src/lib/agents/autonomous-base.ts) -
// there is no direct-call input parameter anywhere in this base class. The
// established convention for this (see ProbabilityScoringAgent's
// loadChainScope() in probability-scoring-agent.ts) is to read the
// `agent_queue` row the queue processor marked "processing" for this
// (org_id, agent_id) pair and pull the scenario spec out of its
// input_payload - this file follows that same pattern rather than inventing
// a new calling convention.
//
// Enterprise hardening pass (this file): replaces the old flat
// { projected_revenue_increase, year_1: number, ... } projection with a
// proper 3-year model (revenue/grant-count/cost/net-benefit per year),
// calibrates every run against the org's own outcome history and cross-org
// platform_learning_patterns, computes scenario-specific baseline data per
// scenario type, compares against the org's most recent prior simulation of
// the same type, and validates every Claude response before writing it -
// retrying up to twice on validation failure rather than persisting a
// malformed projection.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import { MIN_OUTCOMES_FOR_RATE } from "@/lib/utils/constants";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

const SCENARIO_TYPES = [
  "board_expansion",
  "staff_hire",
  "geographic_expansion",
  "new_program",
  "budget_increase",
  "partnership",
] as const;
type ScenarioType = (typeof SCENARIO_TYPES)[number];

const MAX_TOKENS = 2200;
/** Cross-org context signal only - never treated as this org's own history. */
const MAX_LEARNING_PATTERNS = 5;
const MIN_PATTERN_SAMPLE_COUNT = 3;
/** Total attempts = 1 initial call + this many retries, per task spec
 * ("max 2 retries"). A validation failure re-prompts Claude with the exact
 * reasons the prior response was rejected rather than silently retrying
 * blind. */
const MAX_VALIDATION_RETRIES = 2;
const MIN_PAYBACK_MONTHS = 1;
const MAX_PAYBACK_MONTHS = 120;

interface ScenarioInput {
  scenarioType: ScenarioType;
  variables: Record<string, unknown>;
  scenarioName?: string;
}

interface OrgStateRow {
  name: string | null;
  mission_statement: string | null;
  annual_budget: number | null;
  total_staff: number | null;
  total_volunteers: number | null;
  service_area: string | null;
}

interface OrgCurrentState {
  orgName: string | null;
  missionStatement: string | null;
  annualBudget: number | null;
  numStaff: number | null;
  numVolunteers: number | null;
  serviceArea: string | null;
  numBoardMembers: number;
  programsCount: number | null;
  currentSuccessRate: number | null;
  successRateSampleSize: number;
  /** Historical calibration (task requirement #2): average realized award
   * size and average opportunity probability score on file for this org,
   * used as the Claude prompt's baseline rather than letting it invent an
   * industry-average figure. Null means insufficient real data, never a
   * fabricated placeholder. */
  avgAwardedAmount: number | null;
  avgProbabilityScore: number | null;
}

interface LearningPatternRow {
  pattern_type: string;
  funder_category: string | null;
  pattern_content: string;
  success_rate: number | null;
  sample_count: number;
}

/** Scenario-specific baseline context (task requirement #3). Deliberately a
 * loose Record rather than one interface per scenario type - each scenario
 * populates only the fields it can compute from real columns, and the
 * per-scenario loaders below document exactly which fields are real vs.
 * approximate rather than fabricating parity across scenario types. */
type ScenarioBaseline = Record<string, unknown>;

interface PreviousSimulationSummary {
  scenarioName: string;
  generatedAt: string;
  roiMultiple: number | null;
  probabilityImprovement: number | null;
  confidence: string | null;
}

interface YearProjection {
  revenue_increase: number;
  grant_count_increase: number;
  cost: number;
  net_benefit: number;
}

interface RiskFactor {
  factor: string;
  probability: number;
  mitigation: string;
}

interface SimulationProjection {
  year_1: YearProjection;
  year_2: YearProjection;
  year_3: YearProjection;
  cumulative_roi: number;
  payback_months: number;
  probability_improvement: number;
  risk_factors: RiskFactor[];
  assumptions: string[];
  confidence: "high" | "medium" | "low";
  confidence_reasoning: string;
}

function isScenarioType(value: unknown): value is ScenarioType {
  return (
    typeof value === "string" &&
    (SCENARIO_TYPES as readonly string[]).includes(value)
  );
}

function confidenceToScore(confidence: SimulationProjection["confidence"]): number {
  if (confidence === "high") return 85;
  if (confidence === "medium") return 65;
  return 40;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, n) => sum + n, 0) / values.length).toFixed(2));
}

/** Best-effort JSON extraction - Claude is asked for JSON-only output but
 * models occasionally wrap it in prose or a markdown fence. Mirrors the
 * parse-then-regex-fallback convention in learning-network-aggregator-agent.ts. */
function parseProjectionJson(text: string): SimulationProjection {
  const tryParse = (candidate: string): SimulationProjection | null => {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return parsed as SimulationProjection;
      }
    } catch {
      // fall through to caller
    }
    return null;
  };

  const direct = tryParse(text.trim());
  if (direct) return direct;

  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    const fromMatch = tryParse(match[0]);
    if (fromMatch) return fromMatch;
  }

  throw new Error("Claude did not return parseable simulation JSON.");
}

/** Validates one year's projection object, pushing every problem found into
 * `errors` (rather than failing fast) so a single retry prompt can list every
 * defect at once. revenue_increase/grant_count_increase/cost are magnitudes
 * and must be non-negative; net_benefit is deliberately NOT required to be
 * non-negative - revenue_increase minus cost is expected to be negative in
 * early years, which is exactly what payback_months measures. Requiring
 * every "year projection" field to be positive (a literal reading of task
 * requirement #6) would make the schema self-contradictory, so this
 * validator applies "positive" to the magnitude fields only. */
function validateYearProjection(
  year: unknown,
  label: string,
  errors: string[],
): void {
  if (!year || typeof year !== "object") {
    errors.push(`${label} is missing or not an object.`);
    return;
  }
  const y = year as Record<string, unknown>;

  if (!isFiniteNumber(y.revenue_increase) || y.revenue_increase < 0) {
    errors.push(`${label}.revenue_increase must be a non-negative number.`);
  }
  if (!isFiniteNumber(y.grant_count_increase) || y.grant_count_increase < 0) {
    errors.push(`${label}.grant_count_increase must be a non-negative number.`);
  }
  if (!isFiniteNumber(y.cost) || y.cost < 0) {
    errors.push(`${label}.cost must be a non-negative number.`);
  }
  if (!isFiniteNumber(y.net_benefit)) {
    errors.push(`${label}.net_benefit must be a finite number.`);
  }
}

/** Full-projection validator (task requirement #6). Returns an empty array
 * when the projection is acceptable; otherwise every defect found, which the
 * caller feeds back into a retry prompt. */
function validateProjection(projection: SimulationProjection): string[] {
  const errors: string[] = [];

  validateYearProjection(projection.year_1, "year_1", errors);
  validateYearProjection(projection.year_2, "year_2", errors);
  validateYearProjection(projection.year_3, "year_3", errors);

  if (!isFiniteNumber(projection.cumulative_roi) || projection.cumulative_roi <= 0) {
    errors.push("cumulative_roi must be a number greater than 0.");
  }
  if (
    !isFiniteNumber(projection.payback_months) ||
    projection.payback_months < MIN_PAYBACK_MONTHS ||
    projection.payback_months > MAX_PAYBACK_MONTHS
  ) {
    errors.push(
      `payback_months must be a number between ${MIN_PAYBACK_MONTHS} and ${MAX_PAYBACK_MONTHS}.`,
    );
  }
  if (!isFiniteNumber(projection.probability_improvement)) {
    errors.push("probability_improvement must be a finite number.");
  }

  if (!Array.isArray(projection.risk_factors)) {
    errors.push("risk_factors must be an array.");
  } else {
    projection.risk_factors.forEach((rf, i) => {
      if (!rf || typeof rf !== "object") {
        errors.push(`risk_factors[${i}] is not an object.`);
        return;
      }
      const r = rf as unknown as Record<string, unknown>;
      if (typeof r.factor !== "string" || r.factor.trim().length === 0) {
        errors.push(`risk_factors[${i}].factor must be a non-empty string.`);
      }
      if (!isFiniteNumber(r.probability)) {
        errors.push(`risk_factors[${i}].probability must be a finite number.`);
      }
      if (typeof r.mitigation !== "string" || r.mitigation.trim().length === 0) {
        errors.push(`risk_factors[${i}].mitigation must be a non-empty string.`);
      }
    });
  }

  if (
    !Array.isArray(projection.assumptions) ||
    projection.assumptions.some((a) => typeof a !== "string")
  ) {
    errors.push("assumptions must be an array of strings.");
  }

  if (!["high", "medium", "low"].includes(projection.confidence)) {
    errors.push('confidence must be "high", "medium", or "low".');
  }
  if (
    typeof projection.confidence_reasoning !== "string" ||
    projection.confidence_reasoning.trim().length === 0
  ) {
    errors.push("confidence_reasoning must be a non-empty string.");
  }

  return errors;
}

export class SimulationAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-37-simulation", supabase);
  }

  /** Reads the agent_queue row the queue processor marked "processing" for
   * this (org_id, agent_id) pair and pulls the scenario spec out of its
   * input_payload. Throws if no scenarioType is present - there is no
   * meaningful default scenario to fall back to. */
  private async loadScenarioInput(): Promise<ScenarioInput> {
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
      scenarioType?: unknown;
      variables?: unknown;
      scenarioName?: unknown;
    };

    if (!isScenarioType(payload.scenarioType)) {
      throw new Error(
        "No valid scenarioType in agent_queue.input_payload - expected one " +
          `of: ${SCENARIO_TYPES.join(", ")}.`,
      );
    }

    const variables =
      payload.variables && typeof payload.variables === "object"
        ? (payload.variables as Record<string, unknown>)
        : {};

    return {
      scenarioType: payload.scenarioType,
      variables,
      scenarioName:
        typeof payload.scenarioName === "string"
          ? payload.scenarioName
          : undefined,
    };
  }

  /** Loads the org's current operating state plus historical calibration
   * (task requirement #2: average realized award size, average opportunity
   * probability score on file). Every field is nullable/defensive rather
   * than assumed present - never fabricates a value it can't find
   * (AGENTS_v2.md's repeated "never fabricates a field it can't extract"
   * convention). */
  private async loadOrgCurrentState(): Promise<OrgCurrentState> {
    const { data: orgRow, error: orgError } = await this.supabase
      .from("organizations")
      .select(
        "name, mission_statement, annual_budget, total_staff, total_volunteers, service_area",
      )
      .eq("id", this.orgId)
      .maybeSingle();

    if (orgError) {
      throw new Error(`Failed to load organization: ${orgError.message}`);
    }
    const org = (orgRow ?? null) as OrgStateRow | null;

    const { count: boardCount } = await this.supabase
      .from("board_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", this.orgId)
      .eq("is_active", true);

    // organizational_digital_twins is not present in the generated database
    // types (known staleness - see project memory on database.ts lagging
    // migration 080); queried defensively and never treated as required.
    const { data: twinRow } = await this.supabase
      .from("organizational_digital_twins")
      .select("programs")
      .eq("org_id", this.orgId)
      .maybeSingle();
    const programsCount = Array.isArray(
      (twinRow as { programs?: unknown } | null)?.programs,
    )
      ? ((twinRow as { programs: unknown[] }).programs.length)
      : null;

    const { data: outcomeRows } = await this.supabase
      .from("outcomes")
      .select("result, awarded_amount")
      .eq("organization_id", this.orgId);
    const outcomes = (outcomeRows ?? []) as Array<{
      result: string;
      awarded_amount: number | null;
    }>;
    const awardedOrPartial = outcomes.filter(
      (o) => o.result === "awarded" || o.result === "partial",
    );
    const awardedCount = outcomes.filter((o) => o.result === "awarded").length;
    // Below MIN_OUTCOMES_FOR_RATE, a success rate is statistically
    // meaningless - report null ("insufficient data") rather than a
    // misleading precise-looking number, per the same threshold AG-04 (Fit
    // Analysis Agent) uses for its own category success rate.
    const currentSuccessRate =
      outcomes.length >= MIN_OUTCOMES_FOR_RATE
        ? Number((awardedCount / outcomes.length).toFixed(3))
        : null;
    const avgAwardedAmount = average(
      awardedOrPartial
        .map((o) => o.awarded_amount)
        .filter((n): n is number => typeof n === "number"),
    );

    // opportunity_probability_scores.organization_id (NOT org_id, despite
    // SCHEMA_REGISTRY_v2.md's stale table-50 description - see migration
    // 093_digital_twins.sql). Used as the real substitute for the task's
    // literal "AVG(probability_score) FROM outcomes" pseudocode, since
    // outcomes itself has no probability_score column.
    const { data: scoreRows } = await this.supabase
      .from("opportunity_probability_scores")
      .select("overall_score")
      .eq("organization_id", this.orgId);
    const avgProbabilityScore = average(
      (scoreRows ?? [])
        .map((r: { overall_score: number | null }) => r.overall_score)
        .filter((n): n is number => typeof n === "number"),
    );

    return {
      orgName: org?.name ?? null,
      missionStatement: org?.mission_statement ?? null,
      annualBudget: org?.annual_budget ?? null,
      numStaff: org?.total_staff ?? null,
      numVolunteers: org?.total_volunteers ?? null,
      serviceArea: org?.service_area ?? null,
      numBoardMembers: boardCount ?? 0,
      programsCount,
      currentSuccessRate,
      successRateSampleSize: outcomes.length,
      avgAwardedAmount,
      avgProbabilityScore,
    };
  }

  /** Most common funder_category among this org's own outcomes, used only
   * to scope which cross-org platform_learning_patterns rows are relevant
   * context - never the org's own private outcome content. Note:
   * organizations has no ntee_code column on the live schema (unlike the
   * task's literal instruction to scope by "org's NTEE code") - funder
   * category is the closest real substitute already established by this
   * file, so it's kept rather than fabricating an ntee_code lookup against a
   * column that doesn't exist. */
  private async loadDominantFunderCategory(): Promise<string | null> {
    const { data } = await this.supabase
      .from("outcomes")
      .select("funder_category")
      .eq("organization_id", this.orgId)
      .not("funder_category", "is", null);

    const categories = (data ?? [])
      .map((r: { funder_category: string | null }) => r.funder_category)
      .filter((c): c is string => Boolean(c));
    if (categories.length === 0) return null;

    const freq = new Map<string, number>();
    for (const c of categories) freq.set(c, (freq.get(c) ?? 0) + 1);

    let topCategory: string | null = null;
    let topCount = 0;
    for (const [category, count] of freq.entries()) {
      if (count > topCount) {
        topCategory = category;
        topCount = count;
      }
    }
    return topCategory;
  }

  /** Cross-org anonymized pattern context (AG-36's platform_learning_patterns,
   * migration 083). Purely additive signal for Claude's prompt - absence of
   * any matching pattern is not an error, just less context. Injected into
   * the prompt only when sample_count >= MIN_PATTERN_SAMPLE_COUNT (task
   * requirement #4's ">= 5" threshold on the org's own patterns doesn't
   * apply here directly since these rows are cross-org, not a single org's;
   * MIN_PATTERN_SAMPLE_COUNT stays at 3, this file's pre-existing threshold,
   * and the query still caps at MAX_LEARNING_PATTERNS highest-sample rows). */
  private async loadLearningPatterns(
    funderCategory: string | null,
  ): Promise<LearningPatternRow[]> {
    let query = this.supabase
      .from("platform_learning_patterns")
      .select("pattern_type, funder_category, pattern_content, success_rate, sample_count")
      .gte("sample_count", MIN_PATTERN_SAMPLE_COUNT)
      .order("sample_count", { ascending: false })
      .limit(MAX_LEARNING_PATTERNS);

    if (funderCategory) {
      query = query.eq("funder_category", funderCategory);
    }

    const { data } = await query;
    return (data ?? []) as LearningPatternRow[];
  }

  /** Scenario-specific baseline data (task requirement #3). Dispatches to a
   * per-scenario-type loader, each of which only queries columns that
   * genuinely exist on the live schema - see each loader's own comment for
   * what it approximates vs. what it can compute exactly. */
  private async loadScenarioBaseline(
    scenario: ScenarioInput,
    state: OrgCurrentState,
  ): Promise<ScenarioBaseline> {
    switch (scenario.scenarioType) {
      case "board_expansion":
        return this.loadBoardExpansionBaseline(state);
      case "staff_hire":
        return this.loadStaffHireBaseline();
      case "geographic_expansion":
        return this.loadGeographicExpansionBaseline(scenario.variables);
      case "new_program":
        return this.loadNewProgramBaseline();
      case "budget_increase":
        return this.loadBudgetIncreaseBaseline(scenario.variables, state);
      case "partnership":
        // No scenario-specific query was specified for this type - the
        // general org state + cross-org patterns already loaded are the
        // only baseline context for it.
        return {};
      default:
        return {};
    }
  }

  /** board_members (migration 001) has only name/title/bio/email/phone/
   * start_date/is_active - no sector/expertise/committee columns exist on
   * the live schema (unlike SCHEMA_REGISTRY_v2.md's stale table-64
   * description). "Sector coverage gaps" therefore can't be computed from
   * real data; this baseline reports the real active count only and lets
   * the requested expectedSectors (scenario.variables, passed through to
   * the prompt separately) carry the qualitative gap instead of a
   * fabricated calculation. */
  private loadBoardExpansionBaseline(state: OrgCurrentState): ScenarioBaseline {
    return {
      currentActiveBoardMembers: state.numBoardMembers,
    };
  }

  /** Grant-writer capacity proxy: applications created by this org in the
   * last 90 days, i.e. "applications per quarter" at current staffing. */
  private async loadStaffHireBaseline(): Promise<ScenarioBaseline> {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { count: recentApplicationCount } = await this.supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", this.orgId)
      .gte("created_at", ninetyDaysAgo.toISOString());

    return {
      currentApplicationsPerQuarter: recentApplicationCount ?? 0,
    };
  }

  /** New prospect pool size estimate: count of foundation_directory records
   * in the target state, parsed from the user-entered "City, ST" location
   * string. Returns nulls (rather than guessing a state) when no two-letter
   * state code is present in the input. */
  private async loadGeographicExpansionBaseline(
    variables: Record<string, unknown>,
  ): Promise<ScenarioBaseline> {
    const targetLocation =
      typeof variables.targetLocation === "string" ? variables.targetLocation : null;
    const stateMatch = targetLocation?.match(/\b([A-Z]{2})\b/);
    const targetState = stateMatch ? stateMatch[1] : null;

    if (!targetState) {
      return { targetState: null, foundationsInTargetState: null };
    }

    const { count: foundationCount } = await this.supabase
      .from("foundation_directory")
      .select("id", { count: "exact", head: true })
      .eq("state", targetState);

    return {
      targetState,
      foundationsInTargetState: foundationCount ?? 0,
    };
  }

  /** No text->NTEE classifier exists anywhere in this codebase (would
   * require an NLP mapping step that isn't built - see AGENTS_v2.md §5's
   * AG-10/AG-29 PLANNED status for the closest unbuilt analogs), so this
   * baseline can't calculate a program-type-specific "newly eligible funder
   * universe size" the way the task literally describes. It instead reports
   * the total size of the foundation universe that has an NTEE code on file
   * at all, as context for Claude's own qualitative NTEE-alignment
   * reasoning, rather than fabricating a specific-code match. */
  private async loadNewProgramBaseline(): Promise<ScenarioBaseline> {
    const { count: nteeFoundationCount } = await this.supabase
      .from("foundation_directory")
      .select("id", { count: "exact", head: true })
      .not("ntee_code", "is", null);

    return {
      foundationsWithNteeCodeOnFile: nteeFoundationCount ?? 0,
    };
  }

  /** opportunities has no explicit "minimum org budget required" column, so
   * amount_min (the grant program's own award floor) is used as a proxy for
   * program scale - larger amount_min values correlate informally with
   * funders that expect a larger recipient budget, but this is an
   * approximation, not an exact eligibility rule, and is labeled as such in
   * the prompt. */
  private async loadBudgetIncreaseBaseline(
    variables: Record<string, unknown>,
    state: OrgCurrentState,
  ): Promise<ScenarioBaseline> {
    const percent =
      typeof variables.budgetIncreasePercent === "number"
        ? variables.budgetIncreasePercent
        : null;
    const currentBudget = state.annualBudget;

    if (currentBudget == null || percent == null) {
      return {
        currentBudget,
        proposedBudget: null,
        newlyEligibleOpportunitiesByAwardFloor: null,
      };
    }

    const proposedBudget = Number((currentBudget * (1 + percent / 100)).toFixed(2));

    const { count: newlyEligibleCount } = await this.supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", this.orgId)
      .gt("amount_min", currentBudget)
      .lte("amount_min", proposedBudget);

    return {
      currentBudget,
      proposedBudget,
      newlyEligibleOpportunitiesByAwardFloor: newlyEligibleCount ?? 0,
    };
  }

  /** Task requirement #5: if this org has a previous simulation of the same
   * scenario type, surface it so Claude can calibrate against it explicitly
   * rather than projecting in a vacuum. Note: simulation_scenarios has no
   * column linking a projection back to a realized, actual outcome (it is a
   * hypothetical what-if, not a decision this agent tracks through to
   * completion) - so this compares against the prior *projection*, not an
   * "actual outcome," despite the task's phrasing implying the latter. That
   * gap is disclosed here rather than fabricating an outcome-tracking join
   * that doesn't exist on this schema. */
  private async loadPreviousSimulation(
    scenarioType: ScenarioType,
  ): Promise<PreviousSimulationSummary | null> {
    const { data } = await this.supabase
      .from("simulation_scenarios")
      .select("scenario_name, generated_at, roi_multiple, probability_improvement, confidence")
      .eq("org_id", this.orgId)
      .eq("scenario_type", scenarioType)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    const row = data as {
      scenario_name: string;
      generated_at: string;
      roi_multiple: number | null;
      probability_improvement: number | null;
      confidence: string | null;
    };

    return {
      scenarioName: row.scenario_name,
      generatedAt: row.generated_at,
      roiMultiple: row.roi_multiple,
      probabilityImprovement: row.probability_improvement,
      confidence: row.confidence,
    };
  }

  private buildPrompt(
    scenario: ScenarioInput,
    state: OrgCurrentState,
    patterns: LearningPatternRow[],
    scenarioBaseline: ScenarioBaseline,
    previousSimulation: PreviousSimulationSummary | null,
  ): { system: string; prompt: string } {
    const system =
      "You are a nonprofit financial modeling expert. Return JSON only, no " +
      "prose, no markdown fences, matching exactly this shape: " +
      '{ "year_1": {"revenue_increase": number, "grant_count_increase": number, ' +
      '"cost": number, "net_benefit": number}, "year_2": {same shape}, ' +
      '"year_3": {same shape}, "cumulative_roi": number, "payback_months": number, ' +
      '"probability_improvement": number, "risk_factors": [{"factor": string, ' +
      '"probability": number, "mitigation": string}], "assumptions": string[], ' +
      '"confidence": "high"|"medium"|"low", "confidence_reasoning": string }. ' +
      "revenue_increase, grant_count_increase, and cost must be non-negative " +
      "numbers for every year. net_benefit is revenue_increase minus cost for " +
      "that year and may be negative in year 1 before payback. cumulative_roi " +
      "must be greater than 0. payback_months must be a whole number between " +
      `${MIN_PAYBACK_MONTHS} and ${MAX_PAYBACK_MONTHS}.`;

    const orgStateLines = [
      `Organization: ${state.orgName ?? "unknown"}`,
      `Mission: ${state.missionStatement ?? "not on file"}`,
      `Annual budget: ${state.annualBudget != null ? `$${state.annualBudget}` : "unknown"}`,
      `Staff: ${state.numStaff ?? "unknown"}, Volunteers: ${state.numVolunteers ?? "unknown"}`,
      `Board members (active): ${state.numBoardMembers}`,
      `Programs: ${state.programsCount ?? "unknown"}`,
      `Service area: ${state.serviceArea ?? "unknown"}`,
      state.currentSuccessRate != null
        ? `Current grant success rate: ${Math.round(state.currentSuccessRate * 100)}% (n=${state.successRateSampleSize})`
        : `Current grant success rate: insufficient data (n=${state.successRateSampleSize}, need ${MIN_OUTCOMES_FOR_RATE}+)`,
      state.avgAwardedAmount != null
        ? `Average realized award amount on file: $${state.avgAwardedAmount}`
        : "Average realized award amount on file: insufficient data",
      state.avgProbabilityScore != null
        ? `Average opportunity probability score on file: ${state.avgProbabilityScore}/100`
        : "Average opportunity probability score on file: insufficient data",
    ].join("\n");

    const patternLines =
      patterns.length > 0
        ? patterns
            .map(
              (p) =>
                `- [${p.pattern_type}${p.funder_category ? `, ${p.funder_category}` : ""}] ` +
                `${p.pattern_content} (sample_count=${p.sample_count}${
                  p.success_rate != null ? `, confidence_proxy=${p.success_rate}` : ""
                })`,
            )
            .join("\n")
        : "No cross-org platform learning patterns available for this funder category yet.";

    const baselineEntries = Object.entries(scenarioBaseline);
    const baselineLines =
      baselineEntries.length > 0
        ? baselineEntries.map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`).join("\n")
        : "No scenario-specific baseline data available.";

    const previousSimulationLines = previousSimulation
      ? [
          `A previous "${scenario.scenarioType}" simulation ("${previousSimulation.scenarioName}", ` +
            `generated ${previousSimulation.generatedAt}) projected ` +
            `${previousSimulation.roiMultiple != null ? `${previousSimulation.roiMultiple}x cumulative ROI` : "no ROI figure"} ` +
            `and ${previousSimulation.probabilityImprovement != null ? `+${previousSimulation.probabilityImprovement}% probability improvement` : "no probability improvement figure"} ` +
            `at ${previousSimulation.confidence ?? "unknown"} confidence. Note: this is the prior ` +
            "projection, not a realized outcome - this system does not yet track a simulation " +
            "through to an actual result. If your new projection differs meaningfully from it, " +
            "say why in confidence_reasoning.",
        ].join("\n")
      : "No previous simulation of this scenario type exists for this organization.";

    const prompt = [
      "Current organization state (historical calibration baseline):",
      orgStateLines,
      "",
      `Scenario type: ${scenario.scenarioType}`,
      `Scenario variables: ${JSON.stringify(scenario.variables)}`,
      "",
      "Scenario-specific baseline data (real query results, not estimates -",
      "some fields are approximations of a value the schema doesn't track",
      "exactly; use them as calibration context, not ground truth to restate",
      "verbatim):",
      baselineLines,
      "",
      "Cross-org platform learning patterns (anonymized context, not this",
      "org's own history):",
      patternLines,
      "",
      "Prior simulation comparison:",
      previousSimulationLines,
      "",
      "Project the financial and probability impact of this scenario as a",
      "proper 3-year model (year 1, year 2, year 3), each with its own",
      "revenue increase, grant count increase, cost, and net benefit. Be",
      "conservative where data is insufficient rather than inventing",
      "precision the inputs don't support - reflect that in confidence and",
      "confidence_reasoning.",
    ].join("\n");

    return { system, prompt };
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource, {});

    try {
      const scenario = await this.loadScenarioInput();
      const state = await this.loadOrgCurrentState();
      const dominantFunderCategory = await this.loadDominantFunderCategory();
      const patterns = await this.loadLearningPatterns(dominantFunderCategory);
      const scenarioBaseline = await this.loadScenarioBaseline(scenario, state);
      const previousSimulation = await this.loadPreviousSimulation(scenario.scenarioType);

      const { system, prompt } = this.buildPrompt(
        scenario,
        state,
        patterns,
        scenarioBaseline,
        previousSimulation,
      );

      let projection: SimulationProjection | null = null;
      let validationErrors: string[] = [];
      let totalTokensUsed = 0;

      for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
        const attemptPrompt =
          attempt === 0
            ? prompt
            : `${prompt}\n\nYour previous response failed validation for these ` +
              `reasons - return corrected JSON only, same shape:\n` +
              validationErrors.map((e) => `- ${e}`).join("\n");

        const response = await callClaude({
          prompt: attemptPrompt,
          system,
          model: DEFAULT_MODEL,
          maxTokens: MAX_TOKENS,
          temperature: 0.3,
        });
        totalTokensUsed += response.usage.totalTokens;

        let candidate: SimulationProjection;
        try {
          candidate = parseProjectionJson(response.text);
        } catch (parseErr) {
          validationErrors = [
            parseErr instanceof Error
              ? parseErr.message
              : "Could not parse the response as JSON.",
          ];
          continue;
        }

        validationErrors = validateProjection(candidate);
        if (validationErrors.length === 0) {
          projection = candidate;
          break;
        }
      }

      if (!projection) {
        throw new Error(
          `Simulation projection failed validation after ${MAX_VALIDATION_RETRIES + 1} ` +
            `attempt(s): ${validationErrors.join("; ")}`,
        );
      }

      const scenarioName =
        scenario.scenarioName ??
        `${scenario.scenarioType.replace(/_/g, " ")} scenario - ${new Date().toISOString().slice(0, 10)}`;

      const totalRevenueIncrease =
        projection.year_1.revenue_increase +
        projection.year_2.revenue_increase +
        projection.year_3.revenue_increase;
      const totalGrantCountIncrease = Math.round(
        projection.year_1.grant_count_increase +
          projection.year_2.grant_count_increase +
          projection.year_3.grant_count_increase,
      );
      const totalCost =
        projection.year_1.cost + projection.year_2.cost + projection.year_3.cost;

      const { data: inserted, error: insertError } = await this.supabase
        .from("simulation_scenarios")
        .insert({
          org_id: this.orgId,
          scenario_name: scenarioName,
          scenario_type: scenario.scenarioType,
          // simulation_scenarios has no dedicated columns for the per-year
          // model, assumptions, or narrative reasoning - folded into
          // variables.projection_detail rather than dropped. year_1/year_2/
          // year_3 are kept as plain numbers here (revenue_increase only)
          // for backward compatibility with the existing /reports/simulate
          // bar chart UI, which reads them as dollar values; the full
          // per-year model (cost/grant-count/net-benefit) is additionally
          // stored under multi_year_model for any future UI to consume.
          variables: {
            ...scenario.variables,
            scenario_baseline: scenarioBaseline,
            previous_simulation: previousSimulation,
            projection_detail: {
              reasoning: projection.confidence_reasoning,
              year_1: projection.year_1.revenue_increase,
              year_2: projection.year_2.revenue_increase,
              year_3: projection.year_3.revenue_increase,
              assumptions: projection.assumptions,
              multi_year_model: {
                year_1: projection.year_1,
                year_2: projection.year_2,
                year_3: projection.year_3,
              },
            },
          },
          projected_revenue: totalRevenueIncrease,
          projected_grants: totalGrantCountIncrease,
          probability_improvement: projection.probability_improvement,
          cost_estimate: totalCost,
          roi_multiple: projection.cumulative_roi,
          payback_months: projection.payback_months,
          risk_factors: projection.risk_factors,
          confidence: projection.confidence,
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        throw new Error(
          `Failed to insert simulation_scenarios row: ${insertError?.message ?? "no row returned"}`,
        );
      }

      const scenarioId = (inserted as { id: string }).id;

      await this.logDecision({
        decisionType: "simulation_generated",
        agentRunId: runId,
        entityType: "simulation_scenario",
        entityId: scenarioId,
        reasoning: projection.confidence_reasoning,
        confidenceScore: confidenceToScore(projection.confidence),
        actionTaken:
          `Generated a ${scenario.scenarioType.replace(/_/g, " ")} what-if 3-year ` +
          `projection (${projection.confidence} confidence).`,
        actionPayload: {
          scenarioType: scenario.scenarioType,
          totalRevenueIncrease,
          cumulativeRoi: projection.cumulative_roi,
          paybackMonths: projection.payback_months,
        },
        // Advisory-only, read-only projection (matches AG-28's own hard
        // limit) - not force-flagged unconditionally the way AG-06's
        // autonomous drafts are. A low-confidence result is still forced
        // into review by logDecision's MIN_CONFIDENCE_TO_ACT floor.
        requiredHumanReview: false,
      });

      const summary =
        `Generated ${scenario.scenarioType} scenario "${scenarioName}" - ` +
        `${projection.confidence} confidence, ${projection.cumulative_roi}x cumulative ROI, ` +
        `payback in ${projection.payback_months} months.`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: 1,
        itemsProcessed: 1,
        itemsQueued: 0,
        tokensUsed: totalTokensUsed,
        confidenceScore: confidenceToScore(projection.confidence),
      });

      return {
        success: true,
        itemsFound: 1,
        itemsProcessed: 1,
        itemsQueued: 0,
        decisions: [scenarioId],
        nextActions: ["Review scenario at /intelligence/simulate."],
        errors: [],
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Simulation run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions: [],
        nextActions: [],
        errors: [message],
      };
    }
  }
}
