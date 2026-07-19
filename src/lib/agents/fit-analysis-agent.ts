// AG-04 Fit Analysis Agent (AutonomousAgent version) - fires when an
// opportunity's eligibility_score reaches 70+, per AGENTS.md Agent 04 (a
// deeper "should we apply?" pass beyond eligibility scoring). Fired via
// agent_queue with agent_id "ag-04-fit-analysis" and input_payload
// { opportunityId: string } (migration 080 infrastructure: agent_runs,
// agent_decisions, agent_queue).
//
// Distinct from the existing on-demand src/app/api/ai/fit-analysis/route.ts
// + src/lib/ai/prompts/fit-analysis.ts (manual trigger, prose output,
// notes-only persistence): this is the queue-driven AutonomousAgent version
// scoped exactly as given in this build's task prompt - structured JSON
// recommendation, and on any non-"pass" verdict, creates the application in
// the 'discovered' pipeline stage with fit_analysis populated (migration 080:
// applications.fit_analysis jsonb, confirmed live in
// src/lib/agents/compliance-check-agent.ts's header notes).
//
// Deviation notes (checked against real schema, src/types/database.ts,
// rather than applied literally):
//   - Minimum outcomes for a meaningful success rate: this task's spec says
//     >= 3; the existing on-demand route defaults to 5 (via the
//     learning.min_outcomes_for_scoring platform_config flag). Using this
//     agent's own literal >= 3 threshold since it is a distinct agent from
//     that route.
//   - governance/AGENTS.md only documents sections 15-29 (Tier 6 additions)
//     in this repo and explicitly defers 1-14 to a v1 file that does not
//     exist (same gap noted in eligibility-scoring-agent.ts and
//     AGENTS_v2.md's Phase 1 summary, which lists AG-04 as "Fit Analysis
//     Agent - deep ROI analysis for qualified opportunities"). Built from
//     that description plus the task-given spec.
//   - funder_category enum (src/types/database.ts) has no "federal" value -
//     only "government_grant" contains "government". The federal branch of
//     the effort heuristic is unreachable on current enum values but kept
//     literal per spec in case the enum grows.
//   - Categories outside the federal/government, foundation, and
//     corporate/in-kind buckets (housing_grant, education_grant,
//     faith_compatible_grant, local_community_grant,
//     down_payment_assistance) default to 'medium' effort - not specified by
//     the task, but every category must map to something.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import { humanizeEnum } from "@/lib/utils/formatters";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";
type Recommendation =
  | "strong_apply"
  | "apply"
  | "conditional_apply"
  | "pass";
type EffortLevel = "high" | "medium" | "low";

const MAX_TOKENS = 600;
const MIN_OUTCOMES_FOR_RATE = 3;

interface FitAnalysisPayload {
  opportunityId: string;
}

interface OpportunityRow {
  id: string;
  name: string;
  category: string;
  description: string | null;
  eligibility_requirements: string | null;
  amount_min: number | null;
  amount_max: number | null;
  eligibility_score: number | null;
}

interface OrgProfile {
  name: string;
  missionStatement: string | null;
  serviceArea: string | null;
  targetPopulation: string | null;
  annualBudget: number | null;
}

interface HistoricalRecord {
  totalOutcomes: number;
  awardedCount: number;
  successRate: number | null;
}

