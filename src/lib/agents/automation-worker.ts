// Automation Worker Agent — AGENTS.md Agent 29, BEHAVIORAL_CONTRACTS §23.
//
// Processes the next queued item from automation_queue by invoking the browser
// automation pipeline. Enforces:
//   - Stale item reaping: items stuck in 'processing' >5 minutes are re-queued
//     or permanently failed per retry_count vs max_retries.
//   - Concurrent processing cap: 1 for Starter/Professional, 3 for Enterprise/Consultant.
//   - Daily submission cap per tier limit (Contracts §23, SCHEMA_REGISTRY §3).
//   - Optimistic-lock claim: update status='processing' only where status='queued'
//     to prevent double-processing under concurrent API calls.
//   - Retry logic: retry_count < max_retries → status='queued'; else 'failed'.
//
// This class does NOT extend BaseAgent because the processing budget is 5 minutes
// per item (§23) while BaseAgent enforces a 60-second ceiling (AGENTS.md §15),
// which would kill the browser automation step that fills the form. Logging to
// agent_runs follows the same schema and conventions as BaseAgent.

import type { SupabaseClient } from "@supabase/supabase-js";

import { BrowserAutomationAgent } from "@/lib/agents/browser-automation";
import { resolveTier } from "@/lib/billing/usage-tracker";
import type { AgentType } from "@/types/agents";
import type { Json } from "@/types/database";

/** 5-minute per-item processing budget (BEHAVIORAL_CONTRACTS §23). */
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1_000;

/** Daily submission caps by tier (SCHEMA_REGISTRY §3 limits.daily_submissions). */
const DAILY_SUBMISSION_LIMITS: Record<string, number> = {
  free: 5,
  starter: 5,
  professional: 25,
  enterprise: 100,
  consultant: Infinity,
};

/** Max concurrent 'processing' items by tier (BEHAVIORAL_CONTRACTS §23). */
const CONCURRENT_LIMITS: Record<string, number> = {
  free: 1,
  starter: 1,
  professional: 1,
  enterprise: 3,
  consultant: 3,
};

export interface AutomationWorkerOptions {
  client: SupabaseClient;
  organizationId: string;
  triggeredBy?: string | null;
}

export interface AutomationWorkerInput {
  /** Process this specific queue item. If omitted, picks highest-priority queued item. */
  queueItemId?: string;
}

export interface AutomationWorkerResult {
  queueItemId: string | null;
  applicationId: string | null;
  queueStatus: string;
  message: string;
}

interface QueueItem {
  id: string;
  application_id: string;
  automation_level: string;
  retry_count: number;
  max_retries: number;
  error_log: Json;
}

export class AutomationWorkerAgent {
  readonly agentType: AgentType = "automation_worker";

  private readonly client: SupabaseClient;
  private readonly organizationId: string;
  private readonly triggeredBy: string | null;

  constructor(options: AutomationWorkerOptions) {
    this.client = options.client;
    this.organizationId = options.organizationId;
    this.triggeredBy = options.triggeredBy ?? null;
  }

