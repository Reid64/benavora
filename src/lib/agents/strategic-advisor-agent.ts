// AG-40 Strategic Advisor Agent (AutonomousAgent, migration 080
// infrastructure + migration 086_strategic_advisor.sql substrate:
// strategic_recommendations). AUTONOMOUS_PLATFORM_VISION.md Phase 5, "AI
// Strategic Advisor": the capstone agent -- it reads the output of every
// other agent in the roster rather than raw tables directly (per the vision
// doc's own framing) and synthesizes a single prioritized, proactive action
// list. This implementation reads the underlying tables those other agents
// already write to (funding_forecasts, relationship_recommendations,
// reputation_alerts/reputation_signals, deadlines, platform_learning_patterns)
// rather than each agent's raw agent_runs output, since that's what those
// agents' own final state actually looks like.
//
// Numbering + dependency note (AGENTS_v2.md section 5, AG-40 spec): by
// design this agent depends on nearly everything else in the roster, and
// several of its named upstream sources (donor_intent_scores /
// "corporate_intent_signals", community_need_signals, and a dedicated
// roi_insights table) are Phase 2-5 PLANNED tables that don't exist in this
// schema yet -- see AGENTS_v2.md's own Phase 2-5 section, which states
// plainly that none of AG-29 through AG-39 have any code or migrations yet.
// Per the task spec's own "(if exist)" qualifier on those three sources,
// every load below is defensive: a missing table degrades to an empty
// signal, it never throws and never blocks the run. When those tables land
// in a later migration, this agent starts incorporating them automatically
// with no code change required, as long as they carry an `org_id` column.
//
// `organizations` has no `ntee_code` column anywhere in this schema (checked
// across every migration) despite platform_learning_patterns.ntee_code
// existing as a column -- there is nothing to join on. Scoping learning
// patterns to "this org's own NTEE" as the task describes is therefore not
// possible; this file falls back to the org's dominant funder_category from
// its own outcomes history instead, the same fallback SimulationAgent
// (src/lib/agents/simulation-agent.ts) already uses for the same reason.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import { MIN_OUTCOMES_FOR_RATE } from "@/lib/utils/constants";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

const MAX_TOKENS = 2000;
const MAX_LEARNING_PATTERNS = 5;
const MIN_PATTERN_SAMPLE_COUNT = 3;
const DEDUP_WINDOW_DAYS = 30;
const TERMINAL_STAGES = new Set(["awarded", "denied"]);

const RECOMMENDATION_CATEGORIES = [
  "apply_now",
  "postpone",
  "hire",
  "expand",
  "pivot",
  "partnership",
  "board",
  "technology",
  "compliance",
] as const;
type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

const URGENCY_LEVELS = ["immediate", "urgent", "normal", "low"] as const;
type Urgency = (typeof URGENCY_LEVELS)[number];

function isRecommendationCategory(
  value: unknown,
): value is RecommendationCategory {
  return (
    typeof value === "string" &&
    (RECOMMENDATION_CATEGORIES as readonly string[]).includes(value)
  );
}

function isUrgency(value: unknown): value is Urgency {
  return (
    typeof value === "string" && (URGENCY_LEVELS as readonly string[]).includes(value)
  );
}

interface RawRecommendation {
  recommendation_category?: unknown;
  title?: unknown;
  recommendation?: unknown;
  reasoning?: unknown;
  urgency?: unknown;
  time_sensitivity?: unknown;
  expected_impact?: unknown;
  confidence_score?: unknown;
  data_basis?: unknown;
}

interface ValidatedRecommendation {
  recommendation_category: RecommendationCategory;
  title: string;
  recommendation: string;
  reasoning: string;
  urgency: Urgency;
  time_sensitivity: string | null;
  expected_impact: string | null;
  confidence_score: number;
  data_basis: Record<string, unknown>;
}

interface PipelineSnapshot {
  totalApplications: number;
  activePipelineValue: number;
  stageDistribution: Record<string, number>;
}

interface SuccessRateSnapshot {
  overallRate: number | null;
  sampleSize: number;
  byCategory: Record<string, number>;
}

interface ForecastSnapshot {
  forecast_period: string;
  projected_min: number | null;
  projected_max: number | null;
  projected_most_likely: number | null;
  confidence: number | null;
  key_risks: string[] | null;
  key_opportunities: string[] | null;
  recommended_actions: string[] | null;
}

interface RelationshipRecSnapshot {
  recommendation_text: string;
  urgency: string;
  entity_type: string;
}

interface ReputationAlertSnapshot {
  headline: string;
  severity: string;
  entity_type: string;
}

