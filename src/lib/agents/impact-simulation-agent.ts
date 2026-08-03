// AG-41 Impact Simulation Agent (AutonomousAgent, migration 078/105:
// impact_simulations, RLS added migration 105; this build's own migration
// 112 adds the 'ag-41-impact-simulation' agent_type enum value). Enterprise
// spec: AGENTS_v2.md §5, AG-41 "Impact Simulation Agent" (renumbered from
// AG-28 2026-08-02 — AG-28 is now permanently Follow-Up Generator Agent).
// Purpose: models what-if strategic scenarios (financial, capacity,
// beneficiary impact) before a decision is made.
//
// Confirmed live before writing this file (not assumed, via DATABASE_URL/
// psql): impact_simulations already exists with exactly the spec's column
// set — id, org_id, scenario_type (text), scenario_params (jsonb NOT NULL),
// simulation_result (jsonb), confidence (text, NOT numeric), generated_at,
// created_by — with RLS (migration 105) already in place.
//
// Trigger design — manual only, deliberately no schedule/event, per the
// spec's own "Trigger design" section: a what-if scenario only has meaning
// in response to a specific question a human is actually asking. There is
// no autonomous/scheduled path for this agent anywhere in this file, and
// none should ever be added — trigger_source is unconditionally "manual" on
// every agent_runs row this agent produces, regardless of what the caller
// passes in (see run() below), matching the spec's explicit statement that
// this is the only value that row should ever take for this agent.
//
// Scenario space is a fixed, closed set of 4 types (SCENARIO_TYPES below) —
// not arbitrary free text — per the spec's own reasoning: an unbounded
// scenario space cannot get grounded deterministic math and would push this
// whole agent into pure, ungrounded Claude speculation. An unsupported
// scenario_type is rejected at the API layer (400) before this agent is
// ever invoked; run() still defensively re-validates and throws a clear
// error if somehow called with an unrecognized type, since AutonomousAgent
// subclasses are also directly callable outside the one real route.
//
// Deterministic-math-first design (same principle as AG-10/AG-26/AG-27):
// each scenario branch computes its numeric deterministicImpact in plain
// code before the one Claude call — Claude only writes the narrative layer
// (key_risks/key_opportunities/narrative, plus exposedPrograms for
// budget_cut) grounded in numbers already computed, never invents the
// numbers itself.
//
// Confidence field — interpretive reconciliation, stated explicitly since
// the spec is internally inconsistent between two sections: the Process
// section describes gain_funder's confidence as "capped at 50" (numeric
// phrasing), while the Output contract explicitly types confidence as
// "text (not numeric)... 'high'/'medium'/'low'" and the live schema
// confirms `confidence text`. This file follows the Output contract (the
// more specific, schema-grounded section) and treats "capped at 50" as
// shorthand for "the lowest of the three tiers": confidence is 'high' when
// the baseline came from a real AG-26 forecast (baselineUsed='forecast'),
// 'medium' when it fell back to the raw trailing-12-month outcomes sum
// (baselineUsed='fallback'), and 'low' unconditionally for gain_funder
// (its own input is inherently speculative — a human-supplied estimate,
// not platform data — regardless of which baseline was available).
//
// Baseline resolution (Input contract): the most recent funding_forecasts
// row for this org with forecast_period='12_month' (AG-26's real output) is
// the preferred baseline; if none exists yet, falls back to this org's own
// trailing-12-month outcomes sum (awarded + partial results) — the same
// small-sample-neutral-default convention already established by AG-10/
// AG-26, reused rather than inventing a new fallback shape.
//
// lose_funder's funder-outcome linkage: outcomes carries no direct
// funder_id (confirmed live, same 2-hop gap AG-10's spec already
// documents) — resolved here via application_id -> applications.
// opportunity_id -> opportunities.funder_id, the identical join path AG-10
// specifies for its own reward_patterns evidence gathering.
//
// Idempotency — deliberately NOT "never double-write" (unlike every other
// agent in this batch): per the spec's own Idempotency section, each call
// is an independent insert into impact_simulations, never an upsert. A
// human comparing "what if we cut 10%" against "what if we cut 20%" is
// expected to produce two independent historical rows, not overwrite one.
//
// Autonomy level: human-triggered by design. Per the spec's "Autonomy
// level" section, this is not autonomy-with-an-approval-gate — it is a
// synchronous, on-demand tool with no autonomous loop to heal or govern.
// The one real Claude call retries up to 3 times with exponential backoff
// (1s/2s/4s, the pattern already proven in src/lib/intelligence/
// embeddings.ts and reused by AG-10/AG-26/AG-27); on exhaustion the
// simulation still writes with the real deterministic numbers and empty
// narrative arrays, per the spec's Error handling section — never blocked
// on Claude. A genuine lookup/validation failure (e.g. an unknown
// funderId) fails the whole single-item run via failRun(), since this
// agent processes exactly one scenario per call with no internal loop to
// isolate a failure from (spec's Error handling section) — the API route
// surfaces that failure synchronously to the human who requested it.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

