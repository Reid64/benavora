// AG-29 Fundability Scorer Agent (AutonomousAgent, migration 091:
// fundability_scores). Phase 2 per AUTONOMOUS_PLATFORM_VISION.md section
// "Fundability Intelligence Score" and AGENTS_v2.md's Phase 2-5 spec section.
//
// Numbering note: AGENTS_v2.md's own Section 5 roster already assigns AG-29 to
// a different, also-unbuilt agent (Knowledge Engine Indexer) - the Phase 2-5
// addendum in that same document flags this exact collision explicitly. This
// agent's agentId ("ag-29-fundability") is deliberately suffixed so its
// agent_type enum value (migration 091) can never collide with a future
// literal "ag-29" build.
//
// Purpose: extends the existing deterministic Grant Probability Engine
// (src/lib/intelligence/grant-probability-engine.ts's computeGrantProbability(),
// opportunity_probability_scores) into a diagnostic layer. Rather than a bare
// 0-100 score, this agent asks Claude to decompose the opportunity into
// specific deficiencies (weak narrative fit, incomplete Knowledge Base
// coverage, an underdeveloped Digital Twin, or a structural mismatch that
// can't be fixed), estimate the probability delta if the fixable deficiencies
// were resolved, and recommend one concrete fix_action per deficiency.
//
// Hard limit (matches AUTONOMOUS_PLATFORM_VISION.md's own framing for this
// feature): this agent never auto-publishes anything. It only ever inserts
// fundability_scores rows and logs a decision - it never writes to
// knowledge_base, organizational_digital_twins, or applications. Turning a
// "kb_gap" deficiency into an actual drafted KB entry (AUTONOMOUS_PLATFORM_
// VISION.md's "Auto-Fix Available" flow via a narrow AG-06 invocation) is a
// separate, not-yet-built route (`/api/intelligence/grant-probability/auto-fix`)
// and is explicitly out of scope for this agent.
//
// Per-org scope: like every other AutonomousAgent (see
// probability-scoring-agent.ts, community-need-predictor-agent.ts), this
// class operates on `this.orgId` only. A multi-org nightly loop belongs in a
// future worker/autonomous-orchestrator.ts registration, not inside this
// class - wiring that registration is out of scope here.
//
// Grounding: the prompt is built entirely from real rows this agent loads
// itself (organizations, opportunities, knowledge_base category coverage,
// organizational_digital_twins, and any existing opportunity_probability_scores
// row) - Claude is never asked to assume a fact about the org or opportunity
// it wasn't given, matching CLAUDE.md Iron Law #8 / #3.

import type { SupabaseClient } from "@supabase/supabase-js";
import { subDays } from "date-fns";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

type FixType = "kb_gap" | "twin_gap" | "structural";
type Recommendation = "apply" | "consider" | "skip" | "fix_then_apply";

const FIX_TYPES: FixType[] = ["kb_gap", "twin_gap", "structural"];
const RECOMMENDATIONS: Recommendation[] = [
  "apply",
  "consider",
  "skip",
  "fix_then_apply",
];

const MAX_TOKENS = 1500;
const MAX_PER_RUN = 8;
const STALE_AFTER_DAYS = 14;

interface OpportunityScopeRow {
  id: string;
  name: string | null;
}

interface FundabilityScoreScopeRow {
  opportunity_id: string;
  generated_at: string | null;
}

interface OrgProfile {
  name: string;
  tax_status: string | null;
  mission_statement: string | null;
  service_area: string | null;
  target_population: string | null;
  annual_budget: number | null;
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

interface ExistingProbabilityRow {
  overall_score: number | null;
  confidence: string | null;
  key_risks: string[] | null;
  key_strengths: string[] | null;
}

interface DigitalTwinRow {
  twin_completeness_score: number | null;
  key_strengths: string[] | null;
  proven_narrative_patterns: string[] | null;
}

interface RawDeficiency {
  factor?: string;
  issue?: string;
  fix_type?: string;
  fix_action?: string;
  auto_fixable?: boolean;
}

interface ValidatedDeficiency {
  factor: string;
  issue: string;
  fix_type: FixType;
  fix_action: string;
  auto_fixable: boolean;
}

interface ParsedFundabilityResult {
  overall_score: number;
  probability_without_fixes: number;
  probability_with_fixes: number;
  confidence: "high" | "medium" | "low";
  recommendation: Recommendation;
  deficiencies: ValidatedDeficiency[];
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

/** Coerces one of Claude's raw deficiency objects against fundability_scores'
 * expected shape. Invalid fix_type/missing required text fields are rejected
 * outright rather than persisted and left to a downstream reader to guess at. */
function validateDeficiency(raw: RawDeficiency): ValidatedDeficiency | null {
  if (!raw.factor || !raw.issue || !raw.fix_action) return null;
  const fix_type =
    raw.fix_type && FIX_TYPES.includes(raw.fix_type as FixType)
      ? (raw.fix_type as FixType)
      : "structural";
  return {
    factor: raw.factor,
    issue: raw.issue,
    fix_type,
    fix_action: raw.fix_action,
    auto_fixable: raw.auto_fixable === true && fix_type !== "structural",
  };
}

/** Extracts the first balanced JSON object from Claude's reply, tolerating
 * stray prose or code fences, mirroring eligibility-scorer.ts's parser. */
function parseFundabilityResponse(text: string): ParsedFundabilityResult {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The fundability model returned an unreadable response.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The fundability model returned malformed JSON.");
  }