interface ClaudeFitResult {
  recommendation: Recommendation;
  confidence: number;
  reasoning: string;
  conditions: string[] | null;
  timeEstimateHours: number;
  expectedROI: string;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function estimateEffort(category: string): EffortLevel {
  const c = category.toLowerCase();
  if (c.includes("federal") || c.includes("government")) return "high";
  if (c.includes("foundation")) return "medium";
  if (c.includes("corporate") || c.includes("in_kind") || c.includes("in-kind")) {
    return "low";
  }
  return "medium";
}

function formatCurrency(amount: number | null): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildPrompt(
  org: OrgProfile | null,
  opp: OpportunityRow,
  history: HistoricalRecord,
  effort: EffortLevel,
): { system: string; prompt: string } {
  const system =
    'Return JSON only: { recommendation: "strong_apply"|"apply"|' +
    '"conditional_apply"|"pass", confidence: number, reasoning: string, ' +
    "conditions: string[]|null, timeEstimateHours: number, expectedROI: string }";

  const orgLines: string[] = [];
  const add = (label: string, value: string | null) => {
    if (value != null && `${value}`.trim() !== "") {
      orgLines.push(`- ${label}: ${value}`);
    }
  };
  if (org) {
    add("Legal name", org.name);
    add("Mission", org.missionStatement);
    add("Service area", org.serviceArea);
    add("Target population", org.targetPopulation);
    add("Annual budget", formatCurrency(org.annualBudget));
  }
  const orgBlock =
    orgLines.length > 0
      ? orgLines.join("\n")
      : "No verified organization profile is available. Weigh strategic factors more heavily instead.";

  const oppLines: string[] = [
    `- Name: ${opp.name}`,
    `- Category: ${humanizeEnum(opp.category)}`,
  ];
  const amountRange = [
    formatCurrency(opp.amount_min),
    formatCurrency(opp.amount_max),
  ];
  if (amountRange[0] || amountRange[1]) {
    oppLines.push(`- Award range: ${amountRange[0] ?? "?"} - ${amountRange[1] ?? "?"}`);
  }
  if (opp.eligibility_score != null) {
    oppLines.push(`- Eligibility score: ${opp.eligibility_score}/100`);
  }
  if (opp.eligibility_requirements) {
    oppLines.push(`- Eligibility requirements: ${opp.eligibility_requirements}`);
  }
  if (opp.description) {
    oppLines.push(`- Description: ${opp.description}`);
  }

  const historyLine =
    history.successRate != null
      ? `Across ${history.totalOutcomes} recorded outcomes in this funder category, ${history.awardedCount} were awarded - a historical success rate of ${history.successRate}%.`
      : history.totalOutcomes > 0
        ? `Only ${history.totalOutcomes} recorded outcome(s) in this category - too few to compute a reliable success rate.`
        : "No recorded outcomes in this funder category yet.";

  const prompt = [
    "## Organization",
    orgBlock,
    "",
    "## Opportunity",
    oppLines.join("\n"),
    "",
    "## Historical success rate",
    historyLine,
    "",
    "## Effort estimate",
    `Estimated effort level for this application: ${effort}.`,
    "",
    "Weigh effort vs. reward, program alignment, competitive landscape, and " +
      "strategic value. Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}

/** Parses the model's JSON reply, tolerant of stray prose/code fences. */
function parseFitResponse(text: string): ClaudeFitResult {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The fit analysis model returned an unreadable response.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The fit analysis model returned malformed JSON.");
  }

  const obj = (raw ?? {}) as {
    recommendation?: unknown;
    confidence?: unknown;
    reasoning?: unknown;
    conditions?: unknown;
    timeEstimateHours?: unknown;
    expectedROI?: unknown;
  };

  const rawRec =
    typeof obj.recommendation === "string"
      ? obj.recommendation.trim().toLowerCase()
      : "";
  const recommendation: Recommendation =
    rawRec === "strong_apply" ||
    rawRec === "apply" ||
    rawRec === "conditional_apply" ||
    rawRec === "pass"
      ? rawRec
      : "conditional_apply";

  const confNum = Number(obj.confidence);
  const confidence = Number.isFinite(confNum) ? clampConfidence(confNum) : 50;

  const reasoning =
    typeof obj.reasoning === "string" && obj.reasoning.trim() !== ""
      ? obj.reasoning.trim()
      : "No reasoning was provided by the model.";

  const conditions = Array.isArray(obj.conditions)
    ? obj.conditions.filter(
        (c): c is string => typeof c === "string" && c.trim() !== "",
      )
    : null;

  const hoursNum = Number(obj.timeEstimateHours);
  const timeEstimateHours = Number.isFinite(hoursNum) ? Math.max(0, hoursNum) : 0;

  const expectedROI =
    typeof obj.expectedROI === "string" && obj.expectedROI.trim() !== ""
      ? obj.expectedROI.trim()
      : "Unknown";

  return {
    recommendation,
    confidence,
    reasoning,
    conditions,
    timeEstimateHours,
    expectedROI,
  };
}

export class FitAnalysisAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-04-fit-analysis", supabase);
  }