export const SCENARIO_TYPES = [
  "lose_funder",
  "gain_funder",
  "program_expansion",
  "budget_cut",
] as const;
export type ScenarioType = (typeof SCENARIO_TYPES)[number];

type ConfidenceLevel = "high" | "medium" | "low";
type BaselineUsed = "forecast" | "fallback";

/** Spec step 3, program_expansion branch: "a configurable threshold of
 * current budget (default 25%)" — implemented as a named constant rather
 * than a new UI/API-exposed setting, which this build task doesn't ask
 * for. */
const PROGRAM_EXPANSION_BUDGET_RISK_THRESHOLD_PCT = 25;

const OUTCOMES_LOOKBACK_DAYS = 365;
const NARRATIVE_MAX_TOKENS = 900;

const NARRATIVE_SYSTEM_PROMPT =
  "You are the Impact Simulation Agent inside Benavora, an AI-powered " +
  "nonprofit funding intelligence platform. You are given a real, " +
  "deterministically-computed what-if scenario for one organization — a " +
  "specific scenario type, its real financial baseline, and the exact " +
  "numeric impact already computed for it. Write grounded key_risks, " +
  "key_opportunities (mitigating factors), and a plain-language narrative " +
  "summary a real development director or board member could act on - " +
  "every claim must trace back to a number or fact you were given, never " +
  "a generic platitude. Never invent a number, program name, or fact that " +
  "was not given to you. You are producing structured data for another " +
  "system, not prose for a human to read directly - respond with ONLY the " +
  "requested JSON, no markdown fences, no commentary before or after it.";

interface OrgRow {
  id: string;
  name: string | null;
  annual_budget: number | null;
  total_staff: number | null;
  total_volunteers: number | null;
}

interface FunderRow {
  id: string;
  name: string | null;
  annual_giving_budget: number | null;
}

interface OutcomeRow {
  id: string;
  application_id: string | null;
  result: string;
  awarded_amount: number | null;
  recorded_at: string | null;
}

interface OpportunityRow {
  id: string;
  funder_id: string | null;
  amount_min: number | null;
  amount_max: number | null;
}

interface ApplicationRow {
  id: string;
  opportunity_id: string | null;
}

interface KnowledgeBaseRow {
  title: string | null;
  content: string | null;
}

interface BaselineResult {
  baselineUsed: BaselineUsed;
  baselineAmount: number;
  outcomes: OutcomeRow[];
}

interface DeterministicImpact {
  min: number;
  max: number;
  mostLikely: number;
}

interface ScenarioComputation {
  deterministicImpact: DeterministicImpact;
  /** Facts fed verbatim into the Claude prompt, grounded and verifiable. */
  factLines: string[];
  /** Deterministic risk entries computed in code (e.g. the program_expansion
   * budget-ratio flag) — written to simulation_result.keyRisks BEFORE any
   * Claude-generated risks are appended, so this fact is guaranteed present
   * regardless of what Claude returns. */
  deterministicRisks: string[];
  confidence: ConfidenceLevel;
}

