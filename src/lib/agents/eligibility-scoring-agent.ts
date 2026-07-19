// Eligibility Scoring Agent — AGENTS.md Agent 02 (agent_registry seed
// "ag-02", src/lib/agents/agent-registry-seed.ts), autonomous counterpart to
// the on-demand src/lib/agents/eligibility-scorer.ts (EligibilityScorer,
// BaseAgent-based, triggered manually from the opportunity detail page).
// This agent is the nightly/event/chain-driven version built on
// AutonomousAgent (migration 080 infrastructure: agent_runs, agent_decisions,
// agent_queue, org_autonomous_config) — it owns the same eligibility_score /
// recommendation / recommendation_reasoning columns.
//
// Deviations from the task-given spec, checked against real schema
// (src/types/database.ts) rather than applied literally:
//   - There is no `knowledge_base_profiles` table. The org profile lives on
//     `organizations` (mission_statement, tax_status, service_area,
//     target_population, annual_budget) — the same columns
//     src/lib/agents/eligibility-scorer.ts already reads for the interactive
//     scorer.
//   - governance/BEHAVIORAL_CONTRACTS.md in this repo only numbers sections
//     17-33 (v2.0 Tier 6 additions) and explicitly defers 1-16 to a v1.0 file
//     that is not present. The §5 "eligibility score and recommendation are
//     agent-owned, never edited manually" rule is taken from the citation
//     already embedded in eligibility-scorer.ts, which is the closest
//     available source of truth in this repo.
//   - "chain" scope input (`{ opportunityIds?: string[] }`) is read from the
//     agent_queue row this run is processing rather than a second run()
//     parameter, since AutonomousAgent.run() takes only triggerSource — same
//     convention as ProbabilityScoringAgent.loadChainScope().

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import { humanizeEnum } from "@/lib/utils/formatters";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";
type Recommendation = "apply" | "skip" | "review";

const MAX_TOKENS = 500;
const QUALIFIED_THRESHOLD = 70;
const DISQUALIFIED_THRESHOLD = 40;

interface OpportunityScopeRow {
  id: string;
  name: string;
  category: string;
  eligibility_requirements: string | null;
  geographic_restrictions: string | null;
  amount_min: number | null;
  amount_max: number | null;
}

interface OrgProfile {
  name: string;
  taxStatus: string | null;
  missionStatement: string | null;
  serviceArea: string | null;
  targetPopulation: string | null;
  annualBudget: number | null;
}

interface ScoreFactors {
  mission: number;
  geographic: number;
  taxStatus: number;
  budget: number;
  program: number;
}

interface ParsedScore {
  score: number;
  recommendation: Recommendation;
  reasoning: string;
  factors: ScoreFactors;
}

