// AG-39 ROI Optimizer Agent (AutonomousAgent, migration 089:
// submission_variables + roi_insights). Phase 5 per
// AUTONOMOUS_PLATFORM_VISION.md §7 ("ROI Optimization Engine").
//
// Two responsibilities, deliberately not both wrapped the same way:
//   - trackSubmissionVariables() is a per-submission telemetry write, called
//     synchronously off the stage-transition flow (see
//     src/components/applications/pipeline.ts's `void fetch(...)` calls for
//     the established best-effort pattern this follows). It does not open an
//     agent_runs row or log an agent_decisions row - recording a submission's
//     variables isn't itself an autonomous "decision" any more than AG-03
//     (Deadline Extraction, BaseAgent pattern) logs one for inserting a
//     deadline row. It intentionally never throws on a Claude failure for the
//     readability sub-score - a missing score just leaves that one column
//     null rather than losing the rest of the row's data.
//   - run() is the monthly correlation pass: it DOES open an agent_runs row
//     and logs one agent_decisions row per significant pattern it persists to
//     roi_insights, since surfacing "this variable correlates with award
//     rate" is the actual autonomous judgment call this agent makes.
//
// Per-org scope: like every other AutonomousAgent (see
// outcome-analyzer-agent.ts), this class operates on `this.orgId` only - the
// task's "for each org with >= 10 records" framing maps to how a future
// worker/autonomous-orchestrator.ts registration would loop over active orgs
// and instantiate one agent per org, not to a multi-org loop inside this
// class. Wiring that orchestrator registration is out of scope here (AG-39 is
// still PLANNED per AGENTS_v2.md - it explicitly depends on AutoApply Full
// Autonomous Mode shipping first for there to be enough submission volume to
// correlate against).

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude } from "@/lib/ai/claude";
import type { Enums } from "@/types/database";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";
type OutcomeResult = Enums<"outcome_result">;

const MIN_RECORDS_FOR_ANALYSIS = 10;
const MIN_SAMPLE_SIZE = 5;
const MIN_CONFIDENCE = 0.6;
const MAX_NARRATIVE_CHARS_FOR_READABILITY = 6000;

interface ApplicationForTracking {
  id: string;
  organization_id: string;
  opportunity_id: string | null;
  draft_content: string | null;
  budget_data: Record<string, unknown> | null;
  submitted_at: string | null;
}

interface SubmissionVariableRow {
  id: string;
  application_id: string;
  submission_day_of_week: number | null;
  days_before_deadline: number | null;
  word_count: number | null;
  attachment_count: number | null;
  has_budget: boolean | null;
  narrative_readability_score: number | null;
}

interface OutcomeRow {
  application_id: string;
  result: OutcomeResult;
  awarded_amount: number | null;
}

interface RoiPattern {
  insight_type: string;
  insight_description: string;
  winning_pattern?: string | null;
  losing_pattern?: string | null;
  sample_size: number;
  confidence: number;
  recommended_action?: string | null;
}

function hasMeaningfulContent(value: Record<string, unknown> | null): boolean {
  return !!value && typeof value === "object" && Object.keys(value).length > 0;
}

