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

import type { SupabaseClient } from "@supabase/supabase-js";
import { redactSecrets, logOrchestrationStep } from "@/lib/orchestration/orchestration-log";
import { enterUsageContext } from "@/lib/ai/usage-context";

export const AUTONOMOUS_HARD_LIMITS = {
  NEVER_SUBMIT_EXTERNALLY: true,
  NEVER_SEND_EMAIL_WITHOUT_APPROVAL: true,
  NEVER_DELETE_USER_DATA: true,
  NEVER_MODIFY_GOVERNANCE_FILES: true,
  MAX_DRAFTS_PER_NIGHT_DEFAULT: 10,
  MIN_CONFIDENCE_TO_ACT: 60,
} as const;

export interface AutonomousAgentResult {
  success: boolean;
  itemsFound: number;
  itemsProcessed: number;
  itemsQueued: number;
  decisions: string[];
  nextActions: string[];
  errors: string[];
}

export interface OrgAutonomousConfig {
  auto_research_enabled: boolean;
  auto_score_enabled: boolean;
  auto_draft_enabled: boolean;
  auto_draft_threshold: number;
  auto_reputation_enabled: boolean;
  auto_relationship_enabled: boolean;
  auto_deadline_prediction_enabled: boolean;
  auto_followup_enabled: boolean;
  notify_on_auto_draft: boolean;
  notify_on_high_score: boolean;
  max_auto_drafts_per_night: number;
}