  /**
   * Reads the agent_queue row the worker marked "processing" for this
   * org/agent this run - AutonomousAgent has no queue-item id passed into
   * run(), so the currently-processing row is the only way to recover the
   * event payload (mirrors ComplianceCheckAgent.loadPayload).
   */
  private async loadPayload(): Promise<FitAnalysisPayload | null> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as Partial<FitAnalysisPayload>;
    if (typeof payload.opportunityId !== "string") return null;
    return { opportunityId: payload.opportunityId };
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    try {
      const payload = await this.loadPayload();
      if (!payload) {
        await this.completeRun(runId, {
          outputSummary:
            "No valid fit analysis payload found on the currently processing queue item.",
          itemsFound: 0,
          itemsProcessed: 0,
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

      const { opportunityId } = payload;

      const { data: oppRow, error: oppError } = await this.supabase
        .from("opportunities")
        .select(
          "id, name, category, description, eligibility_requirements, amount_min, amount_max, eligibility_score",
        )
        .eq("id", opportunityId)
        .eq("organization_id", this.orgId)
        .maybeSingle();

      if (oppError) {
        throw new Error(`Failed to load opportunity: ${oppError.message}`);
      }
      if (!oppRow) {
        throw new Error(`Opportunity ${opportunityId} not found.`);
      }
      const opportunity = oppRow as OpportunityRow;

      const { data: orgRow } = await this.supabase
        .from("organizations")
        .select(
          "name, mission_statement, service_area, target_population, annual_budget",
        )
        .eq("id", this.orgId)
        .maybeSingle();

      const org: OrgProfile | null = orgRow
        ? {
            name: orgRow.name as string,
            missionStatement: (orgRow.mission_statement as string | null) ?? null,
            serviceArea: (orgRow.service_area as string | null) ?? null,
            targetPopulation: (orgRow.target_population as string | null) ?? null,
            annualBudget: (orgRow.annual_budget as number | null) ?? null,
          }
        : null;

      const { data: outcomeRows, error: outcomeError } = await this.supabase
        .from("outcomes")
        .select("result")
        .eq("organization_id", this.orgId)
        .eq("funder_category", opportunity.category);

      if (outcomeError) {
        throw new Error(`Failed to load outcomes: ${outcomeError.message}`);
      }

      const outcomes = outcomeRows ?? [];
      const totalOutcomes = outcomes.length;
      const awardedCount = outcomes.filter(
        (o) => (o.result as string) === "awarded",
      ).length;
      const successRate =
        totalOutcomes >= MIN_OUTCOMES_FOR_RATE
          ? Math.round((awardedCount / totalOutcomes) * 100)
          : null;

      const effort = estimateEffort(opportunity.category);

      const { system, prompt } = buildPrompt(
        org,
        opportunity,
        { totalOutcomes, awardedCount, successRate },
        effort,
      );

      const response = await callClaude({
        system,
        prompt,
        model: DEFAULT_MODEL,
        maxTokens: MAX_TOKENS,
      });
      const tokensUsed = response.usage.totalTokens;
      const result = parseFitResponse(response.text);

      let actionTaken = "recommended_pass";
      if (result.recommendation !== "pass") {
        const { error: insertError } = await this.supabase
          .from("applications")
          .insert({
            organization_id: this.orgId,
            opportunity_id: opportunity.id,
            stage: "discovered",
            fit_analysis: result,
          });

        if (insertError) {
          errors.push(
            `opportunity ${opportunity.id}: failed to create application: ${insertError.message}`,
          );
        } else {
          actionTaken = "created_application_discovered_stage";
        }
      }

      decisions.push(
        await this.logDecision({
          decisionType: "fit_analysis_complete",
          agentRunId: runId,
          entityType: "opportunity",
          entityId: opportunity.id,
          reasoning: result.reasoning,
          confidenceScore: result.confidence,
          actionTaken,
          actionPayload: { ...result },
          requiredHumanReview: result.recommendation === "conditional_apply",
        }),
      );

      await this.completeRun(runId, {
        outputSummary: `Fit analysis for "${opportunity.name}": ${result.recommendation} (${result.confidence}% confidence).`,
        itemsFound: 1,
        itemsProcessed: 1,
        tokensUsed,
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
      const message =
        err instanceof Error ? err.message : "Fit analysis run failed.";
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