function recommendationFromScore(score: number): Recommendation {
  if (score >= QUALIFIED_THRESHOLD) return "apply";
  if (score < DISQUALIFIED_THRESHOLD) return "skip";
  return "review";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Parses the model's JSON reply, tolerant of stray prose/code fences. */
function parseScoreResponse(text: string): ParsedScore {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The eligibility model returned an unreadable response.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The eligibility model returned malformed JSON.");
  }

  const obj = (raw ?? {}) as {
    score?: unknown;
    recommendation?: unknown;
    reasoning?: unknown;
    factors?: unknown;
  };

  const scoreNum = Number(obj.score);
  const score = Number.isFinite(scoreNum) ? clampScore(Math.round(scoreNum)) : 0;

  const rawRec =
    typeof obj.recommendation === "string"
      ? obj.recommendation.trim().toLowerCase()
      : "";
  const recommendation: Recommendation =
    rawRec === "apply" || rawRec === "skip" || rawRec === "review"
      ? rawRec
      : recommendationFromScore(score);

  const reasoning =
    typeof obj.reasoning === "string" && obj.reasoning.trim() !== ""
      ? obj.reasoning.trim()
      : "No reasoning was provided by the model.";

  const factorsObj = (obj.factors ?? {}) as Record<string, unknown>;
  const factorNum = (key: string): number => {
    const n = Number(factorsObj[key]);
    return Number.isFinite(n) ? clampScore(Math.round(n)) : 0;
  };
  const factors: ScoreFactors = {
    mission: factorNum("mission"),
    geographic: factorNum("geographic"),
    taxStatus: factorNum("tax_status"),
    budget: factorNum("budget"),
    program: factorNum("program"),
  };

  return { score, recommendation, reasoning, factors };
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
  opp: OpportunityScopeRow,
): { system: string; prompt: string } {
  const system =
    'Score eligibility 0-100. Return JSON only: { score: number, ' +
    'recommendation: "apply"|"skip"|"review", reasoning: string, factors: ' +
    "{ mission: number, geographic: number, tax_status: number, budget: " +
    "number, program: number } }";

  const orgLines: string[] = [];
  const add = (label: string, value: string | null) => {
    if (value != null && `${value}`.trim() !== "") {
      orgLines.push(`- ${label}: ${value}`);
    }
  };
  if (org) {
    add("Legal name", org.name);
    add("Tax status", org.taxStatus);
    add("Mission", org.missionStatement);
    add("Service area", org.serviceArea);
    add("Target population", org.targetPopulation);
    add("Annual budget", formatCurrency(org.annualBudget));
  }
  const orgBlock =
    orgLines.length > 0
      ? orgLines.join("\n")
      : "No verified organization profile is available. Score conservatively.";

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
  if (opp.eligibility_requirements) {
    oppLines.push(`- Eligibility requirements: ${opp.eligibility_requirements}`);
  }
  if (opp.geographic_restrictions) {
    oppLines.push(`- Geographic restrictions: ${opp.geographic_restrictions}`);
  }

  const prompt = [
    "## Organization",
    orgBlock,
    "",
    "## Opportunity",
    oppLines.join("\n"),
    "",
    "Score the eligibility now. Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}

export class EligibilityScoringAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-02", supabase);
  }

  /**
   * "chain" scope: read the agent_queue row this run is processing for
   * input_payload.opportunityIds — same convention as
   * ProbabilityScoringAgent.loadChainScope().
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
      .select(
        "id, name, category, eligibility_requirements, geographic_restrictions, amount_min, amount_max",
      )
      .eq("organization_id", this.orgId)
      .in("id", opportunityIds);

    if (error) {
      throw new Error(`Failed to load chained opportunities: ${error.message}`);
    }
    return (data ?? []) as OpportunityScopeRow[];
  }

  /** Default scope: every org opportunity that has never been scored. */
  private async loadDefaultScope(): Promise<OpportunityScopeRow[]> {
    const { data, error } = await this.supabase
      .from("opportunities")
      .select(
        "id, name, category, eligibility_requirements, geographic_restrictions, amount_min, amount_max",
      )
      .eq("organization_id", this.orgId)
      .is("eligibility_score", null);

    if (error) {
      throw new Error(`Failed to load unscored opportunities: ${error.message}`);
    }
    return (data ?? []) as OpportunityScopeRow[];
  }

  private async loadOrgProfile(): Promise<OrgProfile | null> {
    const { data } = await this.supabase
      .from("organizations")
      .select(
        "name, tax_status, mission_statement, service_area, target_population, annual_budget",
      )
      .eq("id", this.orgId)
      .maybeSingle();

    if (!data) return null;
    return {
      name: data.name as string,
      taxStatus: (data.tax_status as string | null) ?? null,
      missionStatement: (data.mission_statement as string | null) ?? null,
      serviceArea: (data.service_area as string | null) ?? null,
      targetPopulation: (data.target_population as string | null) ?? null,
      annualBudget: (data.annual_budget as number | null) ?? null,
    };
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    const nextActions: string[] = [];

    let scored = 0;
    let qualified = 0;
    let needsReview = 0;
    let disqualified = 0;
    let tokensUsed = 0;
    const qualifiedIds: string[] = [];

    try {
      const scope =
        triggerSource === "chain"
          ? await this.loadChainScope()
          : await this.loadDefaultScope();

      const org = await this.loadOrgProfile();
      const config = await this.getOrgConfig();

      for (const opp of scope) {
        try {
          const { system, prompt } = buildPrompt(org, opp);

          const response = await callClaude({
            system,
            prompt,
            model: DEFAULT_MODEL,
            maxTokens: MAX_TOKENS,
          });
          tokensUsed += response.usage.totalTokens;

          const parsed = parseScoreResponse(response.text);
          scored++;

          const { error: updateError } = await this.supabase
            .from("opportunities")
            .update({
              eligibility_score: parsed.score,
              recommendation: parsed.recommendation,
              recommendation_reasoning: parsed.reasoning,
              updated_at: new Date().toISOString(),
            })
            .eq("id", opp.id)
            .eq("organization_id", this.orgId);

          if (updateError) {
            errors.push(
              `opportunity ${opp.id}: failed to save eligibility score: ${updateError.message}`,
            );
            continue;
          }

          const decisionType =
            parsed.score >= QUALIFIED_THRESHOLD
              ? "eligibility_qualified"
              : parsed.score < DISQUALIFIED_THRESHOLD
                ? "eligibility_disqualified"
                : "eligibility_needs_review";

          if (decisionType === "eligibility_qualified") {
            qualified++;
            qualifiedIds.push(opp.id);
          } else if (decisionType === "eligibility_disqualified") {
            disqualified++;
          } else {
            needsReview++;
          }

          decisions.push(
            await this.logDecision({
              decisionType,
              agentRunId: runId,
              entityType: "opportunity",
              entityId: opp.id,
              reasoning:
                `Scored ${opp.name}: ${parsed.score}/100. ` +
                `Recommendation: ${parsed.recommendation}.`,
              confidenceScore: parsed.score,
              actionTaken: "updated_eligibility_score",
            }),
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to score opportunity.";
          errors.push(`opportunity ${opp.id}: ${message}`);
        }
      }

      if (config.auto_score_enabled && qualifiedIds.length > 0) {
        await this.queueChainedAgent("ag-15-probability", 6, {
          opportunityIds: qualifiedIds,
        });
        nextActions.push("ag-15-probability");
      }

      const summary = { scored, qualified, needsReview, disqualified };

      await this.completeRun(runId, {
        outputSummary: JSON.stringify(summary),
        itemsFound: scope.length,
        itemsProcessed: scored,
        itemsQueued: qualifiedIds.length,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: scope.length,
        itemsProcessed: scored,
        itemsQueued: qualifiedIds.length,
        decisions,
        nextActions,
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Eligibility scoring run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: scored,
        itemsQueued: qualifiedIds.length,
        decisions,
        nextActions,
        errors: [...errors, message],
      };
    }
  }
}
