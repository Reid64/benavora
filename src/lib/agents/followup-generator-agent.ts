// HARD LIMIT: This agent schedules follow-ups only. It never sends emails directly. All records created have status='scheduled'.
//
// AG-28 Follow-Up Generator Agent (event-driven, agent_queue infrastructure -
// migration 080: src/supabase/migrations/080_autonomous_agent_infrastructure.sql).
//
// Fired by a pipeline stage transition (submitted/awarded/denied) via
// /api/autonomous/followup-trigger, which enqueues an agent_queue row with
// agent_id "ag-28-followup" and input_payload { applicationId, newStage,
// previousStage }. Routed from the queue in
// worker/autonomous-orchestrator.ts's routeQueueItem().
//
// Distinct from the existing src/lib/agents/follow-up-generator.ts
// (FollowUpGeneratorAgent, BaseAgent pattern): that agent is manually/chain
// triggered, always generates a fixed 3-step thank-you/check-in/status-request
// sequence, and stores it as a note on the application (its own comment notes
// `follow_up_sequences` does not exist in the database types). This agent is
// purely event-driven off the actual stage a transition lands on, generates a
// different follow-up per stage, and writes one row per follow-up to the new
// `application_followups` table (migration 081) - `follow_up_sequences`
// already exists (top-level supabase/migrations/083_followup_sequences.sql)
// as an incompatible template+enrollment pair (organization_id, name,
// trigger_stage, steps jsonb), so a new table name was used to avoid
// colliding with it.
//
// Also: `opportunities` has no `is_recurring` boolean - recurrence is the
// text column `recurrence` ('one_time'/'annual'/'quarterly'/'rolling'), and
// `applications` already carries `awarded_amount` directly (no separate
// outcomes lookup needed for the awarded-amount text in the thank-you email).

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";

const FOLLOWUP_SYSTEM_PROMPT =
  "You are the Follow-Up Generator Agent inside Benavora, an AI-powered nonprofit " +
  "intelligence platform. You write follow-up correspondence on behalf of a nonprofit " +
  "development team, drafted for a human to review and send - you never send anything " +
  "yourself. Your job is to sound like an experienced, warm, professional development " +
  "director: grateful without being obsequious, concise without being curt, and " +
  "specific to the funder and grant in question rather than generic boilerplate. " +
  "Never invent facts about the funder, the grant amount, or the organization that " +
  "were not given to you in the prompt. Never promise a future action the " +
  "organization has not committed to. Never include placeholder brackets, sample " +
  "salutations to be filled in later, or meta-commentary about the email itself - " +
  "write only the finished email body text a human could copy and send as-is after " +
  "reviewing it. Match tone to context: check-ins after submission are patient and " +
  "confident, thank-you notes after an award are warm and specific about impact, " +
  "and feedback requests after a denial are gracious, brief, and focused on future " +
  "improvement rather than dwelling on the loss.";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

type FollowupNewStage = "submitted" | "awarded" | "denied";

interface FollowupTriggerPayload {
  applicationId: string;
  newStage: FollowupNewStage;
  previousStage: string;
}

interface ApplicationRow {
  id: string;
  organization_id: string;
  opportunity_id: string;
  requested_amount: number | null;
  awarded_amount: number | null;
}

interface OpportunityRow {
  id: string;
  name: string | null;
  funder_id: string | null;
  deadline: string | null;
  recurrence: string | null;
}