  const obj = (raw ?? {}) as {
    overall_score?: unknown;
    probability_without_fixes?: unknown;
    probability_with_fixes?: unknown;
    confidence?: unknown;
    recommendation?: unknown;
    deficiencies?: unknown;
  };

  const overall_score = clampScore(obj.overall_score, 0);
  const probability_without_fixes = clampScore(
    obj.probability_without_fixes,
    overall_score,
  );
  const probability_with_fixes = clampScore(
    obj.probability_with_fixes,
    probability_without_fixes,
  );

  const rawConfidence =
    typeof obj.confidence === "string" ? obj.confidence.toLowerCase() : "";
  const confidence: ParsedFundabilityResult["confidence"] =
    rawConfidence === "high" || rawConfidence === "medium" || rawConfidence === "low"
      ? rawConfidence
      : "low";

  const rawRecommendation =
    typeof obj.recommendation === "string" ? obj.recommendation.toLowerCase() : "";
  const recommendation: Recommendation = RECOMMENDATIONS.includes(
    rawRecommendation as Recommendation,
  )
    ? (rawRecommendation as Recommendation)
    : overall_score >= 70
      ? "apply"
      : overall_score >= 40
        ? "fix_then_apply"
        : "skip";

  const rawDeficiencies = Array.isArray(obj.deficiencies)
    ? (obj.deficiencies as RawDeficiency[])
    : [];
  const deficiencies = rawDeficiencies
    .map(validateDeficiency)
    .filter((d): d is ValidatedDeficiency => d !== null);

