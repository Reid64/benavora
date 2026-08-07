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
//
// The category list and the "which categories does this org have content
// for" query are shared with src/lib/intelligence/narrative-gap-analysis.ts
// (row #144) via knowledge-base-completeness.ts, so both stay in sync
// against the same enum/query rather than drifting independently. This
// agent's own org-wide weekly sweep is unchanged in behavior by that
// extraction.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import {
  STANDARD_KB_CATEGORIES as STANDARD_CATEGORIES,
  getPresentKbCategories,
} from "@/lib/agents/knowledge-base-completeness";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

const MIN_TOKENS = 1000;
const MAX_TOKENS_PER_GAP = 150;

const KNOWLEDGE_GAP_SYSTEM_PROMPT =
  "You are the Knowledge Gap Agent inside Benavora, an AI-powered nonprofit " +
  "intelligence platform. A nonprofit's Knowledge Base is the reusable pool of " +
  "narrative content - mission, need statement, program descriptions, impact " +
  "data, and similar - that the Draft Generation Agent pulls from to write grant " +
  "applications; a missing category means every draft touching that topic will " +
  "either be generic or flag a [NEEDS INPUT] gap for a human to fill manually. " +
  "You are given a list of standard Knowledge Base categories that currently have " +
  "zero entries for this organization. For each missing category, write one " +
  "specific, actionable sentence telling the nonprofit exactly what kind of " +
  "content to add - not a generic 'add information about X' but a concrete " +
  "prompt referencing what a strong entry in that category typically contains " +
  "(e.g. for 'impact', ask for specific outcome numbers and beneficiary counts " +
  "rather than vague claims of success). Write one sentence per missing category, " +
  "one per line, in the same order the categories were given, so the response can " +
  "be matched back to each category by position.";

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
      const present = await getPresentKbCategories(this.supabase, this.orgId);
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
        model: DEFAULT_MODEL,
        maxTokens: Math.max(MIN_TOKENS, missing.length * MAX_TOKENS_PER_GAP),
        system: KNOWLEDGE_GAP_SYSTEM_PROMPT,
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
            reasoning:
              `The "${category}" Knowledge Base category has zero entries for this organization, out of ${STANDARD_CATEGORIES.length} standard categories this weekly sweep checks (mission, vision, need_statement, program_description, impact, capacity, sustainability, partnerships, budget_justification, organizational_history). ` +
              `This matters because the Draft Generation Agent reads the Knowledge Base first when writing a grant narrative, and a missing category forces it to either write generic filler or flag a [NEEDS INPUT] gap for a human to fill in mid-draft, slowing down the autonomous drafting pipeline. ` +
              `Suggestion for this category: ${suggestionsByCategory[category]} ` +
              "This agent only surfaces a notification and logs this decision - it never creates or edits Knowledge Base content itself.",
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
