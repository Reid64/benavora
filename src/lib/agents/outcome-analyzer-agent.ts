// AG-09 Outcome Analyzer Agent (AutonomousAgent, migration 080
// infrastructure). Event-driven (accepts triggerSource "event" - intended to
// fire on outcome insert) and also runs weekly - registered in
// worker/autonomous-orchestrator.ts's runOrgPipeline, gated to Sundays
// (America/Chicago) since the worker only has a single fixed 2AM nightly
// cron slot; see worker/scheduler.ts. Wiring an actual outcome-insert ->
// agent_queue enqueue (e.g. from the outcome-recording API route) is out of
// scope for this task, which only asks for orchestrator registration; the
// agent itself is trigger-source agnostic and always recomputes from the
// full outcomes table, so it is ready to be queued that way later.
//
// Deviations from the task-given spec, checked against the real schema
// (src/types/database.ts) and against src/lib/agents/recursive-learning.ts
// (AGENTS.md Agent 10):
//   - `organizations` had no `analytics` jsonb column - added by migration
//     082 (src/supabase/migrations/082_ag08_ag12_autonomous_agents.sql).
//   - "category" for successRate grouping uses outcomes.opportunity_category,
//     falling back to outcomes.funder_category when null (both are the same
//     funder_category enum; opportunity_category is the closer match to
//     "the category of the thing applied for").
//   - The task's narrative-promotion step ("increment proven_count on
//     knowledge_base_narratives and set is_proven=true if proven_count >= 2")
//     is intentionally NOT implemented here. recursive-learning.ts's own file
//     header states plainly: "is_proven / proven_count are written ONLY
//     here" (Behavioral Contracts §8/§10), and it already runs on every
//     outcome insert (AGENTS.md Agent 10), incrementing knowledge_base
//     proven_count / is_proven at the exact same PROVEN_NARRATIVE_THRESHOLD
//     (= 2, src/lib/utils/constants.ts) the task describes. Duplicating that
//     write here would double-increment proven_count on every outcome and
//     violate the single-writer contract. This agent only reads
//     applications.draft_knowledge_sources (not narrative_snapshot, which is
//     frozen prose with no structured entry ids) to note which knowledge_base
//     entries are already proven, purely for the insight summary - it never
//     writes is_proven/proven_count.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude } from "@/lib/ai/claude";
import type { Enums, Json } from "@/types/database";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";
type FunderCategory = Enums<"funder_category">;

const MIN_OUTCOMES_FOR_RATE = 3;

interface OutcomeRow {
  id: string;
  result: Enums<"outcome_result">;
  awarded_amount: number | null;
  requested_amount: number | null;
  opportunity_category: FunderCategory | null;
  funder_category: FunderCategory | null;
}

interface CategoryTally {
  total: number;
  awarded: number;
}

export class OutcomeAnalyzerAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-09-outcome-analyzer", supabase);
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;

    try {
      const { data: outcomeRows, error: outcomesError } = await this.supabase
        .from("outcomes")
        .select(
          "id, result, awarded_amount, requested_amount, opportunity_category, funder_category",
        )
        .eq("organization_id", this.orgId);

      if (outcomesError) {
        throw new Error(`Failed to load outcomes: ${outcomesError.message}`);
      }

      const outcomes = (outcomeRows ?? []) as OutcomeRow[];

      if (outcomes.length === 0) {
        await this.completeRun(runId, {
          outputSummary: "No outcomes recorded yet - nothing to analyze.",
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
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

      // successRate by category (only categories with >= 3 outcomes).
      const tallies = new Map<string, CategoryTally>();
      for (const o of outcomes) {
        const category = o.opportunity_category ?? o.funder_category;
        if (!category) continue;
        const tally = tallies.get(category) ?? { total: 0, awarded: 0 };
        tally.total += 1;
        if (o.result === "awarded") tally.awarded += 1;
        tallies.set(category, tally);
      }

      const successRateByCategory: Record<string, number> = {};
      for (const [category, tally] of tallies) {
        if (tally.total >= MIN_OUTCOMES_FOR_RATE) {
          successRateByCategory[category] = Number(
            (tally.awarded / tally.total).toFixed(3),
          );
        }
      }

      // averageAwardSize.
      const awardedOutcomes = outcomes.filter(
        (o) => o.result === "awarded" && o.awarded_amount != null,
      );
      const averageAwardSize =
        awardedOutcomes.length > 0
          ? Math.round(
              awardedOutcomes.reduce(
                (sum, o) => sum + (o.awarded_amount ?? 0),
                0,
              ) / awardedOutcomes.length,
            )
          : 0;

      // dollarEfficiency: total dollars awarded / total dollars requested.
      const totalRequested = outcomes.reduce(
        (sum, o) => sum + (o.requested_amount ?? 0),
        0,
      );
      const totalAwarded = outcomes.reduce(
        (sum, o) => sum + (o.awarded_amount ?? 0),
        0,
      );
      const dollarEfficiency =
        totalRequested > 0
          ? Number((totalAwarded / totalRequested).toFixed(3))
          : 0;

      const stats = {
        successRateByCategory,
        averageAwardSize,
        dollarEfficiency,
        totalOutcomes: outcomes.length,
        computedAt: new Date().toISOString(),
      };

      const insightResponse = await callClaude({
        maxTokens: 200,
        prompt: `In 2 sentences, summarize the funding performance of this org based on: ${JSON.stringify(
          stats,
        )}`,
      });
      tokensUsed += insightResponse.usage.totalTokens;

      const analytics = { ...stats, insightSummary: insightResponse.text.trim() };

      const { data: orgRow } = await this.supabase
        .from("organizations")
        .select("analytics")
        .eq("id", this.orgId)
        .maybeSingle();
      const existingAnalytics =
        (orgRow?.analytics as Record<string, unknown> | null) ?? {};

      const { error: updateError } = await this.supabase
        .from("organizations")
        .update({
          analytics: { ...existingAnalytics, ...analytics } as unknown as Json,
        })
        .eq("id", this.orgId);

      if (updateError) {
        throw new Error(
          `Failed to persist organization analytics: ${updateError.message}`,
        );
      }

      decisions.push(
        await this.logDecision({
          decisionType: "funding_analytics_updated",
          agentRunId: runId,
          entityType: "organization",
          entityId: this.orgId,
          reasoning: analytics.insightSummary,
          confidenceScore: 85,
          actionTaken: "updated_organization_analytics",
          actionPayload: stats,
        }),
      );

      await this.completeRun(runId, {
        outputSummary: analytics.insightSummary,
        itemsFound: outcomes.length,
        itemsProcessed: outcomes.length,
        itemsQueued: 0,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: outcomes.length,
        itemsProcessed: outcomes.length,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Outcome analysis run failed.";
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
