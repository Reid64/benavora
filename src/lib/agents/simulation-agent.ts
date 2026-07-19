// AG-37 Simulation Agent (AutonomousAgent, migration 080 infrastructure +
// migration 085_fundraising_simulator.sql substrate: simulation_scenarios).
// AUTONOMOUS_PLATFORM_VISION.md Phase 4, "Predictive Fundraising Simulator":
// what-if modeling (board expansion, staff hire, geographic expansion, new
// program, budget increase, partnership) projecting revenue, probability
// improvement, cost, and ROI so a board can evaluate an option before
// committing to it. Read-only projection - never writes to live
// financial/pipeline data, matching AG-28 (Impact Simulation Agent)'s own
// hard limit that "a simulation is read-only by definition."
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
// Known, unresolved gap matching AGENTS_v2.md §1.2's pattern: "ag-37-simulation"
// is added to the agent_type enum in this same migration (085), unlike the
// other 12+ Generation-2 agents that remain permanently blocked - this one
// agent's startRun() will actually succeed rather than throw at the
// agent_runs insert.
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

const MAX_TOKENS = 1200;
/** Cross-org context signal only - never treated as this org's own history. */
const MAX_LEARNING_PATTERNS = 5;
const MIN_PATTERN_SAMPLE_COUNT = 3;

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
}

interface LearningPatternRow {
  pattern_type: string;
  funder_category: string | null;
  pattern_content: string;
  success_rate: number | null;
  sample_count: number;
}

interface SimulationProjection {
  projected_revenue_increase: number | null;
  projected_additional_grants: number | null;
  probability_improvement: number | null;
  cost_estimate: number | null;
  roi_multiple: number | null;
  payback_months: number | null;
  risk_factors: string[];
  confidence: "high" | "medium" | "low";
  reasoning: string;
  year_1: number | null;
  year_2: number | null;
  year_3: number | null;
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

/** Best-effort JSON extraction - Claude is asked for JSON-only output but
 * models occasionally wrap it in prose or a markdown fence. Mirrors the
 * parse-then-regex-fallback convention in learning-network-aggregator-agent.ts. */
function parseProjection(text: string): SimulationProjection {
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

  /** Loads the org's current operating state. Every field is nullable/
   * defensive rather than assumed present - never fabricates a value it
   * can't find (AGENTS_v2.md's repeated "never fabricates a field it can't
   * extract" convention). */
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
      .select("result")
      .eq("organization_id", this.orgId);
    const outcomes = (outcomeRows ?? []) as Array<{ result: string }>;
    const awardedCount = outcomes.filter((o) => o.result === "awarded").length;
    // Below MIN_OUTCOMES_FOR_RATE, a success rate is statistically
    // meaningless - report null ("insufficient data") rather than a
    // misleading precise-looking number, per the same threshold AG-04 (Fit
    // Analysis Agent) uses for its own category success rate.
    const currentSuccessRate =
      outcomes.length >= MIN_OUTCOMES_FOR_RATE
        ? Number((awardedCount / outcomes.length).toFixed(3))
        : null;

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
    };
  }

  /** Most common funder_category among this org's own outcomes, used only
   * to scope which cross-org platform_learning_patterns rows are relevant
   * context - never the org's own private outcome content. */
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
   * any matching pattern is not an error, just less context. */
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

  private buildPrompt(
    scenario: ScenarioInput,
    state: OrgCurrentState,
    patterns: LearningPatternRow[],
  ): { system: string; prompt: string } {
    const system =
      "You are a nonprofit financial modeling expert. Return JSON only, no " +
      "prose, no markdown fences, matching exactly this shape: " +
      '{ "projected_revenue_increase": number, "projected_additional_grants": number, ' +
      '"probability_improvement": number, "cost_estimate": number, "roi_multiple": number, ' +
      '"payback_months": number, "risk_factors": string[], "confidence": "high"|"medium"|"low", ' +
      '"reasoning": string, "year_1": number, "year_2": number, "year_3": number }';

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

    const prompt = [
      "Current organization state:",
      orgStateLines,
      "",
      `Scenario type: ${scenario.scenarioType}`,
      `Scenario variables: ${JSON.stringify(scenario.variables)}`,
      "",
      "Cross-org platform learning patterns (anonymized context, not this",
      "org's own history):",
      patternLines,
      "",
      "Project the financial and probability impact of this scenario over",
      "3 years. Be conservative where data is insufficient rather than",
      "inventing precision the inputs don't support.",
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

      const { system, prompt } = this.buildPrompt(scenario, state, patterns);
      const response = await callClaude({
        prompt,
        system,
        model: DEFAULT_MODEL,
        maxTokens: MAX_TOKENS,
        temperature: 0.3,
      });

      const projection = parseProjection(response.text);

      const scenarioName =
        scenario.scenarioName ??
        `${scenario.scenarioType.replace(/_/g, " ")} scenario - ${new Date().toISOString().slice(0, 10)}`;

      const { data: inserted, error: insertError } = await this.supabase
        .from("simulation_scenarios")
        .insert({
          org_id: this.orgId,
          scenario_name: scenarioName,
          scenario_type: scenario.scenarioType,
          // year_1/year_2/year_3 and reasoning have no dedicated columns on
          // simulation_scenarios - folded into variables as projection_detail
          // rather than dropped. See migration 085's header for the
          // known-conflict note on this table's schema.
          variables: {
            ...scenario.variables,
            projection_detail: {
              reasoning: projection.reasoning,
              year_1: projection.year_1,
              year_2: projection.year_2,
              year_3: projection.year_3,
            },
          },
          projected_revenue: projection.projected_revenue_increase,
          projected_grants: projection.projected_additional_grants,
          probability_improvement: projection.probability_improvement,
          cost_estimate: projection.cost_estimate,
          roi_multiple: projection.roi_multiple,
          payback_months: projection.payback_months,
          risk_factors: projection.risk_factors ?? [],
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
        reasoning: projection.reasoning,
        confidenceScore: confidenceToScore(projection.confidence),
        actionTaken:
          `Generated a ${scenario.scenarioType.replace(/_/g, " ")} what-if ` +
          `projection (${projection.confidence} confidence).`,
        actionPayload: {
          scenarioType: scenario.scenarioType,
          projectedRevenueIncrease: projection.projected_revenue_increase,
          roiMultiple: projection.roi_multiple,
        },
        // Advisory-only, read-only projection (matches AG-28's own hard
        // limit) - not force-flagged unconditionally the way AG-06's
        // autonomous drafts are. A low-confidence result is still forced
        // into review by logDecision's MIN_CONFIDENCE_TO_ACT floor.
        requiredHumanReview: false,
      });

      const summary =
        `Generated ${scenario.scenarioType} scenario "${scenarioName}" - ` +
        `${projection.confidence} confidence, ` +
        `${projection.roi_multiple != null ? `${projection.roi_multiple}x ROI` : "ROI not estimated"}.`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: 1,
        itemsProcessed: 1,
        itemsQueued: 0,
        tokensUsed: response.usage.totalTokens,
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