interface DeadlineSnapshot {
  title: string;
  due_date: string;
  deadline_type: string;
}

interface LearningPatternSnapshot {
  pattern_type: string;
  pattern_content: string;
  success_rate: number | null;
  sample_count: number;
}

/** Best-effort JSON array extraction - mirrors the parse-then-regex-fallback
 * convention in simulation-agent.ts / learning-network-aggregator-agent.ts.
 * Claude is asked for JSON-only output but occasionally wraps it in prose or
 * a markdown fence. */
function parseRecommendationArray(text: string): RawRecommendation[] {
  const tryParse = (candidate: string): RawRecommendation[] | null => {
    try {
      const parsed: unknown = JSON.parse(candidate);
      return Array.isArray(parsed) ? (parsed as RawRecommendation[]) : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(text.trim());
  if (direct) return direct;

  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    const fromMatch = tryParse(match[0]);
    if (fromMatch) return fromMatch;
  }

  throw new Error("Claude did not return a parseable recommendation JSON array.");
}

/** Validates and coerces one raw Claude recommendation. Returns null (and
 * never throws) for a malformed entry - one bad recommendation must not sink
 * the rest of the batch, matching this codebase's "never fabricate a field
 * it can't extract" convention (AGENTS_v2.md, repeated across every agent
 * spec) applied to rejecting rather than guessing at invalid data. */
function validateRecommendation(
  raw: RawRecommendation,
): ValidatedRecommendation | null {
  if (!isRecommendationCategory(raw.recommendation_category)) return null;
  if (typeof raw.title !== "string" || raw.title.trim() === "") return null;
  if (typeof raw.recommendation !== "string" || raw.recommendation.trim() === "")
    return null;
  if (typeof raw.reasoning !== "string" || raw.reasoning.trim() === "")
    return null;

  const urgency = isUrgency(raw.urgency) ? raw.urgency : "normal";

  const confidenceRaw = Number(raw.confidence_score);
  const confidence_score = Number.isFinite(confidenceRaw)
    ? Math.min(100, Math.max(0, Math.round(confidenceRaw)))
    : 60;

  const data_basis =
    raw.data_basis && typeof raw.data_basis === "object"
      ? (raw.data_basis as Record<string, unknown>)
      : {};

  return {
    recommendation_category: raw.recommendation_category,
    title: raw.title.trim(),
    recommendation: raw.recommendation.trim(),
    reasoning: raw.reasoning.trim(),
    urgency,
    time_sensitivity:
      typeof raw.time_sensitivity === "string" ? raw.time_sensitivity : null,
    expected_impact:
      typeof raw.expected_impact === "string" ? raw.expected_impact : null,
    confidence_score,
    data_basis,
  };
}

export class StrategicAdvisorAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-40-strategic-advisor", supabase);
  }

  /** Active (non-terminal-stage) pipeline value and stage distribution. */
  private async loadPipelineSnapshot(): Promise<PipelineSnapshot> {
    const { data, error } = await this.supabase
      .from("applications")
      .select("stage, requested_amount")
      .eq("organization_id", this.orgId);

    if (error) {
      throw new Error(`Failed to load applications pipeline: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{
      stage: string;
      requested_amount: number | null;
    }>;

    const stageDistribution: Record<string, number> = {};
    let activePipelineValue = 0;
    for (const row of rows) {
      stageDistribution[row.stage] = (stageDistribution[row.stage] ?? 0) + 1;
      if (!TERMINAL_STAGES.has(row.stage)) {
        activePipelineValue += row.requested_amount ?? 0;
      }
    }

    return {
      totalApplications: rows.length,
      activePipelineValue,
      stageDistribution,
    };
  }

  /** Success rate over the trailing 12 months, overall and by category
   * (only categories with >= MIN_OUTCOMES_FOR_RATE outcomes are reported -
   * matches OutcomeAnalyzerAgent's own threshold reasoning). */
  private async loadSuccessRateSnapshot(): Promise<SuccessRateSnapshot> {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const { data, error } = await this.supabase
      .from("outcomes")
      .select("result, funder_category, opportunity_category, recorded_at")
      .eq("organization_id", this.orgId)
      .gte("recorded_at", twelveMonthsAgo.toISOString());

    if (error) {
      throw new Error(`Failed to load outcomes: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{
      result: string;
      funder_category: string | null;
      opportunity_category: string | null;
    }>;

    const tallies = new Map<string, { total: number; awarded: number }>();
    let overallAwarded = 0;
    for (const row of rows) {
      if (row.result === "awarded") overallAwarded += 1;
      const category = row.opportunity_category ?? row.funder_category;
      if (!category) continue;
      const tally = tallies.get(category) ?? { total: 0, awarded: 0 };
      tally.total += 1;
      if (row.result === "awarded") tally.awarded += 1;
      tallies.set(category, tally);
    }

    const byCategory: Record<string, number> = {};
    for (const [category, tally] of tallies) {
      if (tally.total >= MIN_OUTCOMES_FOR_RATE) {
        byCategory[category] = Number((tally.awarded / tally.total).toFixed(3));
      }
    }

    return {
      overallRate:
        rows.length >= MIN_OUTCOMES_FOR_RATE
          ? Number((overallAwarded / rows.length).toFixed(3))
          : null,
      sampleSize: rows.length,
      byCategory,
    };
  }

  private async loadLatestForecast(): Promise<ForecastSnapshot | null> {
    const { data } = await this.supabase
      .from("funding_forecasts")
      .select(
        "forecast_period, projected_min, projected_max, projected_most_likely, confidence, key_risks, key_opportunities, recommended_actions",
      )
      .eq("org_id", this.orgId)
      .order("forecast_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    return (data as ForecastSnapshot | null) ?? null;
  }

  /** Defensive load for Phase 2-5 tables that may not exist in this schema
   * yet (roi_insights, community_need_signals, "corporate_intent_signals" /
   * donor_intent_scores - see file header). Any error, including "relation
   * does not exist," degrades to an empty signal rather than failing the
   * run. */
  private async loadOptionalOrgRows(
    table: string,
    columns: string,
  ): Promise<Record<string, unknown>[]> {
    try {
      const { data, error } = await this.supabase
        .from(table)
        .select(columns)
        .eq("org_id", this.orgId)
        .limit(10);
      if (error) return [];
      return (data ?? []) as unknown as Record<string, unknown>[];
    } catch {
      return [];
    }
  }

  private async loadPendingRelationshipRecommendations(): Promise<
    RelationshipRecSnapshot[]
  > {
    const { data } = await this.supabase
      .from("relationship_recommendations")
      .select("recommendation_text, urgency, entity_type")
      .eq("org_id", this.orgId)
      .eq("status", "pending")
      .limit(10);
    return (data ?? []) as RelationshipRecSnapshot[];
  }

  /** reputation_alerts carries no severity of its own - severity lives on
   * the joined reputation_signals row (migration 076). */
  private async loadUnreadCriticalReputationAlerts(): Promise<
    ReputationAlertSnapshot[]
  > {
    const { data } = await this.supabase
      .from("reputation_alerts")
      .select("status, reputation_signals(headline, severity, entity_type)")
      .eq("org_id", this.orgId)
      .eq("status", "unread")
      .limit(20);

    const rows = (data ?? []) as unknown as Array<{
      reputation_signals: {
        headline: string;
        severity: string;
        entity_type: string;
      } | null;
    }>;

    return rows
      .map((r) => r.reputation_signals)
      .filter(
        (s): s is ReputationAlertSnapshot =>
          s !== null && (s.severity === "critical" || s.severity === "high"),
      );
  }

  private async loadUpcomingDeadlines(): Promise<DeadlineSnapshot[]> {
    const today = new Date().toISOString().slice(0, 10);
    const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { data } = await this.supabase
      .from("deadlines")
      .select("title, due_date, deadline_type")
      .eq("organization_id", this.orgId)
      .eq("is_completed", false)
      .gte("due_date", today)
      .lte("due_date", in90Days)
      .order("due_date", { ascending: true })
      .limit(15);

    return (data ?? []) as DeadlineSnapshot[];
  }

  /** Most common funder_category among this org's own outcomes - used only
   * to scope which platform_learning_patterns rows are relevant, since
   * organizations has no ntee_code to join on (see file header). */
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

  private async loadLearningPatterns(
    funderCategory: string | null,
  ): Promise<LearningPatternSnapshot[]> {
    let query = this.supabase
      .from("platform_learning_patterns")
      .select("pattern_type, pattern_content, success_rate, sample_count")
      .gte("sample_count", MIN_PATTERN_SAMPLE_COUNT)
      .order("sample_count", { ascending: false })
      .limit(MAX_LEARNING_PATTERNS);

    if (funderCategory) {
      query = query.eq("funder_category", funderCategory);
    }

    const { data } = await query;
    return (data ?? []) as LearningPatternSnapshot[];
  }

  private buildPrompt(context: {
    pipeline: PipelineSnapshot;
    successRate: SuccessRateSnapshot;
    forecast: ForecastSnapshot | null;
    roiInsights: Record<string, unknown>[];
    communityNeedSignals: Record<string, unknown>[];
    corporateIntentSignals: Record<string, unknown>[];
    relationshipRecs: RelationshipRecSnapshot[];
    reputationAlerts: ReputationAlertSnapshot[];
    upcomingDeadlines: DeadlineSnapshot[];
    learningPatterns: LearningPatternSnapshot[];
  }): { system: string; prompt: string } {
    const system =
      "You are a strategic advisor to a nonprofit executive director. " +
      "Analyze all provided intelligence and generate 3-7 specific proactive " +
      "strategic recommendations. These are unsolicited insights the ED has " +
      "not asked for but needs to hear. Be specific with numbers. Return " +
      "JSON only, no prose, no markdown fences - a JSON array matching " +
      'exactly this shape: [{ "recommendation_category": ' +
      '"apply_now"|"postpone"|"hire"|"expand"|"pivot"|"partnership"|"board"|' +
      '"technology"|"compliance", "title": string, "recommendation": string, ' +
      '"reasoning": string, "urgency": "immediate"|"urgent"|"normal"|"low", ' +
      '"time_sensitivity": string, "expected_impact": string, ' +
      '"confidence_score": number, "data_basis": object }]';

    const lines: string[] = [
      `Active pipeline: ${context.pipeline.totalApplications} application(s) ` +
        `totaling $${context.pipeline.activePipelineValue} in non-terminal stages.`,
      `Stage distribution: ${JSON.stringify(context.pipeline.stageDistribution)}`,
      context.successRate.overallRate != null
        ? `12-month success rate: ${Math.round(context.successRate.overallRate * 100)}% ` +
          `(n=${context.successRate.sampleSize})`
        : `12-month success rate: insufficient data (n=${context.successRate.sampleSize}, ` +
          `need ${MIN_OUTCOMES_FOR_RATE}+)`,
      `Success rate by category: ${JSON.stringify(context.successRate.byCategory)}`,
    ];

    if (context.forecast) {
      lines.push(
        `Latest funding forecast (${context.forecast.forecast_period}): ` +
          `most likely $${context.forecast.projected_most_likely ?? "unknown"} ` +
          `(range $${context.forecast.projected_min ?? "?"}-$${context.forecast.projected_max ?? "?"}, ` +
          `confidence ${context.forecast.confidence ?? "unknown"}). ` +
          `Key risks: ${(context.forecast.key_risks ?? []).join("; ") || "none on file"}. ` +
          `Key opportunities: ${(context.forecast.key_opportunities ?? []).join("; ") || "none on file"}.`,
      );
    } else {
      lines.push("No funding forecast on file yet.");
    }

    lines.push(
      `Pending relationship recommendations (${context.relationshipRecs.length}): ` +
        (context.relationshipRecs
          .map((r) => `[${r.urgency}] ${r.entity_type}: ${r.recommendation_text}`)
          .join(" | ") || "none"),
    );
    lines.push(
      `Unread critical/high reputation alerts (${context.reputationAlerts.length}): ` +
        (context.reputationAlerts
          .map((r) => `[${r.severity}] ${r.entity_type}: ${r.headline}`)
          .join(" | ") || "none"),
    );
    lines.push(
      `Deadlines due in the next 90 days (${context.upcomingDeadlines.length}): ` +
        (context.upcomingDeadlines
          .map((d) => `${d.due_date} - ${d.title} (${d.deadline_type})`)
          .join(" | ") || "none"),
    );
    lines.push(
      `Cross-org platform learning patterns for this org's dominant funder ` +
        `category (${context.learningPatterns.length}): ` +
        (context.learningPatterns
          .map(
            (p) =>
              `[${p.pattern_type}] ${p.pattern_content} (sample_count=${p.sample_count}${
                p.success_rate != null ? `, success_rate=${p.success_rate}` : ""
              })`,
          )
          .join(" | ") || "none available yet"),
    );
    lines.push(
      `ROI insights (${context.roiInsights.length}), community need signals ` +
        `(${context.communityNeedSignals.length}), corporate intent signals ` +
        `(${context.corporateIntentSignals.length}): ` +
        "not yet available in this build - PLANNED tables, treat as absent context.",
    );

    lines.push(
      "",
      "Lead with the most actionable item. Prioritize by urgency and by how",
      "many independent signals above point at the same conclusion. Do not",
      "invent numbers the data above doesn't support.",
    );

    return { system, prompt: lines.join("\n") };
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    try {
      const [
        pipeline,
        successRate,
        forecast,
        roiInsights,
        communityNeedSignals,
        corporateIntentSignals,
        relationshipRecs,
        reputationAlerts,
        upcomingDeadlines,
      ] = await Promise.all([
        this.loadPipelineSnapshot(),
        this.loadSuccessRateSnapshot(),
        this.loadLatestForecast(),
        this.loadOptionalOrgRows("roi_insights", "*"),
        this.loadOptionalOrgRows("community_need_signals", "*"),
        this.loadOptionalOrgRows("corporate_intent_signals", "*"),
        this.loadPendingRelationshipRecommendations(),
        this.loadUnreadCriticalReputationAlerts(),
        this.loadUpcomingDeadlines(),
      ]);

      const dominantFunderCategory = await this.loadDominantFunderCategory();
      const learningPatterns = await this.loadLearningPatterns(
        dominantFunderCategory,
      );

      const { system, prompt } = this.buildPrompt({
        pipeline,
        successRate,
        forecast,
        roiInsights,
        communityNeedSignals,
        corporateIntentSignals,
        relationshipRecs,
        reputationAlerts,
        upcomingDeadlines,
        learningPatterns,
      });

      const response = await callClaude({
        system,
        prompt,
        model: DEFAULT_MODEL,
        maxTokens: MAX_TOKENS,
        temperature: 0.4,
      });

      const rawRecommendations = parseRecommendationArray(response.text);
      const validated = rawRecommendations
        .map(validateRecommendation)
        .filter((r): r is ValidatedRecommendation => r !== null);

      if (validated.length === 0) {
        await this.completeRun(runId, {
          outputSummary: "Claude returned no valid recommendations this run.",
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          tokensUsed: response.usage.totalTokens,
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

      const dedupCutoff = new Date(
        Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      let immediateCount = 0;
      let urgentCount = 0;
      let normalCount = 0;
      let lowCount = 0;
      let skippedDuplicates = 0;

      for (const rec of validated) {
        const { data: existing } = await this.supabase
          .from("strategic_recommendations")
          .select("id")
          .eq("org_id", this.orgId)
          .eq("recommendation_category", rec.recommendation_category)
          .eq("status", "pending")
          .gte("generated_at", dedupCutoff)
          .limit(1)
          .maybeSingle();

        if (existing) {
          skippedDuplicates += 1;
          continue;
        }

        const { data: inserted, error: insertError } = await this.supabase
          .from("strategic_recommendations")
          .insert({
            org_id: this.orgId,
            recommendation_category: rec.recommendation_category,
            title: rec.title,
            recommendation: rec.recommendation,
            reasoning: rec.reasoning,
            urgency: rec.urgency,
            time_sensitivity: rec.time_sensitivity,
            expected_impact: rec.expected_impact,
            confidence_score: rec.confidence_score,
            data_basis: rec.data_basis,
          })
          .select("id")
          .single();

        if (insertError || !inserted) {
          errors.push(
            `Failed to insert recommendation "${rec.title}": ${
              insertError?.message ?? "no row returned"
            }`,
          );
          continue;
        }

        const recommendationId = (inserted as { id: string }).id;

        if (rec.urgency === "immediate") immediateCount += 1;
        else if (rec.urgency === "urgent") urgentCount += 1;
        else if (rec.urgency === "low") lowCount += 1;
        else normalCount += 1;

        decisions.push(
          await this.logDecision({
            decisionType: "strategic_recommendation_generated",
            agentRunId: runId,
            entityType: "strategic_recommendation",
            entityId: recommendationId,
            reasoning: rec.reasoning,
            confidenceScore: rec.confidence_score,
            actionTaken: `Generated a "${rec.recommendation_category}" recommendation: ${rec.title}`,
            actionPayload: {
              recommendationCategory: rec.recommendation_category,
              urgency: rec.urgency,
              title: rec.title,
            },
          }),
        );

        if (rec.urgency === "immediate") {
          await this.createNotification(
            "strategic_recommendation",
            rec.title,
            rec.recommendation,
            {
              recommendationId,
              category: rec.recommendation_category,
              urgency: rec.urgency,
            },
          );
        }
      }

      const recommendationsGenerated =
        immediateCount + urgentCount + normalCount + lowCount;

      const summary =
        `Generated ${recommendationsGenerated} recommendation(s): ` +
        `${immediateCount} immediate, ${urgentCount} urgent, ${normalCount} normal, ` +
        `${lowCount} low (${skippedDuplicates} skipped as duplicates).`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: validated.length,
        itemsProcessed: recommendationsGenerated,
        itemsQueued: 0,
        tokensUsed: response.usage.totalTokens,
      });

      return {
        success: true,
        itemsFound: validated.length,
        itemsProcessed: recommendationsGenerated,
        itemsQueued: 0,
        decisions,
        nextActions: ["Review recommendations on the dashboard priorities panel."],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Strategic advisor run failed.";
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
