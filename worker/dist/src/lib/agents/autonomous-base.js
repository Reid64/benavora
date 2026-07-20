"use strict";
// AutonomousAgent - shared infrastructure for agents that act without a human
// in the loop between nightly/chained runs (migration 080:
// autonomous_triggers, agent_queue, agent_decisions, org_autonomous_config).
//
// Every autonomous action must be logged as a decision (agent_decisions) with
// a reasoning trail and a confidence score; anything below
// MIN_CONFIDENCE_TO_ACT is force-flagged for human review rather than acted
// on silently. Agents never submit externally, send email, or delete user
// data on their own - those remain human-gated regardless of confidence.
//
// Note: there is no dedicated `notifications` table in this schema - in-app
// notices live in `alerts` (see src/lib/notifications/notify.ts and
// src/lib/agents/{disaster-response-agent,morning-digest}.ts for the existing
// org-wide-alert convention this class follows). `alerts` has no metadata
// jsonb column, so `metadata` passed to createNotification is not persisted.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutonomousAgent = exports.AUTONOMOUS_HARD_LIMITS = void 0;
exports.AUTONOMOUS_HARD_LIMITS = {
    NEVER_SUBMIT_EXTERNALLY: true,
    NEVER_SEND_EMAIL_WITHOUT_APPROVAL: true,
    NEVER_DELETE_USER_DATA: true,
    NEVER_MODIFY_GOVERNANCE_FILES: true,
    MAX_DRAFTS_PER_NIGHT_DEFAULT: 10,
    MIN_CONFIDENCE_TO_ACT: 60,
};
/** Safe fallback when an org has no org_autonomous_config row yet. */
const SAFE_DEFAULT_CONFIG = {
    auto_research_enabled: false,
    auto_score_enabled: false,
    auto_draft_enabled: false,
    auto_draft_threshold: 70,
    auto_reputation_enabled: false,
    auto_relationship_enabled: false,
    auto_deadline_prediction_enabled: false,
    auto_followup_enabled: false,
    notify_on_auto_draft: false,
    notify_on_high_score: false,
    max_auto_drafts_per_night: 10,
};
class AutonomousAgent {
    orgId;
    agentId;
    supabase;
    constructor(orgId, agentId, supabase) {
        this.orgId = orgId;
        this.agentId = agentId;
        this.supabase = supabase;
    }
    /**
     * Records a single autonomous decision to agent_decisions for audit and
     * human review. Confidence below MIN_CONFIDENCE_TO_ACT always forces
     * required_human_review=true, regardless of what the caller requested.
     */
    async logDecision(params) {
        const requiredHumanReview = params.confidenceScore < exports.AUTONOMOUS_HARD_LIMITS.MIN_CONFIDENCE_TO_ACT
            ? true
            : (params.requiredHumanReview ?? false);
        const { data, error } = await this.supabase
            .from("agent_decisions")
            .insert({
            org_id: this.orgId,
            agent_run_id: params.agentRunId ?? null,
            agent_id: this.agentId,
            decision_type: params.decisionType,
            entity_type: params.entityType ?? null,
            entity_id: params.entityId ?? null,
            reasoning: params.reasoning,
            confidence_score: params.confidenceScore,
            action_taken: params.actionTaken,
            action_payload: params.actionPayload ?? {},
            required_human_review: requiredHumanReview,
        })
            .select("id")
            .single();
        if (error || !data) {
            throw new Error(`Failed to log agent decision: ${error?.message ?? "no row returned"}`);
        }
        return data.id;
    }
    /** Opens an agent_runs row for this run. Returns its id. */
    async startRun(triggerSource, inputParams) {
        const { data, error } = await this.supabase
            .from("agent_runs")
            .insert({
            organization_id: this.orgId,
            agent_type: this.agentId,
            status: "running",
            trigger_source: triggerSource,
            input_params: inputParams ?? {},
            started_at: new Date().toISOString(),
        })
            .select("id")
            .single();
        if (error || !data) {
            throw new Error(`Failed to start agent run: ${error?.message ?? "no row returned"}`);
        }
        return data.id;
    }
    /** Marks an agent_runs row completed with whatever summary fields apply. */
    async completeRun(runId, params) {
        const patch = {
            status: "completed",
            completed_at: new Date().toISOString(),
            output_summary: params.outputSummary,
        };
        if (params.itemsFound !== undefined)
            patch.items_found = params.itemsFound;
        if (params.itemsProcessed !== undefined)
            patch.items_processed = params.itemsProcessed;
        if (params.itemsQueued !== undefined)
            patch.items_queued = params.itemsQueued;
        if (params.tokensUsed !== undefined)
            patch.tokens_used = params.tokensUsed;
        if (params.nextAction !== undefined)
            patch.next_action = params.nextAction;
        if (params.confidenceScore !== undefined)
            patch.confidence_score = params.confidenceScore;
        await this.supabase.from("agent_runs").update(patch).eq("id", runId);
    }
    /** Marks an agent_runs row failed. Never throws - a logging failure must
     * never mask the original error the caller is already handling. */
    async failRun(runId, errorMessage) {
        await this.supabase
            .from("agent_runs")
            .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: errorMessage,
        })
            .eq("id", runId);
    }
    /** Enqueues a downstream agent run in agent_queue (BEHAVIORAL_CONTRACTS §23
     * priority queue). chainedFromRunId is folded into input_payload since
     * agent_queue has no dedicated column for it. */
    async queueChainedAgent(agentId, priority, inputPayload, chainedFromRunId) {
        await this.supabase.from("agent_queue").insert({
            org_id: this.orgId,
            agent_id: agentId,
            priority,
            status: "queued",
            trigger_source: "chain",
            input_payload: chainedFromRunId
                ? { ...inputPayload, chained_from_run_id: chainedFromRunId }
                : inputPayload,
        });
    }
    /** Reads this org's autonomy toggles. Falls back to safe (all-off)
     * defaults when no org_autonomous_config row exists yet. */
    async getOrgConfig() {
        const { data } = await this.supabase
            .from("org_autonomous_config")
            .select("auto_research_enabled, auto_score_enabled, auto_draft_enabled, " +
            "auto_draft_threshold, auto_reputation_enabled, auto_relationship_enabled, " +
            "auto_deadline_prediction_enabled, auto_followup_enabled, " +
            "notify_on_auto_draft, notify_on_high_score, max_auto_drafts_per_night")
            .eq("org_id", this.orgId)
            .maybeSingle();
        if (!data)
            return SAFE_DEFAULT_CONFIG;
        return data;
    }
    /** Writes an org-wide in-app notice. This schema has no `notifications`
     * table - notices live in `alerts` (see file header). */
    async createNotification(type, title, message, metadata) {
        void metadata; // no jsonb column on `alerts` to persist this into.
        await this.supabase.from("alerts").insert({
            organization_id: this.orgId,
            type: "system",
            severity: "info",
            message: message ? `${title}: ${message}` : title,
            dedup_key: `autonomous:${this.agentId}:${type}:${crypto.randomUUID()}`,
        });
    }
}
exports.AutonomousAgent = AutonomousAgent;