  return {
    overall_score,
    probability_without_fixes,
    probability_with_fixes,
    confidence,
    recommendation,
    deficiencies,
  };
}

function buildPrompt(args: {
  org: OrgProfile;
  opportunity: OpportunityFacts;
  existingScore: ExistingProbabilityRow | null;
  twin: DigitalTwinRow | null;
  kbCategories: string[];
}): { system: string; prompt: string } {
  const { org, opportunity, existingScore, twin, kbCategories } = args;

  const system = [
    "You are a nonprofit grants analyst diagnosing exactly why an opportunity scores the way it does, so the organization knows precisely what to fix before applying.",
    "",
    "RULES:",
    "1. Judge ONLY from the facts provided below. Never invent facts about the organization, the opportunity, or its funder.",
    "2. Where a needed fact is missing, treat it as unknown and reflect that as a deficiency rather than assuming it is fine.",
    "3. probability_without_fixes should reflect current readiness as-is. probability_with_fixes should reflect the realistic probability IF every listed 'kb_gap' and 'twin_gap' deficiency were resolved - it must never exceed probability_without_fixes by more than 35 points, and structural deficiencies never move it (a structural mismatch cannot be fixed by better content).",
    "4. Classify each deficiency's fix_type: 'kb_gap' (missing/weak Knowledge Base content that a targeted narrative entry would fix), 'twin_gap' (the Organizational Digital Twin profile is incomplete), or 'structural' (a real mismatch - wrong geography, wrong mission fit, wrong funder type - that no amount of better writing fixes). Only kb_gap and twin_gap may be auto_fixable=true.",
    "5. fix_action must be one concrete, specific instruction (e.g. 'Add a budget_justification Knowledge Base entry describing your cost-per-client model'), never a vague generality like 'improve your materials'.",
    "6. Respond with ONLY a single JSON object, no prose, no code fences, in exactly this shape:",
    '{"overall_score": <integer 0-100>, "probability_without_fixes": <integer 0-100>, "probability_with_fixes": <integer 0-100>, "confidence": "high" | "medium" | "low", "recommendation": "apply" | "consider" | "fix_then_apply" | "skip", "deficiencies": [{"factor": "<short factor name>", "issue": "<one sentence>", "fix_type": "kb_gap" | "twin_gap" | "structural", "fix_action": "<one concrete instruction>", "auto_fixable": <boolean>}]}',
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
    "Knowledge Base coverage",
    kbCategories.length > 0
      ? kbCategories.join(", ")
      : "No Knowledge Base entries on file at all.",
  );
  if (twin) {
    add(
      "Organizational Digital Twin completeness",
      twin.twin_completeness_score != null ? `${twin.twin_completeness_score}%` : null,
    );
    if (twin.key_strengths && twin.key_strengths.length > 0) {
      add("Twin-documented strengths", twin.key_strengths.join("; "));
    }
    if (twin.proven_narrative_patterns && twin.proven_narrative_patterns.length > 0) {
      add("Proven narrative patterns on file", twin.proven_narrative_patterns.join("; "));
    }
  } else {
    orgLines.push("- Organizational Digital Twin: none built yet for this org.");
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

  if (existingScore) {
    oppLines.push(
      `- Existing Grant Probability Engine score: ${existingScore.overall_score ?? "n/a"}/100 (confidence: ${
        existingScore.confidence ?? "unknown"
      })`,
    );
    if (existingScore.key_risks && existingScore.key_risks.length > 0) {
      oppLines.push(`- Known risks: ${existingScore.key_risks.join("; ")}`);
    }
    if (existingScore.key_strengths && existingScore.key_strengths.length > 0) {
      oppLines.push(`- Known strengths: ${existingScore.key_strengths.join("; ")}`);
    }
  } else {
    oppLines.push("- No Grant Probability Engine score computed yet for this opportunity.");
  }

  const prompt = [
    "## Organization",
    orgLines.join("\n"),
    "",
    "## Opportunity",
    oppLines.join("\n"),
    "",
    "Diagnose the fundability now. Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}

export class FundabilityScorerAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-29-fundability", supabase);
  }

  /** "chain" scope: an upstream agent (e.g. a future AG-15 extension) enqueues
   * this agent's own agent_queue row with input_payload.opportunityIds -
   * mirrors probability-scoring-agent.ts's loadChainScope(). */
  private async loadChainScope(): Promise<OpportunityScopeRow[]> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("org_id", this.orgId)
      .eq("agent_id", "ag-29-fundability")
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as { opportunityIds?: unknown };
    const opportunityIds = Array.isArray(payload.opportunityIds)
      ? payload.opportunityIds.filter((id): id is string => typeof id === "string")
      : [];
    if (opportunityIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from("opportunities")
      .select("id, name")
      .eq("organization_id", this.orgId)
      .in("id", opportunityIds);

    if (error) throw new Error(`Failed to load chained opportunities: ${error.message}`);
    return (data ?? []) as OpportunityScopeRow[];
  }

  /** Default scope: open opportunities for this org with no fundability_scores
   * row yet, or whose most recent row is older than STALE_AFTER_DAYS. */
  private async loadDefaultScope(): Promise<OpportunityScopeRow[]> {
    const [opportunitiesRes, scoresRes] = await Promise.all([
      this.supabase
        .from("opportunities")
        .select("id, name")
        .eq("organization_id", this.orgId)
        .eq("status", "open"),
      this.supabase
        .from("fundability_scores")
        .select("opportunity_id, generated_at")
        .eq("org_id", this.orgId),
    ]);

    if (opportunitiesRes.error) {
      throw new Error(`Failed to load open opportunities: ${opportunitiesRes.error.message}`);
    }
    if (scoresRes.error) {
      throw new Error(`Failed to load existing fundability scores: ${scoresRes.error.message}`);
    }

    const latestByOpportunity = new Map<string, string | null>();
    for (const row of (scoresRes.data ?? []) as FundabilityScoreScopeRow[]) {
      const existing = latestByOpportunity.get(row.opportunity_id);
      if (!existing || (row.generated_at && row.generated_at > existing)) {
        latestByOpportunity.set(row.opportunity_id, row.generated_at);
      }
    }

    const staleThreshold = subDays(new Date(), STALE_AFTER_DAYS);
    const opportunities = (opportunitiesRes.data ?? []) as OpportunityScopeRow[];

    return opportunities
      .filter((opp) => {
        if (!latestByOpportunity.has(opp.id)) return true;
        const generatedAt = latestByOpportunity.get(opp.id);
        if (!generatedAt) return true;
        return new Date(generatedAt) < staleThreshold;
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

  private async loadExistingProbability(
    opportunityId: string,
  ): Promise<ExistingProbabilityRow | null> {
    const { data } = await this.supabase
      .from("opportunity_probability_scores")
      .select("overall_score, confidence, key_risks, key_strengths")
      .eq("opportunity_id", opportunityId)
      .eq("organization_id", this.orgId)
      .maybeSingle();
    return (data ?? null) as ExistingProbabilityRow | null;
  }

  private async loadDigitalTwin(): Promise<DigitalTwinRow | null> {
    const { data } = await this.supabase
      .from("organizational_digital_twins")
      .select("twin_completeness_score, key_strengths, proven_narrative_patterns")
      .eq("organization_id", this.orgId)
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

  override async run(triggerSource: TriggerSource): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;
    let scored = 0;
    let queued = 0;

    try {
      const org = await this.loadOrgProfile();
      if (!org) throw new Error(`Could not load organization ${this.orgId}.`);

      const scope =
        triggerSource === "chain" ? await this.loadChainScope() : await this.loadDefaultScope();

      const [twin, kbCategories] = await Promise.all([
        this.loadDigitalTwin(),
        this.loadKnowledgeBaseCategories(),
      ]);

      for (const opp of scope.slice(0, MAX_PER_RUN)) {
        try {
          const opportunity = await this.loadOpportunityFacts(opp.id);
          if (!opportunity) {
            errors.push(`Opportunity ${opp.id} not found or not in this org - skipped.`);
            continue;
          }

          const existingScore = await this.loadExistingProbability(opp.id);

          const { system, prompt } = buildPrompt({
            org,
            opportunity,
            existingScore,
            twin,
            kbCategories,
          });

          const response = await callClaude({
            system,
            prompt,
            model: DEFAULT_MODEL,
            maxTokens: MAX_TOKENS,
          });
          tokensUsed += response.usage.totalTokens;

          const parsed = parseFundabilityResponse(response.text);
          scored++;

          const { data: inserted, error: insertError } = await this.supabase
            .from("fundability_scores")
            .insert({
              org_id: this.orgId,
              opportunity_id: opp.id,
              overall_score: parsed.overall_score,
              probability_without_fixes: parsed.probability_without_fixes,
              probability_with_fixes: parsed.probability_with_fixes,
              confidence: parsed.confidence,
              deficiencies: parsed.deficiencies,
              recommendation: parsed.recommendation,
            })
            .select("id")
            .single();

          if (insertError || !inserted) {
            errors.push(
              `Failed to save fundability score for "${opportunity.name}": ${
                insertError?.message ?? "no row returned"
              }`,
            );
            continue;
          }
          queued++;

          const fixableCount = parsed.deficiencies.filter((d) => d.auto_fixable).length;
          decisions.push(
            await this.logDecision({
              decisionType: "fundability_scored",
              agentRunId: runId,
              entityType: "opportunity",
              entityId: opp.id,
              reasoning:
                `Scored "${opportunity.name}" at ${parsed.overall_score}/100 ` +
                `(${parsed.probability_without_fixes}% as-is, ${parsed.probability_with_fixes}% if fixed). ` +
                `Found ${parsed.deficiencies.length} deficiency(ies), ${fixableCount} auto-fixable.`,
              confidenceScore: parsed.overall_score,
              actionTaken: `Recorded fundability score and ${parsed.deficiencies.length} deficiency(ies).`,
              actionPayload: {
                deficiencies: parsed.deficiencies,
                recommendation: parsed.recommendation,
              },
              requiredHumanReview: fixableCount > 0,
            }),
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to score opportunity fundability.";
          errors.push(`opportunity ${opp.id}: ${message}`);
        }
      }

      const summary = `Scored ${scored} of ${scope.length} opportunity(ies); ${queued} fundability_scores row(s) saved.`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: scope.length,
        itemsProcessed: scored,
        itemsQueued: queued,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: scope.length,
        itemsProcessed: scored,
        itemsQueued: queued,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fundability scoring failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: scored,
        itemsQueued: queued,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
