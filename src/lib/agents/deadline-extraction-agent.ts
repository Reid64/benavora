// AG-03 Deadline Extraction Agent (AutonomousAgent version) - deterministic,
// no AI. Fired via agent_queue with agent_id "ag-03-deadline-extraction" and
// input_payload { opportunityIds: string[] } (migration 080 infrastructure:
// agent_runs, agent_decisions, agent_queue).
//
// Distinct from the existing src/lib/agents/deadline-extractor.ts
// (DeadlineExtractor, BaseAgent pattern, single opportunityId, 7/14/30-day
// follow_up_date offsets plus reporting/renewal inference): this agent is
// the array-input, queue-driven AutonomousAgent version scoped exactly as
// given in this build's task prompt (14/30-day offsets only, no
// reporting/renewal inference).
//
// Deviation from the task-given spec, checked against the real
// deadline_type enum (src/types/database.ts): the enum has no
// 'preparation_reminder' or 'early_reminder' values - only
// application_deadline | follow_up_date | reporting_deadline | renewal_date |
// document_expiration. Both reminder rows use deadline_type='follow_up_date'
// (same substitution DeadlineExtractor already makes for its own offset
// reminders), with the preparation/early distinction carried in the title
// and description text instead.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

interface DeadlineExtractionPayload {
  opportunityIds: string[];
}

interface OpportunityRow {
  id: string;
  name: string | null;
  deadline: string | null;
}

interface CandidateDeadline {
  deadline_type: "application_deadline" | "follow_up_date";
  due_date: string;
  title: string;
  description: string;
}

function toDateOnly(date: Date): string {
  return date.toISOString().split("T")[0] as string;
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

export class DeadlineExtractionAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-03-deadline-extraction", supabase);
  }

  /**
   * Reads the agent_queue row the worker marked "processing" for this
   * org/agent this run - AutonomousAgent has no queue-item id passed into
   * run(), so the currently-processing row is the only way to recover the
   * event payload (mirrors FollowupGeneratorAgent.loadTriggerPayload).
   */
  private async loadPayload(): Promise<DeadlineExtractionPayload | null> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as Partial<DeadlineExtractionPayload>;
    if (
      !Array.isArray(payload.opportunityIds) ||
      !payload.opportunityIds.every((id) => typeof id === "string")
    ) {
      return null;
    }
    return { opportunityIds: payload.opportunityIds };
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    let opportunitiesProcessed = 0;
    let deadlinesCreated = 0;

    try {
      const payload = await this.loadPayload();
      if (!payload || payload.opportunityIds.length === 0) {
        await this.completeRun(runId, {
          outputSummary: JSON.stringify({ opportunitiesProcessed: 0, deadlinesCreated: 0 }),
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

      const { data: oppRows, error: oppError } = await this.supabase
        .from("opportunities")
        .select("id, name, deadline")
        .eq("organization_id", this.orgId)
        .in("id", payload.opportunityIds);

      if (oppError) {
        throw new Error(`Failed to load opportunities: ${oppError.message}`);
      }

      const opportunities = (oppRows ?? []) as OpportunityRow[];
      const today = toDateOnly(new Date());

      for (const opp of opportunities) {
        try {
          if (!opp.deadline) continue; // no deadline to anchor on - skip.

          opportunitiesProcessed++;
          const name = opp.name ?? "this opportunity";

          const candidates: CandidateDeadline[] = [
            {
              deadline_type: "application_deadline",
              due_date: toDateOnly(new Date(opp.deadline)),
              title: `Application due: ${name}`,
              description: "Application submission deadline.",
            },
          ];

          const prepDate = addDays(opp.deadline, -14);
          if (prepDate >= today) {
            candidates.push({
              deadline_type: "follow_up_date",
              due_date: prepDate,
              title: `Preparation reminder: ${name}`,
              description: "14 days before the application deadline.",
            });
          }

          const earlyDate = addDays(opp.deadline, -30);
          if (earlyDate >= today) {
            candidates.push({
              deadline_type: "follow_up_date",
              due_date: earlyDate,
              title: `Early reminder: ${name}`,
              description: "30 days before the application deadline.",
            });
          }

          const { data: existingRows } = await this.supabase
            .from("deadlines")
            .select("title")
            .eq("organization_id", this.orgId)
            .eq("opportunity_id", opp.id);
          const existingTitles = new Set(
            (existingRows ?? []).map((r) => r.title as string),
          );

          const toInsert = candidates.filter((c) => !existingTitles.has(c.title));

          if (toInsert.length > 0) {
            const { error: insertError } = await this.supabase.from("deadlines").insert(
              toInsert.map((c) => ({
                organization_id: this.orgId,
                opportunity_id: opp.id,
                deadline_type: c.deadline_type,
                due_date: c.due_date,
                title: c.title,
                description: c.description,
              })),
            );
            if (insertError) {
              errors.push(
                `opportunity ${opp.id}: failed to insert deadlines: ${insertError.message}`,
              );
              continue;
            }
          }

          deadlinesCreated += toInsert.length;

          decisions.push(
            await this.logDecision({
              decisionType: "deadlines_extracted",
              agentRunId: runId,
              entityType: "opportunity",
              entityId: opp.id,
              reasoning: `Extracted deadline records for ${name}. Application deadline: ${opp.deadline}.`,
              confidenceScore: 95,
              actionTaken: "created_deadline_records",
              actionPayload: { created: toInsert.map((c) => c.title) },
            }),
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to extract deadlines.";
          errors.push(`opportunity ${opp.id}: ${message}`);
        }
      }

      const summary = { opportunitiesProcessed, deadlinesCreated };

      await this.completeRun(runId, {
        outputSummary: JSON.stringify(summary),
        itemsFound: opportunities.length,
        itemsProcessed: opportunitiesProcessed,
        itemsQueued: deadlinesCreated,
      });

      return {
        success: true,
        itemsFound: opportunities.length,
        itemsProcessed: opportunitiesProcessed,
        itemsQueued: deadlinesCreated,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Deadline extraction run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: opportunitiesProcessed,
        itemsQueued: deadlinesCreated,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