interface NarrativeResult {
  keyRisks: string[];
  keyOpportunities: string[];
  narrative: string;
  exposedPrograms: { programName: string; reasoning: string }[];
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error.";
}

function midpoint(min: number | null, max: number | null): number {
  if (min != null && max != null) return (min + max) / 2;
  if (min != null) return min;
  if (max != null) return max;
  return 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export class ImpactSimulationAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-41-impact-simulation", supabase);
  }

  private async loadOrg(): Promise<OrgRow> {
    const { data } = await this.supabase
      .from("organizations")
      .select("id, name, annual_budget, total_staff, total_volunteers")
      .eq("id", this.orgId)
      .maybeSingle();
    if (!data) throw new Error(`Organization ${this.orgId} not found.`);
    return data as OrgRow;
  }

  private async loadTrailing12MoOutcomes(): Promise<OutcomeRow[]> {
    const since = new Date();
    since.setDate(since.getDate() - OUTCOMES_LOOKBACK_DAYS);

    const { data } = await this.supabase
      .from("outcomes")
      .select("id, application_id, result, awarded_amount, recorded_at")
      .eq("organization_id", this.orgId)
      .gte("recorded_at", since.toISOString());
    return (data ?? []) as OutcomeRow[];
  }

  private sumRealizedAmount(outcomes: OutcomeRow[]): number {
    return outcomes
      .filter((o) => o.result === "awarded" || o.result === "partial")
      .reduce((sum, o) => sum + (o.awarded_amount ?? 0), 0);
  }

  /** Input contract's fallback rule: prefer AG-26's real 12_month forecast;
   * fall back to this org's own trailing-12-month realized outcomes sum. */
  private async resolveBaseline(): Promise<BaselineResult> {
    const outcomes = await this.loadTrailing12MoOutcomes();

    const { data: forecastRow } = await this.supabase
      .from("funding_forecasts")
      .select("projected_most_likely")
      .eq("org_id", this.orgId)
      .eq("forecast_period", "12_month")
      .order("forecast_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (forecastRow && typeof forecastRow.projected_most_likely === "number") {
      return {
        baselineUsed: "forecast",
        baselineAmount: forecastRow.projected_most_likely,
        outcomes,
      };
    }
    return {
      baselineUsed: "fallback",
      baselineAmount: this.sumRealizedAmount(outcomes),
      outcomes,
    };
  }

  /** Resolves a set of outcome ids to their real funder_id via the
   * application_id -> opportunity_id -> funder_id 2-hop join (outcomes
   * itself carries no direct funder_id — see file header). */
  private async mapOutcomesToFunderId(
    outcomes: OutcomeRow[],
  ): Promise<Map<string, string>> {
    const applicationIds = outcomes
      .map((o) => o.application_id)
      .filter((id): id is string => typeof id === "string");
    if (applicationIds.length === 0) return new Map();

    const { data: appData } = await this.supabase
      .from("applications")
      .select("id, opportunity_id")
      .in("id", applicationIds);
    const applications = (appData ?? []) as ApplicationRow[];

    const opportunityIds = applications
      .map((a) => a.opportunity_id)
      .filter((id): id is string => typeof id === "string");
    if (opportunityIds.length === 0) return new Map();

    const { data: oppData } = await this.supabase
      .from("opportunities")
      .select("id, funder_id, amount_min, amount_max")
      .in("id", opportunityIds);
    const opportunities = (oppData ?? []) as OpportunityRow[];
    const funderByOpportunity = new Map(
      opportunities.map((o) => [o.id, o.funder_id]),
    );

    const funderByApplication = new Map<string, string>();
    for (const app of applications) {
      const funderId = app.opportunity_id
        ? funderByOpportunity.get(app.opportunity_id)
        : null;
      if (funderId) funderByApplication.set(app.id, funderId);
    }

    const funderByOutcome = new Map<string, string>();
    for (const outcome of outcomes) {
      const funderId = outcome.application_id
        ? funderByApplication.get(outcome.application_id)
        : null;
      if (funderId) funderByOutcome.set(outcome.id, funderId);
    }
    return funderByOutcome;
  }

  private async loadOpenPipelineValue(funderId: string): Promise<number> {
    const { data } = await this.supabase
      .from("opportunities")
      .select("amount_min, amount_max")
      .eq("organization_id", this.orgId)
      .eq("funder_id", funderId)
      .eq("status", "open");
    const opportunities = (data ?? []) as Pick<
      OpportunityRow,
      "amount_min" | "amount_max"
    >[];
    return opportunities.reduce(
      (sum, o) => sum + midpoint(o.amount_min, o.amount_max),
      0,
    );
  }

  /** Step 3, lose_funder branch. */
  private async computeLoseFunder(
    scenarioParams: Record<string, unknown>,
    baseline: BaselineResult,
  ): Promise<ScenarioComputation> {
    const funderId = scenarioParams.funderId;
    if (typeof funderId !== "string" || funderId.trim() === "") {
      throw new Error("scenario_params.funderId is required for lose_funder.");
    }

    const { data: funderRow } = await this.supabase
      .from("funders")
      .select("id, name, annual_giving_budget")
      .eq("id", funderId)
      .eq("organization_id", this.orgId)
      .maybeSingle();
    if (!funderRow) {
      throw new Error(`Funder ${funderId} not found for this organization.`);
    }
    const funder = funderRow as FunderRow;

    const funderByOutcome = await this.mapOutcomesToFunderId(baseline.outcomes);
    const historicalAwarded = baseline.outcomes
      .filter(
        (o) =>
          funderByOutcome.get(o.id) === funderId &&
          (o.result === "awarded" || o.result === "partial"),
      )
      .reduce((sum, o) => sum + (o.awarded_amount ?? 0), 0);

    const openPipelineValue = await this.loadOpenPipelineValue(funderId);
    const lossAmount = historicalAwarded + openPipelineValue;
    const pctOfBaseline =
      baseline.baselineAmount > 0
        ? (lossAmount / baseline.baselineAmount) * 100
        : null;

    const factLines = [
      `Scenario: lose_funder — losing "${funder.name ?? funderId}".`,
      historicalAwarded === 0 && openPipelineValue === 0
        ? `This funder has zero trailing-12-month realized outcomes and zero open opportunities on file — the deterministic impact is genuinely $0, this funder was never contributing.`
        : `Trailing-12-month realized amount from this funder: $${historicalAwarded.toLocaleString("en-US")}. Open pipeline value with this funder: $${openPipelineValue.toLocaleString("en-US")}. Total at risk: $${lossAmount.toLocaleString("en-US")}` +
          (pctOfBaseline != null
            ? ` (${pctOfBaseline.toFixed(1)}% of the ${baseline.baselineUsed === "forecast" ? "12-month forecast" : "trailing-12-month realized"} baseline of $${baseline.baselineAmount.toLocaleString("en-US")}).`
            : "."),
    ];

    return {
      deterministicImpact: {
        min: -lossAmount,
        max: -lossAmount,
        mostLikely: -lossAmount,
      },
      factLines,
      deterministicRisks: [],
      confidence: baseline.baselineUsed === "forecast" ? "high" : "medium",
    };
  }

  /** Step 3, gain_funder branch. Explicitly speculative by its own input —
   * confidence is always 'low' regardless of baseline (see file header). */
  private computeGainFunder(
    scenarioParams: Record<string, unknown>,
  ): ScenarioComputation {
    const estimatedAnnualAmount = scenarioParams.estimatedAnnualAmount;
    if (!isPositiveNumber(estimatedAnnualAmount)) {
      throw new Error(
        "scenario_params.estimatedAnnualAmount (a positive number) is required for gain_funder.",
      );
    }

    return {
      deterministicImpact: {
        min: estimatedAnnualAmount,
        max: estimatedAnnualAmount,
        mostLikely: estimatedAnnualAmount,
      },
      factLines: [
        `Scenario: gain_funder — a new funder estimated at $${estimatedAnnualAmount.toLocaleString("en-US")}/year.`,
        `This projection depends entirely on the accuracy of this human-supplied estimate, not real platform data — there is no real funder on file to derive this number from.`,
      ],
      deterministicRisks: [],
      confidence: "low",
    };
  }

  /** Step 3, program_expansion branch. Flags (never blocks) when the new
   * program's cost exceeds PROGRAM_EXPANSION_BUDGET_RISK_THRESHOLD_PCT of
   * current annual budget — computed deterministically here so the flag is
   * guaranteed present regardless of what Claude returns. */
  private computeProgramExpansion(
    scenarioParams: Record<string, unknown>,
    org: OrgRow,
    baseline: BaselineResult,
  ): ScenarioComputation {
    const newProgramAnnualBudget = scenarioParams.newProgramAnnualBudget;
    const additionalStaffCount = scenarioParams.additionalStaffCount;
    if (!isPositiveNumber(newProgramAnnualBudget)) {
      throw new Error(
        "scenario_params.newProgramAnnualBudget (a positive number) is required for program_expansion.",
      );
    }
    if (!isNonNegativeNumber(additionalStaffCount)) {
      throw new Error(
        "scenario_params.additionalStaffCount (a non-negative number) is required for program_expansion.",
      );
    }

    const deterministicRisks: string[] = [];
    const factLines = [
      `Scenario: program_expansion — a new program with a $${newProgramAnnualBudget.toLocaleString("en-US")}/year budget and ${additionalStaffCount} additional staff.`,
    ];

    if (org.annual_budget != null && org.annual_budget > 0) {
      const ratioPct = (newProgramAnnualBudget / org.annual_budget) * 100;
      factLines.push(
        `This represents ${ratioPct.toFixed(1)}% of the organization's current annual budget of $${org.annual_budget.toLocaleString("en-US")}.`,
      );
      if (ratioPct > PROGRAM_EXPANSION_BUDGET_RISK_THRESHOLD_PCT) {
        deterministicRisks.push(
          `New program budget of $${newProgramAnnualBudget.toLocaleString("en-US")} represents ${ratioPct.toFixed(1)}% of current annual budget ($${org.annual_budget.toLocaleString("en-US")}), exceeding the ${PROGRAM_EXPANSION_BUDGET_RISK_THRESHOLD_PCT}% risk threshold.`,
        );
      }
    } else {
      factLines.push(
        `Organization's annual_budget is not on file — cannot compute the new program's % ratio against current budget.`,
      );
    }

    return {
      deterministicImpact: {
        min: -newProgramAnnualBudget,
        max: -newProgramAnnualBudget,
        mostLikely: -newProgramAnnualBudget,
      },
      factLines,
      deterministicRisks,
      confidence: baseline.baselineUsed === "forecast" ? "high" : "medium",
    };
  }

  /** Step 3, budget_cut branch. */
  private computeBudgetCut(
    scenarioParams: Record<string, unknown>,
    baseline: BaselineResult,
  ): ScenarioComputation {
    const cutPercentage = scenarioParams.cutPercentage;
    if (
      typeof cutPercentage !== "number" ||
      !Number.isFinite(cutPercentage) ||
      cutPercentage <= 0 ||
      cutPercentage > 100
    ) {
      throw new Error(
        "scenario_params.cutPercentage (a number in (0, 100]) is required for budget_cut.",
      );
    }

    const cutAmount = baseline.baselineAmount * (cutPercentage / 100);

    return {
      deterministicImpact: {
        min: -cutAmount,
        max: -cutAmount,
        mostLikely: -cutAmount,
      },
      factLines: [
        `Scenario: budget_cut — a ${cutPercentage}% cut applied to the ${baseline.baselineUsed === "forecast" ? "12-month forecast" : "trailing-12-month realized"} baseline of $${baseline.baselineAmount.toLocaleString("en-US")}, a reduction of $${cutAmount.toLocaleString("en-US")}.`,
      ],
      deterministicRisks: [],
      confidence: baseline.baselineUsed === "forecast" ? "high" : "medium",
    };
  }

  /** budget_cut-only: real, on-file program descriptions from the
   * Knowledge Base, so Claude names actual programs rather than a generic
   * "services may be reduced" non-answer (spec step 3). */
  private async loadProgramDescriptions(): Promise<KnowledgeBaseRow[]> {
    const { data } = await this.supabase
      .from("knowledge_base")
      .select("title, content")
      .eq("organization_id", this.orgId)
      .eq("category", "program_description");
    return (data ?? []) as KnowledgeBaseRow[];
  }

  private buildPrompt(
    scenarioType: ScenarioType,
    org: OrgRow,
    computation: ScenarioComputation,
    programs: KnowledgeBaseRow[],
  ): string {
    const impactLine =
      `Deterministic impact already computed — most likely: $${computation.deterministicImpact.mostLikely.toLocaleString("en-US")} ` +
      `(range: $${computation.deterministicImpact.min.toLocaleString("en-US")} to $${computation.deterministicImpact.max.toLocaleString("en-US")}).`;

    const deterministicRiskLine =
      computation.deterministicRisks.length > 0
        ? `Already-flagged deterministic risk(s), include verbatim in key_risks: ${computation.deterministicRisks.join(" ")}`
        : "";

    let programSection = "";
    if (scenarioType === "budget_cut") {
      if (programs.length === 0) {
        programSection =
          "\n\nNo real program_description Knowledge Base entries are on file for this organization — return exposedPrograms as an empty array rather than inventing program names.";
      } else {
        const programLines = programs
          .slice(0, 10)
          .map(
            (p, i) =>
              `  [${i}] "${p.title ?? "untitled"}": ${(p.content ?? "").slice(0, 300)}`,
          )
          .join("\n");
        programSection =
          `\n\nReal, on-file program descriptions (name exposed programs ONLY from this list, never invent one):\n${programLines}\n\n` +
          "Populate exposedPrograms with the real, on-file programs most likely exposed by this budget cut, each with a reasoning field grounded in the program description given above.";
      }
    }

    return (
      `Organization: "${org.name ?? "this organization"}" ` +
      `(annual budget: ${org.annual_budget != null ? "$" + org.annual_budget.toLocaleString("en-US") : "not on file"}, ` +
      `${org.total_staff ?? "unknown"} staff, ${org.total_volunteers ?? "unknown"} volunteers).\n\n` +
      `${computation.factLines.join(" ")}\n\n${impactLine}` +
      (deterministicRiskLine ? `\n\n${deterministicRiskLine}` : "") +
      `${programSection}\n\n` +
      "Write key_risks (array of strings), key_opportunities (array of strings, mitigating factors — " +
      "e.g. other funders in the pipeline that could offset this), and a short plain-language narrative " +
      "summary. Every claim must trace back to a fact given above.\n\n" +
      "Respond with ONLY JSON, shaped exactly as: " +
      '{"keyRisks": string[], "keyOpportunities": string[], "narrative": string' +
      (scenarioType === "budget_cut"
        ? ', "exposedPrograms": [{"programName": string, "reasoning": string}]'
        : "") +
      "}"
    );
  }

  /** Claude call with 3-attempt exponential backoff (1s/2s/4s), the pattern
   * already proven in src/lib/intelligence/embeddings.ts and reused by
   * AG-10/AG-26/AG-27. */
  private async callClaudeWithRetry(
    prompt: string,
  ): Promise<{ text: string; tokensUsed: number }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await callClaude({
          model: DEFAULT_MODEL,
          maxTokens: NARRATIVE_MAX_TOKENS,
          system: NARRATIVE_SYSTEM_PROMPT,
          prompt,
        });
        return { text: response.text, tokensUsed: response.usage.totalTokens };
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000),
          );
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Claude call failed after 3 attempts.");
  }

  /** Step 4: one bounded Claude call per simulation. On total Claude
   * failure, degrades to empty narrative arrays rather than blocking the
   * run — the deterministic numbers are the load-bearing part (spec's
   * Error handling section). The deterministic risk(s) from step 3 are
   * always prepended to keyRisks, independent of whether Claude succeeded. */
  private async generateNarrative(
    scenarioType: ScenarioType,
    org: OrgRow,
    computation: ScenarioComputation,
    programs: KnowledgeBaseRow[],
  ): Promise<{ narrative: NarrativeResult; tokensUsed: number; degraded: boolean }> {
    const prompt = this.buildPrompt(scenarioType, org, computation, programs);

    try {
      const { text, tokensUsed } = await this.callClaudeWithRetry(prompt);
      const jsonText = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "");
      const parsed = JSON.parse(jsonText) as {
        keyRisks?: unknown;
        keyOpportunities?: unknown;
        narrative?: unknown;
        exposedPrograms?: unknown;
      };

      const claudeRisks = Array.isArray(parsed.keyRisks)
        ? parsed.keyRisks.filter((x): x is string => typeof x === "string")
        : [];
      const exposedPrograms = Array.isArray(parsed.exposedPrograms)
        ? parsed.exposedPrograms
            .filter(
              (x): x is { programName: unknown; reasoning: unknown } =>
                typeof x === "object" && x !== null,
            )
            .map((x) => ({
              programName:
                typeof x.programName === "string" ? x.programName : "",
              reasoning: typeof x.reasoning === "string" ? x.reasoning : "",
            }))
            .filter((x) => x.programName.trim() !== "")
        : [];

      return {
        narrative: {
          keyRisks: [...computation.deterministicRisks, ...claudeRisks],
          keyOpportunities: Array.isArray(parsed.keyOpportunities)
            ? parsed.keyOpportunities.filter(
                (x): x is string => typeof x === "string",
              )
            : [],
          narrative: typeof parsed.narrative === "string" ? parsed.narrative : "",
          exposedPrograms,
        },
        tokensUsed,
        degraded: false,
      };
    } catch {
      return {
        narrative: {
          keyRisks: [...computation.deterministicRisks],
          keyOpportunities: [],
          narrative: "",
          exposedPrograms: [],
        },
        tokensUsed: 0,
        degraded: true,
      };
    }
  }

  /**
   * run() has an extended signature beyond AutonomousAgent's abstract
   * `run(triggerSource)` — the same override-with-additional-params
   * convention BoardPacketAgent already established for its own
   * schedule-scope parameter. triggerSource is accepted for interface
   * compatibility but ignored for the actual agent_runs write: per the
   * spec, this agent's trigger_source is unconditionally "manual" (see
   * file header) — the one real caller (POST /api/agents/simulate) always
   * passes "manual" anyway, and hardcoding it here is a second, structural
   * guarantee against a future stray automated call site.
   *
   * The returned `decisions` array carries the created impact_simulations
   * row's own id (not an agent_decisions id) — the same convention AG-37's
   * SimulationAgent already established for this exact synchronous-route
   * "hand the created row back to the caller" use case. The logged
   * agent_decisions row itself still uses entityType/entityId = the
   * organization, per this agent's own Observability spec.
   */
  override async run(
    _triggerSource: TriggerSource,
    scenarioType?: ScenarioType,
    scenarioParams?: Record<string, unknown>,
    createdBy?: string | null,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun("manual", {
      scenarioType: scenarioType ?? null,
      scenarioParams: scenarioParams ?? {},
    });
    const errors: string[] = [];
    const decisions: string[] = [];

    try {
      if (
        !scenarioType ||
        !(SCENARIO_TYPES as readonly string[]).includes(scenarioType)
      ) {
        throw new Error(
          `scenario_type must be one of: ${SCENARIO_TYPES.join(", ")}.`,
        );
      }
      const params = scenarioParams ?? {};

      const org = await this.loadOrg();
      const baseline = await this.resolveBaseline();

      let computation: ScenarioComputation;
      switch (scenarioType) {
        case "lose_funder":
          computation = await this.computeLoseFunder(params, baseline);
          break;
        case "gain_funder":
          computation = this.computeGainFunder(params);
          break;
        case "program_expansion":
          computation = this.computeProgramExpansion(params, org, baseline);
          break;
        case "budget_cut":
          computation = this.computeBudgetCut(params, baseline);
          break;
      }

      const programs =
        scenarioType === "budget_cut" ? await this.loadProgramDescriptions() : [];

      const { narrative, tokensUsed, degraded } = await this.generateNarrative(
        scenarioType,
        org,
        computation,
        programs,
      );

      const simulationResult: Record<string, unknown> = {
        baselineUsed: baseline.baselineUsed,
        deterministicImpact: computation.deterministicImpact,
        keyRisks: narrative.keyRisks,
        keyOpportunities: narrative.keyOpportunities,
        narrative: narrative.narrative,
      };
      if (scenarioType === "budget_cut") {
        simulationResult.exposedPrograms = narrative.exposedPrograms;
      }
      if (degraded) {
        simulationResult.narrativeUnavailable =
          "Narrative synthesis unavailable this run (Claude call failed after 3 attempts) — the deterministic impact numbers above are unaffected.";
      }

      const { data: inserted, error: insertError } = await this.supabase
        .from("impact_simulations")
        .insert({
          org_id: this.orgId,
          scenario_type: scenarioType,
          scenario_params: params,
          simulation_result: simulationResult,
          confidence: computation.confidence,
          created_by: createdBy ?? null,
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        throw new Error(
          `Failed to insert impact_simulations row: ${insertError?.message ?? "no row returned"}`,
        );
      }
      const simulationId = (inserted as { id: string }).id;

      const decisionId = await this.logDecision({
        decisionType: "simulation_completed",
        agentRunId: runId,
        entityType: "organization",
        entityId: this.orgId,
        reasoning:
          `Ran a ${scenarioType} simulation (${computation.confidence} confidence, ` +
          `baseline: ${baseline.baselineUsed}).` +
          (degraded ? " Narrative synthesis was unavailable this run." : ""),
        confidenceScore:
          computation.confidence === "high"
            ? 90
            : computation.confidence === "medium"
              ? 65
              : 40,
        actionTaken: "generated_impact_simulation",
        actionPayload: {
          simulationId,
          scenarioType,
          deterministicImpact: computation.deterministicImpact,
          confidence: computation.confidence,
        },
        // Read-only, advisory projection — never overwrites live
        // financial/pipeline data (spec's Hard Limits) — not force-flagged
        // beyond logDecision's own MIN_CONFIDENCE_TO_ACT floor.
        requiredHumanReview: false,
      });
      decisions.push(simulationId);
      void decisionId;

      await this.completeRun(runId, {
        outputSummary:
          `Generated a ${scenarioType} simulation — ${computation.confidence} confidence, ` +
          `most-likely impact $${computation.deterministicImpact.mostLikely.toLocaleString("en-US")}.`,
        itemsFound: 1,
        itemsProcessed: 1,
        itemsQueued: 0,
        tokensUsed,
        confidenceScore:
          computation.confidence === "high"
            ? 90
            : computation.confidence === "medium"
              ? 65
              : 40,
        outputPayload: { simulationId, scenarioType },
      });

      return {
        success: true,
        itemsFound: 1,
        itemsProcessed: 1,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message = errMsg(err) || "Impact simulation failed.";
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