/** Recurrence values that make an opportunity eligible for renewal prep - mirrors isRecurring() in src/components/applications/pipeline.ts. */
function isRecurringOpportunity(recurrence: string | null): boolean {
  return recurrence === "annual" || recurrence === "quarterly" || recurrence === "rolling";
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class FollowupGeneratorAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-28-followup", supabase);
  }

  /**
   * Reads the agent_queue row the worker marked "processing" for this
   * org/agent this run - AutonomousAgent has no queue-item id passed into
   * run(), so the currently-processing row is the only way to recover the
   * event payload (mirrors ProbabilityScoringAgent.loadChainScope).
   */
  private async loadTriggerPayload(): Promise<FollowupTriggerPayload | null> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as Partial<FollowupTriggerPayload>;
    if (
      typeof payload.applicationId !== "string" ||
      typeof payload.previousStage !== "string" ||
      (payload.newStage !== "submitted" &&
        payload.newStage !== "awarded" &&
        payload.newStage !== "denied")
    ) {
      return null;
    }

    return {
      applicationId: payload.applicationId,
      newStage: payload.newStage,
      previousStage: payload.previousStage,
    };
  }

  private async loadContext(applicationId: string): Promise<{
    application: ApplicationRow;
    opportunity: OpportunityRow;
    funderName: string;
    contactChannel: string | null;
  } | null> {
    const { data: application } = await this.supabase
      .from("applications")
      .select(
        "id, organization_id, opportunity_id, requested_amount, awarded_amount",
      )
      .eq("id", applicationId)
      .eq("organization_id", this.orgId)
      .maybeSingle();

    if (!application) return null;
    const app = application as ApplicationRow;

    const { data: opportunity } = await this.supabase
      .from("opportunities")
      .select("id, name, funder_id, deadline, recurrence")
      .eq("id", app.opportunity_id)
      .maybeSingle();

    if (!opportunity) return null;
    const opp = opportunity as OpportunityRow;

    let funderName = "the funder";
    let contactChannel: string | null = null;

    if (opp.funder_id) {
      const { data: funder } = await this.supabase
        .from("funders")
        .select("name")
        .eq("id", opp.funder_id)
        .maybeSingle();
      funderName = (funder as { name: string | null } | null)?.name ?? "the funder";

      const { data: contact } = await this.supabase
        .from("contacts")
        .select("preferred_contact_method")
        .eq("funder_id", opp.funder_id)
        .not("preferred_contact_method", "is", null)
        .limit(1)
        .maybeSingle();
      contactChannel =
        (contact as { preferred_contact_method: string | null } | null)
          ?.preferred_contact_method ?? null;
    }

    return { application: app, opportunity: opp, funderName, contactChannel };
  }

  private async insertFollowup(params: {
    applicationId: string;
    followUpType: "check_in" | "thank_you" | "feedback_request" | "renewal_prep";
    scheduledDate: string;
    channel: string;
    content: string;
  }): Promise<void> {
    const { error } = await this.supabase.from("application_followups").insert({
      organization_id: this.orgId,
      application_id: params.applicationId,
      follow_up_type: params.followUpType,
      scheduled_date: params.scheduledDate,
      channel: params.channel,
      content: params.content,
      status: "scheduled",
    });

    if (error) {
      throw new Error(`Failed to schedule follow-up: ${error.message}`);
    }
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let itemsQueued = 0;
    let tokensUsed = 0;

    try {
      const trigger = await this.loadTriggerPayload();
      if (!trigger) {
        await this.completeRun(runId, {
          outputSummary:
            "No valid follow-up trigger payload found on the currently processing queue item.",
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

      const context = await this.loadContext(trigger.applicationId);
      if (!context) {
        throw new Error(
          `Application ${trigger.applicationId} or its opportunity could not be loaded.`,
        );
      }

      const { application, opportunity, funderName, contactChannel } = context;
      const channel = contactChannel ?? "email";

      switch (trigger.newStage) {
        case "submitted": {
          const deadlineBase = opportunity.deadline
            ? new Date(opportunity.deadline)
            : new Date();
          const followupDate = toDateOnly(addDays(deadlineBase, 14));

          const response = await callClaude({
            model: DEFAULT_MODEL,
            maxTokens: 1000,
            system: FOLLOWUP_SYSTEM_PROMPT,
            prompt:
              `Write a professional 3-sentence check-in email for a nonprofit following up on a grant submitted to ${funderName}. ` +
              "Acknowledge the submission, express continued interest, offer to provide additional information.",
          });
          tokensUsed += response.usage.totalTokens;

          await this.insertFollowup({
            applicationId: application.id,
            followUpType: "check_in",
            scheduledDate: followupDate,
            channel,
            content: response.text.trim(),
          });
          itemsQueued++;

          const decisionId = await this.logDecision({
            decisionType: "followup_scheduled",
            agentRunId: runId,
            entityType: "application",
            entityId: application.id,
            reasoning:
              `Application ${application.id} transitioned from "${trigger.previousStage}" to "submitted" for the opportunity "${opportunity.name ?? "this grant"}" with ${funderName}. ` +
              `Per the standard follow-up cadence for a newly submitted application, a check-in email is scheduled for ${followupDate} (14 days after the opportunity's application deadline). ` +
              `The check-in will be delivered via ${channel}, the funder's preferred contact channel where one is on file, or email by default. ` +
              "This is a low-risk, routine scheduling action - it only creates a draft follow-up for a human to review and send, never sends anything automatically, so it is logged at high confidence.",
            actionTaken: "created_followup_sequence",
            confidenceScore: 90,
          });
          decisions.push(decisionId);
          break;
        }

        case "awarded": {
          const thankDate = toDateOnly(addDays(new Date(), 3));
          const amount = application.awarded_amount ?? application.requested_amount;
          const amountText =
            amount != null ? `$${amount.toLocaleString("en-US")}` : "the awarded amount";

          const response = await callClaude({
            model: DEFAULT_MODEL,
            maxTokens: 1000,
            system: FOLLOWUP_SYSTEM_PROMPT,
            prompt: `Write a warm, professional thank you email from a nonprofit to ${funderName} for awarding a grant of ${amountText}.`,
          });
          tokensUsed += response.usage.totalTokens;

          await this.insertFollowup({
            applicationId: application.id,
            followUpType: "thank_you",
            scheduledDate: thankDate,
            channel,
            content: response.text.trim(),
          });
          itemsQueued++;

          if (isRecurringOpportunity(opportunity.recurrence)) {
            const renewalBase = opportunity.deadline
              ? new Date(opportunity.deadline)
              : new Date();
            const renewalDate = toDateOnly(addDays(renewalBase, 275));

            await this.insertFollowup({
              applicationId: application.id,
              followUpType: "renewal_prep",
              scheduledDate: renewalDate,
              channel,
              content: `Prepare renewal materials for the recurring opportunity "${
                opportunity.name ?? "this grant"
              }" with ${funderName}.`,
            });
            itemsQueued++;
          }

          const decisionId = await this.logDecision({
            decisionType: "award_followup_scheduled",
            agentRunId: runId,
            entityType: "application",
            entityId: application.id,
            reasoning:
              `Application ${application.id} for "${opportunity.name ?? "this grant"}" transitioned to "awarded" by ${funderName} for ${amountText}. ` +
              `A warm thank-you email is scheduled for ${thankDate} (3 days out), consistent with the standard post-award follow-up cadence. ` +
              (isRecurringOpportunity(opportunity.recurrence)
                ? `Because the opportunity's recurrence is "${opportunity.recurrence}", a renewal-prep follow-up was also scheduled well ahead of the next cycle so the organization has time to assemble renewal materials. `
                : "This opportunity is not recurring, so no renewal-prep follow-up was scheduled. ") +
              "This is a routine, low-risk scheduling action - it only creates draft follow-ups for a human to review and send.",
            actionTaken: "created_award_followups",
            confidenceScore: 95,
          });
          decisions.push(decisionId);
          break;
        }

        case "denied": {
          const feedbackDate = toDateOnly(addDays(new Date(), 7));

          const response = await callClaude({
            model: DEFAULT_MODEL,
            maxTokens: 1000,
            system: FOLLOWUP_SYSTEM_PROMPT,
            prompt: `Write a gracious 2-sentence email requesting feedback after a grant denial from ${funderName}.`,
          });
          tokensUsed += response.usage.totalTokens;

          await this.insertFollowup({
            applicationId: application.id,
            followUpType: "feedback_request",
            scheduledDate: feedbackDate,
            channel,
            content: response.text.trim(),
          });
          itemsQueued++;

          const decisionId = await this.logDecision({
            decisionType: "denial_followup_scheduled",
            agentRunId: runId,
            entityType: "application",
            entityId: application.id,
            reasoning:
              `Application ${application.id} for "${opportunity.name ?? "this grant"}" was denied by ${funderName}. ` +
              `A gracious feedback-request email is scheduled for ${feedbackDate} (7 days out), giving the funder time to move past the immediate decision while the relationship is still fresh enough for useful feedback. ` +
              "Requesting denial feedback is a standard relationship-preservation step that can surface concrete gaps to fix before the next application to this funder, without pressuring them for an immediate response. " +
              "This only schedules a draft email for human review and send - it never contacts the funder directly.",
            actionTaken: "created_denial_followup",
            confidenceScore: 85,
          });
          decisions.push(decisionId);
          break;
        }
      }

      await this.completeRun(runId, {
        outputSummary: `Scheduled ${itemsQueued} follow-up(s) for stage "${trigger.newStage}".`,
        itemsFound: 1,
        itemsProcessed: itemsQueued,
        itemsQueued,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: 1,
        itemsProcessed: itemsQueued,
        itemsQueued,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Follow-up generation failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