  async process(
    input: AutomationWorkerInput,
  ): Promise<{ runId: string | null; data: AutomationWorkerResult }> {
    const startedAt = Date.now();
    const runId = await this.logStart(input);

    try {
      const data = await this.withTimeout(this.execute(input));
      await this.logComplete(runId, data, Date.now() - startedAt);
      return { runId, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Worker execution failed.";
      await this.logFailed(runId, msg, Date.now() - startedAt);
      throw err;
    }
  }

  private async execute(
    input: AutomationWorkerInput,
  ): Promise<AutomationWorkerResult> {
    // 1. Reap stale 'processing' items exceeding the 5-minute budget.
    await this.reapTimedOutItems();

    // 2. Resolve tier and derive limits.
    const tier = await resolveTier(this.client, this.organizationId);
    const dailyLimit = DAILY_SUBMISSION_LIMITS[tier] ?? 5;
    const concurrentLimit = CONCURRENT_LIMITS[tier] ?? 1;

    // 3. Check concurrent processing cap.
    const { count: processingCount } = await this.client
      .from("automation_queue")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", this.organizationId)
      .eq("status", "processing");

    if ((processingCount ?? 0) >= concurrentLimit) {
      return {
        queueItemId: null,
        applicationId: null,
        queueStatus: "processing",
        message: `Concurrent processing limit (${concurrentLimit}) reached for ${tier} tier.`,
      };
    }

    // 4. Check daily submission cap.
    if (isFinite(dailyLimit)) {
      const todayUTC = new Date();
      todayUTC.setUTCHours(0, 0, 0, 0);

      const { count: todayCount } = await this.client
        .from("automation_queue")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", this.organizationId)
        .eq("status", "completed")
        .gte("completed_at", todayUTC.toISOString());

      if ((todayCount ?? 0) >= dailyLimit) {
        // Pause all remaining queued items for today (§23).
        await this.client
          .from("automation_queue")
          .update({ status: "paused" })
          .eq("organization_id", this.organizationId)
          .eq("status", "queued");

        return {
          queueItemId: null,
          applicationId: null,
          queueStatus: "paused",
          message: `Daily submission limit (${dailyLimit}) reached for ${tier} tier. Queued items paused.`,
        };
      }
    }

    // 5. Find the next queued item.
    let queueItem: QueueItem | null = null;

    if (input.queueItemId) {
      const { data } = await this.client
        .from("automation_queue")
        .select(
          "id, application_id, automation_level, retry_count, max_retries, error_log",
        )
        .eq("id", input.queueItemId)
        .eq("organization_id", this.organizationId)
        .eq("status", "queued")
        .single();
      queueItem = (data as QueueItem | null);
    } else {
      const { data: items } = await this.client
        .from("automation_queue")
        .select(
          "id, application_id, automation_level, retry_count, max_retries, error_log",
        )
        .eq("organization_id", this.organizationId)
        .eq("status", "queued")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1);
      queueItem = (items?.[0] as QueueItem | undefined) ?? null;
    }

    if (!queueItem) {
      return {
        queueItemId: null,
        applicationId: null,
        queueStatus: "empty",
        message: "No queued items found.",
      };
    }

    // 6. Atomically claim the item (optimistic lock on status='queued').
    const { data: claimed } = await this.client
      .from("automation_queue")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
      })
      .eq("id", queueItem.id)
      .eq("status", "queued")
      .select("id")
      .single();

    if (!claimed) {
      return {
        queueItemId: queueItem.id,
        applicationId: queueItem.application_id,
        queueStatus: "claimed_by_other",
        message: "Item was claimed by another worker.",
      };
    }

    // 7. Invoke the browser automation pipeline.
    try {
      const browserAgent = new BrowserAutomationAgent({
        client: this.client,
        organizationId: this.organizationId,
        triggeredBy: this.triggeredBy,
      });

      await browserAgent.run({ applicationId: queueItem.application_id });

      // Success: mark completed.
      await this.client
        .from("automation_queue")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", queueItem.id);

      await this.notify(
        "automation_completed",
        "Automation Complete",
        "Browser automation pipeline completed successfully.",
        queueItem.id,
      );

      return {
        queueItemId: queueItem.id,
        applicationId: queueItem.application_id,
        queueStatus: "completed",
        message: "Automation pipeline completed.",
      };
    } catch (err) {
      // 8. Failure: apply retry logic (§23).
      return await this.handleItemFailure(
        queueItem,
        err instanceof Error ? err.message : "Unknown automation error.",
      );
    }
  }

  /** Re-queue or permanently fail items stuck in 'processing' past the 5-min budget. */
  private async reapTimedOutItems(): Promise<void> {
    const cutoff = new Date(Date.now() - PROCESSING_TIMEOUT_MS).toISOString();

    const { data: stale } = await this.client
      .from("automation_queue")
      .select("id, retry_count, max_retries, error_log")
      .eq("organization_id", this.organizationId)
      .eq("status", "processing")
      .lt("started_at", cutoff);

    if (!stale?.length) return;

    for (const item of stale) {
      const log = Array.isArray(item.error_log) ? item.error_log : [];
      const newCount = (item.retry_count as number) + 1;
      const maxRetries = (item.max_retries as number) ?? 3;
      const newLog = [
        ...log,
        { error: "timeout", attempt: newCount, at: new Date().toISOString() },
      ];
      const isPermanentlyFailed = newCount >= maxRetries;

      await this.client
        .from("automation_queue")
        .update({
          status: isPermanentlyFailed ? "failed" : "queued",
          retry_count: newCount,
          error_log: newLog as Json,
          started_at: null,
          ...(isPermanentlyFailed
            ? { completed_at: new Date().toISOString() }
            : {}),
        })
        .eq("id", item.id as string);
    }
  }

  /** Apply retry logic on automation failure. Re-queues or permanently fails. */
  private async handleItemFailure(
    item: QueueItem,
    errorMessage: string,
  ): Promise<AutomationWorkerResult> {
    const existingLog = Array.isArray(item.error_log) ? item.error_log : [];
    const newCount = item.retry_count + 1;
    const maxRetries = item.max_retries ?? 3;
    const newLog = [
      ...existingLog,
      { error: errorMessage, attempt: newCount, at: new Date().toISOString() },
    ];

    if (newCount >= maxRetries) {
      await this.client
        .from("automation_queue")
        .update({
          status: "failed",
          retry_count: newCount,
          error_log: newLog as Json,
          completed_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      await this.notify(
        "automation_failed",
        "Automation Failed",
        `Automation failed permanently after ${newCount} attempt(s): ${errorMessage}`,
        item.id,
      );

      return {
        queueItemId: item.id,
        applicationId: item.application_id,
        queueStatus: "failed",
        message: `Permanently failed after ${newCount} attempt(s): ${errorMessage}`,
      };
    }

    // Re-queue at same priority for retry.
    await this.client
      .from("automation_queue")
      .update({
        status: "queued",
        retry_count: newCount,
        error_log: newLog as Json,
        started_at: null,
      })
      .eq("id", item.id);

    return {
      queueItemId: item.id,
      applicationId: item.application_id,
      queueStatus: "queued",
      message: `Re-queued for retry (attempt ${newCount}/${maxRetries}): ${errorMessage}`,
    };
  }

  private async notify(
    eventType: string,
    title: string,
    message: string,
    queueItemId: string,
  ): Promise<void> {
    await this.client.from("automation_notifications").insert({
      organization_id: this.organizationId,
      event_type: eventType,
      title,
      message,
      related_entity_type: "automation_queue",
      related_entity_id: queueItemId,
    });
  }

  // --- agent_runs logging (mirrors BaseAgent conventions) --------------------

  private async logStart(input: AutomationWorkerInput): Promise<string | null> {
    const { data } = await this.client
      .from("agent_runs")
      .insert({
        organization_id: this.organizationId,
        agent_type: this.agentType,
        status: "running",
        triggered_by: this.triggeredBy,
        input_params: (input ?? null) as Json,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    return (data?.id as string | undefined) ?? null;
  }

  private async logComplete(
    runId: string | null,
    result: AutomationWorkerResult,
    durationMs: number,
  ): Promise<void> {
    if (!runId) return;
    await this.client
      .from("agent_runs")
      .update({
        status: "completed",
        output_summary: result.message,
        items_processed: result.queueItemId ? 1 : 0,
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
  }

  private async logFailed(
    runId: string | null,
    errorMessage: string,
    durationMs: number,
  ): Promise<void> {
    if (!runId) return;
    await this.client
      .from("agent_runs")
      .update({
        status: "failed",
        error_message: errorMessage,
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
  }

  private withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `Automation worker timed out after ${PROCESSING_TIMEOUT_MS / 60_000} minutes.`,
            ),
          ),
        PROCESSING_TIMEOUT_MS,
      );
    });
    return Promise.race([work, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  }
}
