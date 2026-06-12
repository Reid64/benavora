// Eligibility Scoring Agent — AGENTS.md Agent 02.
//
// Evaluates whether the organization qualifies for an opportunity by comparing
// the verified organization profile against the opportunity's eligibility
// requirements, then writes a 0-100 score, an apply/skip/review recommendation,
// and per-criterion reasoning back onto the opportunity record.
//
// Scoring rubric (AGENTS.md Agent 02):
//   80-100 strong match  -> apply
//   60-79  moderate      -> review
//   40-59  weak          -> skip (unless strategic)
//   0-39   poor          -> skip
//
// Per BEHAVIORAL_CONTRACTS §5 the eligibility score and recommendation are set
// ONLY by this agent, never edited manually.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { humanizeEnum } from "@/lib/utils/formatters";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

export type EligibilityRecommendation = "apply" | "skip" | "review";

export interface EligibilityInput {
  opportunityId: string;
}

export interface EligibilityResult {
  opportunityId: string;
  /** 0-100, clamped. */
  eligibilityScore: number;
  recommendation: EligibilityRecommendation;
  recommendationReasoning: string;
}

export interface EligibilityScorerOptions extends BaseAgentOptions {
  /** Model override (resolved from platform_config `ai.model` by the route). */
  model?: string;
  /** Max output tokens (platform_config `ai.max_tokens`). */
  maxTokens?: number;
}

/** Verified profile facts the agent compares against the opportunity. */
interface OrgProfile {
  name: string;
  taxStatus: string | null;
  missionStatement: string | null;
  serviceArea: string | null;
  targetPopulation: string | null;
  annualBudget: number | null;
}

/** The opportunity fields that drive eligibility. */
interface OpportunityFacts {
  name: string;
  category: string;
  description: string | null;
  eligibilityRequirements: string | null;
  geographicRestrictions: string | null;
  amountMin: number | null;
  amountMax: number | null;
}

export class EligibilityScorer extends BaseAgent<
  EligibilityInput,
  EligibilityResult
> {
  readonly agentType: AgentType = "eligibility_scoring";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: EligibilityScorerOptions) {
    super(options);
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: EligibilityInput,
  ): Promise<AgentExecution<EligibilityResult>> {
    const opportunityId = input.opportunityId;

    // Opportunity + organization profile, both scoped to the tenant so the
    // agent is correct under the service role client as well (RLS off there).
    const [oppRes, orgRes] = await Promise.all([
      this.client
        .from("opportunities")
        .select(
          "id, name, category, description, eligibility_requirements, geographic_restrictions, amount_min, amount_max",
        )
        .eq("id", opportunityId)
        .eq("organization_id", this.organizationId)
        .single(),
      this.client
        .from("organizations")
        .select(
          "name, tax_status, mission_statement, service_area, target_population, annual_budget",
        )
        .eq("id", this.organizationId)
        .single(),
    ]);

    if (oppRes.error || !oppRes.data) {
      throw new AgentError("Opportunity not found.", "not_found", 404);
    }

    const opportunity: OpportunityFacts = {
      name: oppRes.data.name as string,
      category: oppRes.data.category as string,
      description: (oppRes.data.description as string | null) ?? null,
      eligibilityRequirements:
        (oppRes.data.eligibility_requirements as string | null) ?? null,
      geographicRestrictions:
        (oppRes.data.geographic_restrictions as string | null) ?? null,
      amountMin: (oppRes.data.amount_min as number | null) ?? null,
      amountMax: (oppRes.data.amount_max as number | null) ?? null,
    };

    const org: OrgProfile | null = orgRes.data
      ? {
          name: orgRes.data.name as string,
          taxStatus: (orgRes.data.tax_status as string | null) ?? null,
          missionStatement:
            (orgRes.data.mission_statement as string | null) ?? null,
          serviceArea: (orgRes.data.service_area as string | null) ?? null,
          targetPopulation:
            (orgRes.data.target_population as string | null) ?? null,
          annualBudget: (orgRes.data.annual_budget as number | null) ?? null,
        }
      : null;

    const { system, prompt } = buildEligibilityPrompt(org, opportunity);

    const response = await callClaude({
      system,
      prompt,
      model: this.model,
      maxTokens: this.maxTokens,
    });

    const parsed = parseScoreResponse(response.text);

    // Persist the agent-owned fields (BEHAVIORAL_CONTRACTS §5). Scoped by
    // organization_id so a service role write can never cross tenants.
    const { error: updateError } = await this.client
      .from("opportunities")
      .update({
        eligibility_score: parsed.score,
        recommendation: parsed.recommendation,
        recommendation_reasoning: parsed.reasoning,
        updated_at: new Date().toISOString(),
      })
      .eq("id", opportunityId)
      .eq("organization_id", this.organizationId);

    if (updateError) {
      throw new AgentError(
        "Failed to save the eligibility score.",
        "write_failed",
      );
    }

    return {
      data: {
        opportunityId,
        eligibilityScore: parsed.score,
        recommendation: parsed.recommendation,
        recommendationReasoning: parsed.reasoning,
      },
      outputSummary: `Scored "${opportunity.name}" ${parsed.score}/100 → ${parsed.recommendation}.`,
      itemsFound: 1,
      itemsProcessed: 1,
      tokensUsed: response.usage.totalTokens,
    };
  }
}

