// AG-11 Knowledge Gap Agent (AutonomousAgent, migration 080 infrastructure).
// Runs weekly - registered in worker/autonomous-orchestrator.ts's
// runOrgPipeline, gated to Sundays (America/Chicago) since the worker only
// has a single fixed 2AM nightly cron slot; see worker/scheduler.ts.
//
// Deviation from the task-given spec, checked against the real
// knowledge_base_category enum (src/types/database.ts): the task names 10
// invented category slugs (mission_statement, programs,
// financial_overview, ...) that don't exist anywhere in the schema.
// knowledge_base.category is a strict Postgres enum with exactly 11 real
// values: mission, vision, need_statement, program_description, impact,
// capacity, sustainability, partnerships, budget_justification,
// organizational_history, custom. Excluding 'custom' (a catch-all, not a
// standard category with a completeness expectation) leaves exactly 10 real
// values - the same count the task asked for - so this agent checks
// coverage against those 10 instead of the task's non-existent names.
// agent_decisions.entity_id is typed uuid, so a category slug (not a UUID)
// cannot be stored there; entity_id is omitted and the category is carried
// in reasoning/action_payload instead.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude } from "@/lib/ai/claude";
import type { Enums } from "@/types/database";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";
type KnowledgeBaseCategory = Enums<"knowledge_base_category">;

const MAX_TOKENS_PER_GAP = 150;

/** The 10 real, non-'custom' knowledge_base_category enum values. */
const STANDARD_CATEGORIES: KnowledgeBaseCategory[] = [
  "mission",
  "vision",
  "need_statement",
  "program_description",
  "impact",
  "capacity",
  "sustainability",
  "partnerships",
  "budget_justification",
  "organizational_history",
];

export class KnowledgeGapAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-11-knowledge-gap", supabase);
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;

    try {
      const { data: kbRows, error: kbError } = await this.supabase
        .from("knowledge_base")
        .select("category")
        .eq("organization_id", this.orgId)
        .in("category", STANDARD_CATEGORIES);

      if (kbError) {
        throw new Error(`Failed to load knowledge base: ${kbError.message}`);
      }

      const present = new Set(
        (kbRows ?? []).map((r) => r.category as KnowledgeBaseCategory),
      );
      const missing = STANDARD_CATEGORIES.filter((c) => !present.has(c));

      if (missing.length === 0) {
        await this.completeRun(runId, {
          outputSummary: "No Knowledge Base gaps - all standard categories covered.",
          itemsFound: STANDARD_CATEGORIES.length,
          itemsProcessed: STANDARD_CATEGORIES.length,
          itemsQueued: 0,
        });
        return {
          success: true,
          itemsFound: STANDARD_CATEGORIES.length,
          itemsProcessed: STANDARD_CATEGORIES.length,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      const response = await callClaude({
        maxTokens: missing.length * MAX_TOKENS_PER_GAP,
        prompt:
          "For each missing KB category, write one specific helpful sentence telling a nonprofit what information to add. Categories: " +
          missing.join(", "),
      });
      tokensUsed += response.usage.totalTokens;

      const suggestionLines = response.text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const suggestionsByCategory: Record<string, string> = {};
      missing.forEach((category, index) => {
        suggestionsByCategory[category] =
          suggestionLines[index] ?? response.text.trim();
      });

      await this.createNotification(
        "knowledge_gap",
        "Knowledge Base gaps identified",
        `${missing.length} standard categor${
          missing.length === 1 ? "y is" : "ies are"
        } missing from your Knowledge Base: ${missing.join(", ")}.`,
        { missingCategories: missing, suggestions: suggestionsByCategory },
      );

      for (const category of missing) {
        decisions.push(
          await this.logDecision({
            decisionType: "knowledge_gap_identified",
            agentRunId: runId,
            entityType: "knowledge_base_category",
            reasoning: `Category "${category}" has no Knowledge Base entries. Suggestion: ${suggestionsByCategory[category]}`,
            confidenceScore: 90,
            actionTaken: "flagged_knowledge_gap",
            actionPayload: {
              category,
              suggestion: suggestionsByCategory[category],
            },
          }),
        );
      }

      await this.completeRun(runId, {
        outputSummary: `${missing.length} Knowledge Base gap(s) identified: ${missing.join(", ")}.`,
        itemsFound: STANDARD_CATEGORIES.length,
        itemsProcessed: missing.length,
        itemsQueued: missing.length,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: STANDARD_CATEGORIES.length,
        itemsProcessed: missing.length,
        itemsQueued: missing.length,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Knowledge gap run failed.";
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