/** Safe fallback when an org has no org_autonomous_config row yet. */
const SAFE_DEFAULT_CONFIG: OrgAutonomousConfig = {
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

// "event" added for genuinely event-driven agents (e.g. FollowupGeneratorAgent,
// fired by a pipeline stage transition rather than autonomous/manual/chain/
// schedule) - migration 081 widened agent_queue/agent_runs.trigger_source's
// CHECK constraint to match.
type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

export abstract class AutonomousAgent {
  protected orgId: string;
  protected agentId: string;
  protected supabase: SupabaseClient;

  /** started_at (ISO) per open agent_runs id, so completeRun()/failRun() can
   * report a real duration to orchestration_logs. A single agent instance is
   * reused across many run() passes by the poll-loop processors (e.g.
   * worker/knowledge-indexer-processor.ts), so this must be keyed by runId,
   * not a single instance field. */
  private runStartedAt = new Map<string, string>();

  constructor(orgId: string, agentId: string, supabase: SupabaseClient) {
    this.orgId = orgId;
    this.agentId = agentId;
    this.supabase = supabase;
  }

  /**
   * AR-9.1: orchestration_logs (migration 190, AR-6.2) had exactly zero rows
   * in production despite 178+ real runs/3h through this exact class,
   * because AR-6.2 only wired worker/autonomous-orchestrator.ts's
   * agent_queue consumer — a path fed solely by on-demand trigger routes
   * that had queued nothing for 24+ hours. The actual high-volume traffic
   * (every AutonomousAgent subclass, e.g. ag-29-knowledge-indexer's 24/7
   * poll loop) runs entirely through startRun()/completeRun()/failRun()
   * below and was never instrumented. This writes one orchestration_logs
   * row per completeRun()/failRun() call — the real step boundary this
   * class actually has.
   *
   * Never throws and never masks the caller's real result: an observability
   * write that silently swallowed its own failure is exactly the defect
   * class this exists to fix, so a failed or thrown write is logged at
   * error level with a fixed, greppable "[orchestration_logs]" prefix
   * instead of disappearing.
   */
  private async writeOrchestrationLog(params: {
    runId: string;
    status: "completed" | "failed";
    itemsExpected?: number | null;
    itemsProcessed?: number | null;
    errorMessage?: string | null;
  }): Promise<void> {
    const startedAt = this.runStartedAt.get(params.runId) ?? new Date().toISOString();
    this.runStartedAt.delete(params.runId);
    const finishedAt = new Date().toISOString();

    try {
      const result = await logOrchestrationStep(this.supabase, {
        organizationId: this.orgId,
        orchestrationId: params.runId,
        taskId: this.agentId,
        agentType: this.agentId,
        agentRunId: params.runId,
        status: params.status,
        startedAt,
        finishedAt,
        durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
        itemsExpected: params.itemsExpected ?? null,
        itemsProcessed: params.itemsProcessed ?? null,
        errorMessage: params.errorMessage ?? null,
        schemaValidationPassed: params.status === "completed",
      });
      if (!result.ok) {
        console.error(
          `[orchestration_logs] WRITE FAILED for ${this.agentId} run ${params.runId}: ${result.error}`,
        );
      }
    } catch (e) {
      console.error(
        `[orchestration_logs] WRITE THREW for ${this.agentId} run ${params.runId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /**
   * Records a single autonomous decision to agent_decisions for audit and
   * human review. Confidence below MIN_CONFIDENCE_TO_ACT always forces
   * required_human_review=true, regardless of what the caller requested.
   */
  protected async logDecision(params: {
    decisionType: string;
    agentRunId?: string;
    entityType?: string;
    entityId?: string;
    reasoning: string;
    confidenceScore: number;
    actionTaken: string;
    actionPayload?: Record<string, unknown>;
    requiredHumanReview?: boolean;
  }): Promise<string> {
    const requiredHumanReview =
      params.confidenceScore < AUTONOMOUS_HARD_LIMITS.MIN_CONFIDENCE_TO_ACT
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
      throw new Error(
        `Failed to log agent decision: ${error?.message ?? "no row returned"}`,
      );
    }
    return (data as { id: string }).id;
  }

  /** Opens an agent_runs row for this run. Returns its id. */
  protected async startRun(
    triggerSource: TriggerSource,
    inputParams?: Record<string, unknown>,
  ): Promise<string> {
    const startedAt = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("agent_runs")
      .insert({
        organization_id: this.orgId,
        agent_type: this.agentId,
        status: "running",
        trigger_source: triggerSource,
        input_params: inputParams ?? {},
        started_at: startedAt,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to start agent run: ${error?.message ?? "no row returned"}`,
      );
    }
    const runId = (data as { id: string }).id;
    this.runStartedAt.set(runId, startedAt);

    // AR-9.2: no single wrapper method calls a subclass's run() body here
    // (unlike BaseAgent.run()), so enterWith attributes the rest of this
    // async chain -- including whatever Anthropic calls the subclass makes
    // after awaiting startRun() -- to this run, without a closure.
    enterUsageContext({ organizationId: this.orgId, agentType: this.agentId, agentRunId: runId });

    return runId;
  }

  /** Marks an agent_runs row completed with whatever summary fields apply.
   * `status`/`errorMessage` let a batch-style agent report a real failure
   * (e.g. "found N, processed 0") without losing the itemsFound/itemsProcessed/
   * outputSummary bookkeeping that a plain failRun() call would drop — status
   * defaults to "completed" so existing callers are unaffected. */
  protected async completeRun(
    runId: string,
    params: {
      outputSummary: string;
      itemsFound?: number;
      itemsProcessed?: number;
      itemsQueued?: number;
      tokensUsed?: number;
      nextAction?: string;
      confidenceScore?: number;
      /** agent_runs.output_payload jsonb (migration 080) -- structured run
       * output for agents whose result is more than a one-line summary. */
      outputPayload?: Record<string, unknown>;
      status?: "completed" | "failed";
      errorMessage?: string;
    },
  ): Promise<void> {
    const patch: Record<string, unknown> = {
      status: params.status ?? "completed",
      completed_at: new Date().toISOString(),
      output_summary: params.outputSummary,
    };
    if (params.itemsFound !== undefined) patch.items_found = params.itemsFound;
    if (params.itemsProcessed !== undefined)
      patch.items_processed = params.itemsProcessed;
    if (params.itemsQueued !== undefined)
      patch.items_queued = params.itemsQueued;
    if (params.tokensUsed !== undefined) patch.tokens_used = params.tokensUsed;
    if (params.nextAction !== undefined) patch.next_action = params.nextAction;
    if (params.confidenceScore !== undefined)
      patch.confidence_score = params.confidenceScore;
    if (params.outputPayload !== undefined)
      patch.output_payload = params.outputPayload;
    if (params.errorMessage !== undefined) patch.error_message = redactSecrets(params.errorMessage);

    await this.supabase.from("agent_runs").update(patch).eq("id", runId);

    await this.writeOrchestrationLog({
      runId,
      status: (patch.status as "completed" | "failed" | undefined) ?? "completed",
      itemsExpected: params.itemsFound ?? null,
      itemsProcessed: params.itemsProcessed ?? null,
      errorMessage: params.errorMessage ?? null,
    });

    // Silent-failure guard (CROSS_WIRING_REPORT.md, 2026-09-15): a run can
    // report status='completed' while having found real work and processed
    // none of it -- ag-29-knowledge-indexer's original bug (fixed to report
    // status='failed' in that specific agent, p5a-001), but nothing stopped
    // any OTHER AutonomousAgent subclass from hitting the same pattern and
    // going equally unnoticed. This check is shared and agent-agnostic on
    // purpose -- it does not depend on a subclass remembering to call
    // createNotification() itself, which was exactly the gap that let ag-29
    // run silently broken for 4+ days with zero alert.
    if (
      (patch.status ?? "completed") === "completed" &&
      params.itemsFound !== undefined &&
      params.itemsProcessed !== undefined &&
      params.itemsFound > 0 &&
      params.itemsProcessed === 0
    ) {
      await this.createNotification(
        "silent_failure",
        `${this.agentId}: found ${params.itemsFound} item(s), processed 0`,
        params.outputSummary,
        undefined,
        "warning",
      );
    }
  }

  /** Marks an agent_runs row failed. Never throws - a logging failure must
   * never mask the original error the caller is already handling.
   * AR-7.3: redacted here, once, so no subclass has to remember to do it
   * itself before a caught Postgres/provider error reaches error_message. */
  protected async failRun(runId: string, errorMessage: string): Promise<void> {
    await this.supabase
      .from("agent_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: redactSecrets(errorMessage),
      })
      .eq("id", runId);

    await this.writeOrchestrationLog({
      runId,
      status: "failed",
      errorMessage,
    });
  }

  /** Enqueues a downstream agent run in agent_queue (BEHAVIORAL_CONTRACTS §23
   * priority queue). chainedFromRunId is folded into input_payload since
   * agent_queue has no dedicated column for it. */
  protected async queueChainedAgent(
    agentId: string,
    priority: number,
    inputPayload: Record<string, unknown>,
    chainedFromRunId?: string,
  ): Promise<void> {
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
  protected async getOrgConfig(): Promise<OrgAutonomousConfig> {
    const { data } = await this.supabase
      .from("org_autonomous_config")
      .select(
        "auto_research_enabled, auto_score_enabled, auto_draft_enabled, " +
          "auto_draft_threshold, auto_reputation_enabled, auto_relationship_enabled, " +
          "auto_deadline_prediction_enabled, auto_followup_enabled, " +
          "notify_on_auto_draft, notify_on_high_score, max_auto_drafts_per_night",
      )
      .eq("org_id", this.orgId)
      .maybeSingle();

    if (!data) return SAFE_DEFAULT_CONFIG;
    return data as unknown as OrgAutonomousConfig;
  }

  /** Writes an org-wide in-app notice. This schema has no `notifications`
   * table - notices live in `alerts` (see file header). */
  protected async createNotification(
    type: string,
    title: string,
    message: string,
    metadata?: Record<string, unknown>,
    severity: "info" | "warning" | "error" | "success" = "info",
  ): Promise<void> {
    void metadata; // no jsonb column on `alerts` to persist this into.
    await this.supabase.from("alerts").insert({
      organization_id: this.orgId,
      type: "system",
      severity,
      message: message ? `${title}: ${message}` : title,
      dedup_key: `autonomous:${this.agentId}:${type}:${crypto.randomUUID()}`,
    });
  }

  abstract run(triggerSource: TriggerSource): Promise<AutonomousAgentResult>;
}
