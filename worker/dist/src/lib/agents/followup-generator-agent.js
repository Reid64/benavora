"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FollowupGeneratorAgent = void 0;
const autonomous_base_1 = require("@/lib/agents/autonomous-base");
const claude_1 = require("@/lib/ai/claude");
/** Recurrence values that make an opportunity eligible for renewal prep - mirrors isRecurring() in src/components/applications/pipeline.ts. */
function isRecurringOpportunity(recurrence) {
    return recurrence === "annual" || recurrence === "quarterly" || recurrence === "rolling";
}
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}
function toDateOnly(date) {
    return date.toISOString().slice(0, 10);
}
class FollowupGeneratorAgent extends autonomous_base_1.AutonomousAgent {
    constructor(orgId, supabase) {
        super(orgId, "ag-28-followup", supabase);
    }
    /**
     * Reads the agent_queue row the worker marked "processing" for this
     * org/agent this run - AutonomousAgent has no queue-item id passed into
     * run(), so the currently-processing row is the only way to recover the
     * event payload (mirrors ProbabilityScoringAgent.loadChainScope).
     */
    async loadTriggerPayload() {
        const { data: queueRow } = await this.supabase
            .from("agent_queue")
            .select("input_payload")
            .eq("org_id", this.orgId)
            .eq("agent_id", this.agentId)
            .eq("status", "processing")
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        const payload = (queueRow?.input_payload ?? {});
        if (typeof payload.applicationId !== "string" ||
            typeof payload.previousStage !== "string" ||
            (payload.newStage !== "submitted" &&
                payload.newStage !== "awarded" &&
                payload.newStage !== "denied")) {
            return null;
        }
        return {
            applicationId: payload.applicationId,
            newStage: payload.newStage,
            previousStage: payload.previousStage,
        };
    }
    async loadContext(applicationId) {
        const { data: application } = await this.supabase
            .from("applications")
            .select("id, organization_id, opportunity_id, requested_amount, awarded_amount")
            .eq("id", applicationId)
            .eq("organization_id", this.orgId)
            .maybeSingle();
        if (!application)
            return null;
        const app = application;
        const { data: opportunity } = await this.supabase
            .from("opportunities")
            .select("id, name, funder_id, deadline, recurrence")
            .eq("id", app.opportunity_id)
            .maybeSingle();
        if (!opportunity)
            return null;
        const opp = opportunity;
        let funderName = "the funder";
        let contactChannel = null;
        if (opp.funder_id) {
            const { data: funder } = await this.supabase
                .from("funders")
                .select("name")
                .eq("id", opp.funder_id)
                .maybeSingle();
            funderName = funder?.name ?? "the funder";
            const { data: contact } = await this.supabase
                .from("contacts")
                .select("preferred_contact_method")
                .eq("funder_id", opp.funder_id)
                .not("preferred_contact_method", "is", null)
                .limit(1)
                .maybeSingle();
            contactChannel =
                contact
                    ?.preferred_contact_method ?? null;
        }
        return { application: app, opportunity: opp, funderName, contactChannel };
    }
    async insertFollowup(params) {
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
    async run(triggerSource) {
        const runId = await this.startRun(triggerSource);
        const errors = [];
        const decisions = [];
        let itemsQueued = 0;
        let tokensUsed = 0;
        try {
            const trigger = await this.loadTriggerPayload();
            if (!trigger) {
                await this.completeRun(runId, {
                    outputSummary: "No valid follow-up trigger payload found on the currently processing queue item.",
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
                throw new Error(`Application ${trigger.applicationId} or its opportunity could not be loaded.`);
            }
            const { application, opportunity, funderName, contactChannel } = context;
            const channel = contactChannel ?? "email";
            switch (trigger.newStage) {
                case "submitted": {
                    const deadlineBase = opportunity.deadline
                        ? new Date(opportunity.deadline)
                        : new Date();
                    const followupDate = toDateOnly(addDays(deadlineBase, 14));
                    const response = await (0, claude_1.callClaude)({
                        maxTokens: 200,
                        prompt: `Write a professional 3-sentence check-in email for a nonprofit following up on a grant submitted to ${funderName}. ` +
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
                        reasoning: `Application submitted to ${funderName}. Check-in scheduled for ${followupDate}.`,
                        actionTaken: "created_followup_sequence",
                        confidenceScore: 90,
                    });
                    decisions.push(decisionId);
                    break;
                }
                case "awarded": {
                    const thankDate = toDateOnly(addDays(new Date(), 3));
                    const amount = application.awarded_amount ?? application.requested_amount;
                    const amountText = amount != null ? `$${amount.toLocaleString("en-US")}` : "the awarded amount";
                    const response = await (0, claude_1.callClaude)({
                        maxTokens: 200,
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
                            content: `Prepare renewal materials for the recurring opportunity "${opportunity.name ?? "this grant"}" with ${funderName}.`,
                        });
                        itemsQueued++;
                    }
                    const decisionId = await this.logDecision({
                        decisionType: "award_followup_scheduled",
                        agentRunId: runId,
                        entityType: "application",
                        entityId: application.id,
                        reasoning: `Application awarded by ${funderName}. Thank-you scheduled for ${thankDate}.`,
                        actionTaken: "created_award_followups",
                        confidenceScore: 95,
                    });
                    decisions.push(decisionId);
                    break;
                }
                case "denied": {
                    const feedbackDate = toDateOnly(addDays(new Date(), 7));
                    const response = await (0, claude_1.callClaude)({
                        maxTokens: 150,
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
                        reasoning: `Application denied by ${funderName}. Feedback request scheduled for ${feedbackDate}.`,
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Follow-up generation failed.";
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
exports.FollowupGeneratorAgent = FollowupGeneratorAgent;
