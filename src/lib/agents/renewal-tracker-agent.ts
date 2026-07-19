// AG-08 Renewal Tracker Agent (AutonomousAgent, migration 080 infrastructure:
// agent_runs, agent_decisions, agent_queue). Runs monthly - registered in
// worker/autonomous-orchestrator.ts's runOrgPipeline, gated on the 1st of the
// month (America/Chicago) since the worker only has a single fixed 2AM
// nightly cron slot; see worker/scheduler.ts.
//
// Deviations from the task-given spec, checked against the real schema
// (src/types/database.ts) rather than applied literally:
//   - `opportunities` has no `is_recurring` boolean - recurrence is the text
//     column `recurrence` ('one_time'/'annual'/'quarterly'/'rolling'), same
//     substitution already made in followup-generator-agent.ts's
//     isRecurringOpportunity().
//   - "check if a renewal application already exists ... in current year" is
//     approximated as "a renewal opportunity with this exact target name
//     already exists for this funder" (name = `${original} -- Renewal
//     ${year}`), which is both the actual idempotency check this agent needs
//     across repeated monthly runs and avoids assuming an
//     `applications.funder_id` column that doesn't exist (funder is reached
//     only via applications.opportunity_id -> opportunities.funder_id).
//   - No AI call - deterministic record creation only, per the task spec.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import type { Enums } from "@/types/database";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";
type FunderCategory = Enums<"funder_category">;

interface AwardedApplicationRow {
  id: string;
  opportunity_id: string;
}

interface OpportunityRow {
  id: string;
  name: string;
  funder_id: string | null;
  category: FunderCategory;
  deadline: string | null;
  recurrence: string | null;
}

/** Mirrors isRecurringOpportunity() in followup-generator-agent.ts. */
function isRecurringOpportunity(recurrence: string | null): boolean {
  return (
    recurrence === "annual" ||
    recurrence === "quarterly" ||
    recurrence === "rolling"
  );
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class RenewalTrackerAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-08-renewal-tracker", supabase);
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    let opportunitiesEvaluated = 0;
    let renewalsCreated = 0;

    try {
      const { data: awardedRows, error: awardedError } = await this.supabase
        .from("applications")
        .select("id, opportunity_id")
        .eq("organization_id", this.orgId)
        .eq("stage", "awarded");

      if (awardedError) {
        throw new Error(
          `Failed to load awarded applications: ${awardedError.message}`,
        );
      }

      const awardedApps = (awardedRows ?? []) as AwardedApplicationRow[];
      const opportunityIds = Array.from(
        new Set(awardedApps.map((a) => a.opportunity_id)),
      );

      if (opportunityIds.length === 0) {
        await this.completeRun(runId, {
          outputSummary: "No awarded applications found.",
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
        .select("id, name, funder_id, category, deadline, recurrence")
        .eq("organization_id", this.orgId)
        .in("id", opportunityIds);

      if (oppError) {
        throw new Error(`Failed to load opportunities: ${oppError.message}`);
      }

      const recurringOpps = ((oppRows ?? []) as OpportunityRow[]).filter(
        (o) => o.funder_id && isRecurringOpportunity(o.recurrence),
      );

      for (const opp of recurringOpps) {
        opportunitiesEvaluated++;

        try {
          const baseDate = opp.deadline ? new Date(opp.deadline) : new Date();
          const renewalDeadlineDate = addDays(baseDate, 365);
          const nextYear = renewalDeadlineDate.getFullYear();
          const renewalName = `${opp.name} -- Renewal ${nextYear}`;

          const { data: existing } = await this.supabase
            .from("opportunities")
            .select("id")
            .eq("organization_id", this.orgId)
            .eq("funder_id", opp.funder_id as string)
            .eq("name", renewalName)
            .maybeSingle();

          if (existing) continue; // renewal already tracked for this cycle.

          const { data: inserted, error: insertError } = await this.supabase
            .from("opportunities")
            .insert({
              organization_id: this.orgId,
              funder_id: opp.funder_id,
              name: renewalName,
              category: opp.category,
              status: "open",
              source: "agent",
              deadline: toDateOnly(renewalDeadlineDate),
              description: `Auto-created by Renewal Tracker Agent. Original opportunity "${opp.name}" was awarded and recurs (${opp.recurrence}).`,
            })
            .select("id")
            .single();

          if (insertError || !inserted) {
            errors.push(
              `opportunity ${opp.id}: failed to create renewal: ${
                insertError?.message ?? "no row returned"
              }`,
            );
            continue;
          }

          const newOppId = (inserted as { id: string }).id;
          renewalsCreated++;

          decisions.push(
            await this.logDecision({
              decisionType: "renewal_opportunity_created",
              agentRunId: runId,
              entityType: "opportunity",
              entityId: newOppId,
              reasoning: `"${opp.name}" was awarded and recurs (${opp.recurrence}). Created renewal opportunity "${renewalName}" with target deadline ${toDateOnly(renewalDeadlineDate)}.`,
              confidenceScore: 92,
              actionTaken: "created_renewal_opportunity",
              actionPayload: {
                sourceOpportunityId: opp.id,
                renewalName,
                deadline: toDateOnly(renewalDeadlineDate),
              },
            }),
          );
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to process renewal for opportunity.";
          errors.push(`opportunity ${opp.id}: ${message}`);
        }
      }

      const summary = { opportunitiesEvaluated, renewalsCreated };

      await this.completeRun(runId, {
        outputSummary: JSON.stringify(summary),
        itemsFound: recurringOpps.length,
        itemsProcessed: opportunitiesEvaluated,
        itemsQueued: renewalsCreated,
      });

      return {
        success: true,
        itemsFound: recurringOpps.length,
        itemsProcessed: opportunitiesEvaluated,
        itemsQueued: renewalsCreated,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Renewal tracker run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: opportunitiesEvaluated,
        itemsQueued: renewalsCreated,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