// --- prompt ------------------------------------------------------------------

function formatCurrency(amount: number | null): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildEligibilityPrompt(
  org: OrgProfile | null,
  opportunity: OpportunityFacts,
): { system: string; prompt: string } {
  const system = [
    "You are a nonprofit grants analyst scoring how well an organization fits a funding opportunity.",
    "",
    "RULES:",
    "1. Judge ONLY from the organizational facts provided. Never invent facts about the organization.",
    "2. Where a fact needed to judge a criterion is missing, treat it as unknown and lower confidence for that criterion — do not assume it qualifies.",
    "3. Score 0-100 using this rubric: 80-100 strong match (apply); 60-79 moderate (review); 40-59 weak (skip unless strategic); 0-39 poor (skip).",
    "4. Weigh five criteria: mission alignment, geographic match, tax-status qualification, budget appropriateness, and program relevance.",
    "5. Respond with ONLY a single JSON object, no prose, no code fences, in exactly this shape:",
    '{"score": <integer 0-100>, "recommendation": "apply" | "review" | "skip", "reasoning": "<one paragraph covering each of the five criteria>"}',
  ].join("\n");

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
      : "No verified organization profile is available. Score conservatively and explain that missing profile data limits confidence.";

  const oppLines: string[] = [
    `- Name: ${opportunity.name}`,
    `- Category: ${humanizeEnum(opportunity.category)}`,
  ];
  const amountRange = [
    formatCurrency(opportunity.amountMin),
    formatCurrency(opportunity.amountMax),
  ];
  if (amountRange[0] || amountRange[1]) {
    oppLines.push(
      `- Award range: ${amountRange[0] ?? "?"} – ${amountRange[1] ?? "?"}`,
    );
  }
  if (opportunity.description) {
    oppLines.push(`- What the funder wants: ${opportunity.description}`);
  }
  if (opportunity.eligibilityRequirements) {
    oppLines.push(
      `- Eligibility requirements: ${opportunity.eligibilityRequirements}`,
    );
  }
  if (opportunity.geographicRestrictions) {
    oppLines.push(
      `- Geographic restrictions: ${opportunity.geographicRestrictions}`,
    );
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

// --- response parsing --------------------------------------------------------

interface ParsedScore {
  score: number;
  recommendation: EligibilityRecommendation;
  reasoning: string;
}

/** Map a score to the rubric's recommendation. Used as a fallback. */
function recommendationFromScore(score: number): EligibilityRecommendation {
  if (score >= 80) return "apply";
  if (score >= 60) return "review";
  return "skip";
}

/**
 * Extract score/recommendation/reasoning from the model's reply. Tolerant of
 * stray prose or code fences around the JSON: it scans for the first balanced
 * object. Falls back to deriving the recommendation from the score when the
 * model omits or mis-spells it, so a usable result is always returned.
 */
export function parseScoreResponse(text: string): ParsedScore {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AgentError(
      "The eligibility model returned an unreadable response.",
      "bad_model_output",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AgentError(
      "The eligibility model returned malformed JSON.",
      "bad_model_output",
    );
  }

  const obj = (raw ?? {}) as {
    score?: unknown;
    recommendation?: unknown;
    reasoning?: unknown;
  };

  const scoreNum = Number(obj.score);
  const score = Number.isFinite(scoreNum)
    ? Math.max(0, Math.min(100, Math.round(scoreNum)))
    : 0;

  const rawRec =
    typeof obj.recommendation === "string"
      ? obj.recommendation.trim().toLowerCase()
      : "";
  const recommendation: EligibilityRecommendation =
    rawRec === "apply" || rawRec === "review" || rawRec === "skip"
      ? rawRec
      : recommendationFromScore(score);

  const reasoning =
    typeof obj.reasoning === "string" && obj.reasoning.trim() !== ""
      ? obj.reasoning.trim()
      : "No reasoning was provided by the model.";

  return { score, recommendation, reasoning };
}