export class RoiOptimizerAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-39-roi-optimizer", supabase);
  }

  /**
   * Records the measurable submission-time variables for one application into
   * submission_variables. Called once, when an application is submitted (see
   * /api/autonomous/track-submission).
   */
  async trackSubmissionVariables(applicationId: string): Promise<void> {
    const { data: applicationRow, error: applicationError } = await this.supabase
      .from("applications")
      .select("id, organization_id, opportunity_id, draft_content, budget_data, submitted_at")
      .eq("id", applicationId)
      .eq("organization_id", this.orgId)
      .maybeSingle();

    if (applicationError || !applicationRow) {
      throw new Error(
        `Could not load application ${applicationId} for submission tracking: ${
          applicationError?.message ?? "not found"
        }`,
      );
    }

    const application = applicationRow as ApplicationForTracking;
    const submittedAt = application.submitted_at
      ? new Date(application.submitted_at)
      : new Date();

    let daysBeforeDeadline: number | null = null;
    if (application.opportunity_id) {
      const { data: opportunityRow } = await this.supabase
        .from("opportunities")
        .select("deadline")
        .eq("id", application.opportunity_id)
        .maybeSingle();

      const deadline = (opportunityRow as { deadline: string | null } | null)
        ?.deadline;
      if (deadline) {
        daysBeforeDeadline = Math.round(
          (new Date(deadline).getTime() - submittedAt.getTime()) / 86_400_000,
        );
      }
    }

    const { count: attachmentCount } = await this.supabase
      .from("application_documents")
      .select("id", { count: "exact", head: true })
      .eq("application_id", applicationId);

    const draftContent = application.draft_content?.trim() ?? "";
    const wordCount = draftContent
      ? draftContent.split(/\s+/).filter(Boolean).length
      : 0;

    const hasBudget = hasMeaningfulContent(application.budget_data);

    let narrativeReadabilityScore: number | null = null;
    if (draftContent) {
      try {
        const readability = await callClaude({
          maxTokens: 10,
          temperature: 0,
          prompt: `Score the readability of this grant narrative for a lay funder reviewer on a 0-100 scale where 100 is easiest to read, and respond with only the integer score: ${draftContent.slice(0, MAX_NARRATIVE_CHARS_FOR_READABILITY)}`,
        });
        const match = readability.text.match(/\d+/);
        if (match) {
          narrativeReadabilityScore = Math.min(100, Math.max(0, parseInt(match[0], 10)));
        }
      } catch {
        // Never let a Claude failure block recording the rest of this row.
        narrativeReadabilityScore = null;
      }
    }

    const { error: insertError } = await this.supabase
      .from("submission_variables")
      .insert({
        application_id: applicationId,
        org_id: this.orgId,
        submission_day_of_week: submittedAt.getDay(),
        days_before_deadline: daysBeforeDeadline,
        word_count: wordCount,
        attachment_count: attachmentCount ?? 0,
        has_budget: hasBudget,
        narrative_readability_score: narrativeReadabilityScore,
      });

    if (insertError) {
      throw new Error(
        `Failed to record submission variables: ${insertError.message}`,
      );
    }
  }

  /**
   * Monthly ROI analysis for this org: correlates submission_variables against
   * outcomes and persists any significant pattern to roi_insights.
   */
  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;

    try {
      const { data: variableRows, error: variablesError } = await this.supabase
        .from("submission_variables")
        .select(
          "id, application_id, submission_day_of_week, days_before_deadline, word_count, attachment_count, has_budget, narrative_readability_score",
        )
        .eq("org_id", this.orgId);

      if (variablesError) {
        throw new Error(
          `Failed to load submission variables: ${variablesError.message}`,
        );
      }

      const variables = (variableRows ?? []) as SubmissionVariableRow[];

      if (variables.length < MIN_RECORDS_FOR_ANALYSIS) {
        const summary = `Only ${variables.length} submission_variables record(s) on file - need at least ${MIN_RECORDS_FOR_ANALYSIS} before running correlation analysis.`;
        await this.completeRun(runId, {
          outputSummary: summary,
          itemsFound: variables.length,
          itemsProcessed: 0,
          itemsQueued: 0,
        });
        return {
          success: true,
          itemsFound: variables.length,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      const { data: outcomeRows, error: outcomesError } = await this.supabase
        .from("outcomes")
        .select("application_id, result, awarded_amount")
        .eq("organization_id", this.orgId);

      if (outcomesError) {
        throw new Error(`Failed to load outcomes: ${outcomesError.message}`);
      }

      const outcomeByApplication = new Map<
        string,
        { result: OutcomeResult; awardedAmount: number | null }
      >();
      for (const o of (outcomeRows ?? []) as OutcomeRow[]) {
        outcomeByApplication.set(o.application_id, {
          result: o.result,
          awardedAmount: o.awarded_amount,
        });
      }

      const withOutcomes = variables
        .filter((v) => outcomeByApplication.has(v.application_id))
        .map((v) => {
          const outcome = outcomeByApplication.get(v.application_id)!;
          return {
            submission_day_of_week: v.submission_day_of_week,
            days_before_deadline: v.days_before_deadline,
            word_count: v.word_count,
            attachment_count: v.attachment_count,
            has_budget: v.has_budget,
            narrative_readability_score: v.narrative_readability_score,
            outcome_result: outcome.result,
            outcome_amount: outcome.awardedAmount,
          };
        });

      if (withOutcomes.length === 0) {
        const summary = `${variables.length} submission_variables record(s) on file, but none have a recorded outcome yet - nothing to correlate.`;
        await this.completeRun(runId, {
          outputSummary: summary,
          itemsFound: variables.length,
          itemsProcessed: 0,
          itemsQueued: 0,
        });
        return {
          success: true,
          itemsFound: variables.length,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      const analysisResponse = await callClaude({
        maxTokens: 1000,
        prompt:
          "Analyze these grant submission records for correlations between submission variables and outcomes " +
          "(which submission_day_of_week has the highest win rate, which word_count range wins most, and which " +
          `attachment_count/has_budget combinations correlate with awards). Records: ${JSON.stringify(withOutcomes)}. ` +
          "Respond with ONLY a JSON array (no markdown fences, no prose) of objects shaped exactly " +
          '{"insight_type": string, "insight_description": string, "winning_pattern": string, ' +
          '"losing_pattern": string, "sample_size": integer, "confidence": number between 0 and 1, ' +
          '"recommended_action": string}. Only include patterns you are confident are real given the sample sizes ' +
          "- omit anything speculative.",
      });
      tokensUsed += analysisResponse.usage.totalTokens;

      let patterns: RoiPattern[] = [];
      try {
        const jsonText = analysisResponse.text
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/```\s*$/i, "");
        const parsed: unknown = JSON.parse(jsonText);
        if (Array.isArray(parsed)) patterns = parsed as RoiPattern[];
      } catch (parseErr) {
        errors.push(
          `Could not parse Claude's correlation analysis as JSON: ${
            parseErr instanceof Error ? parseErr.message : "unknown parse error"
          }`,
        );
      }

      const significant = patterns.filter(
        (p) =>
          typeof p.sample_size === "number" &&
          p.sample_size >= MIN_SAMPLE_SIZE &&
          typeof p.confidence === "number" &&
          p.confidence >= MIN_CONFIDENCE,
      );

      let itemsQueued = 0;
      for (const pattern of significant) {
        const { data: inserted, error: insightError } = await this.supabase
          .from("roi_insights")
          .insert({
            org_id: this.orgId,
            insight_type: pattern.insight_type,
            insight_description: pattern.insight_description,
            winning_pattern: pattern.winning_pattern ?? null,
            losing_pattern: pattern.losing_pattern ?? null,
            sample_size: pattern.sample_size,
            confidence: pattern.confidence,
            recommended_action: pattern.recommended_action ?? null,
          })
          .select("id")
          .single();

        if (insightError || !inserted) {
          errors.push(
            `Failed to save insight "${pattern.insight_type}": ${
              insightError?.message ?? "no row returned"
            }`,
          );
          continue;
        }

        itemsQueued += 1;
        decisions.push(
          await this.logDecision({
            decisionType: "roi_pattern_detected",
            agentRunId: runId,
            entityType: "roi_insight",
            entityId: (inserted as { id: string }).id,
            reasoning: pattern.insight_description,
            confidenceScore: Math.round(pattern.confidence * 100),
            actionTaken: `Recorded ROI insight: ${pattern.insight_type}`,
            actionPayload: pattern as unknown as Record<string, unknown>,
          }),
        );
      }

      const summary =
        significant.length > 0
          ? `Analyzed ${withOutcomes.length} submission(s) with outcomes; recorded ${significant.length} significant ROI insight(s).`
          : `Analyzed ${withOutcomes.length} submission(s) with outcomes; no pattern met the significance threshold (sample >= ${MIN_SAMPLE_SIZE}, confidence >= ${MIN_CONFIDENCE}).`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: variables.length,
        itemsProcessed: withOutcomes.length,
        itemsQueued,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: variables.length,
        itemsProcessed: withOutcomes.length,
        itemsQueued,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "ROI optimization run failed.";
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
