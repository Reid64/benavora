// Autonomous draft generator. Processes the draft_queue without human
// intervention, reusing the same generateDraft code path as the interactive
// /api/ai/draft route. Callers supply a supabase client (service-role for
// cron/background jobs; session-scoped is acceptable when called from an API
// route that already has an authenticated context).

import type { SupabaseClient } from "@supabase/supabase-js";

import { trackUsage } from "@/lib/billing/usage-tracker";
import { incrementUsage } from "@/lib/billing/usage-limiter";
import type { Database } from "@/types/database";
import { generateDraft, VALID_TEMPLATE_TYPES } from "@/lib/drafts/generator";
import type { DraftTemplateType } from "@/types/ai";

type TypedClient = SupabaseClient<Database>;

type DraftQueueRow = Database["public"]["Tables"]["draft_queue"]["Row"];
type DraftQueueUpdate = Database["public"]["Tables"]["draft_queue"]["Update"];
type DraftQueueStatus = Database["public"]["Enums"]["draft_queue_status"];

export interface GenerationResult {
  generated: number;
  failed: number;
  /** Items that were not started because the daily limit was already reached. */
  skipped_limit: number;
  /** Remaining daily budget after this run. */
  remaining_budget: number;
}

export class DraftAutoGenerator {
  private readonly supabase: TypedClient;

  constructor(supabase: TypedClient) {
    this.supabase = supabase;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Process pending queue items for the given org, up to the daily limit
   * defined in draft_automation_config. Items are ordered by priority ASC,
   * deadline_date ASC (most urgent first).
   */
  async processQueue(
    orgId: string,
    limit?: number,
  ): Promise<GenerationResult> {
    const { data: config } = await this.supabase
      .from("draft_automation_config")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!config?.is_enabled) {
      return { generated: 0, failed: 0, skipped_limit: 0, remaining_budget: 0 };
    }

    const dailyLimit = (config.daily_draft_limit as number | null) ?? 10;
    const notifyOnGeneration =
      (config.notification_on_generation as boolean | null) ?? false;

    const todayGenerated = await this.countTodayGenerated(orgId);
    const remainingBudget = Math.max(0, dailyLimit - todayGenerated);

    if (remainingBudget === 0) {
      const pendingCount = await this.countPendingItems(orgId);
      return {
        generated: 0,
        failed: 0,
        skipped_limit: pendingCount,
        remaining_budget: 0,
      };
    }

    const batchSize = Math.min(remainingBudget, limit ?? 5);

    const { data: items } = await this.supabase
      .from("draft_queue")
      .select("*")
      .eq("organization_id", orgId)
      .eq("status", "pending")
      .order("priority", { ascending: true })
      .order("deadline_date", { ascending: true })
      .limit(batchSize);

    const pendingItems = (items ?? []) as DraftQueueRow[];
    const totalPending = await this.countPendingItems(orgId);

    let generated = 0;
    let failed = 0;

    for (const item of pendingItems) {
      const success = await this.processItem(item, notifyOnGeneration);
      if (success) {
        generated++;
      } else {
        failed++;
      }
    }

    const skippedLimit = Math.max(0, totalPending - pendingItems.length);

    return {
      generated,
      failed,
      skipped_limit: skippedLimit,
      remaining_budget: Math.max(0, remainingBudget - generated),
    };
  }

  /**
   * Process a single queue item on demand (manual retry from the UI or an
   * ad-hoc trigger). Returns true on success, false on failure.
   */
  async generateSingle(queueItemId: string): Promise<boolean> {
    const { data: item, error } = await this.supabase
      .from("draft_queue")
      .select("*")
      .eq("id", queueItemId)
      .single();

    if (error || !item) return false;

    const { data: config } = await this.supabase
      .from("draft_automation_config")
      .select("notification_on_generation")
      .eq("organization_id", (item as DraftQueueRow).organization_id)
      .maybeSingle();

    const notifyOnGeneration =
      (config?.notification_on_generation as boolean | null) ?? false;

    return this.processItem(item as DraftQueueRow, notifyOnGeneration);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async processItem(
    item: DraftQueueRow,
    notifyOnGeneration: boolean,
  ): Promise<boolean> {
    const orgId = item.organization_id;
    const opportunityId = item.opportunity_id;
    const templateType = item.template_type as DraftTemplateType;

    if (!VALID_TEMPLATE_TYPES.includes(templateType)) {
      await this.markFailed(
        item.id,
        item.retry_count,
        item.max_retries,
        `Unknown template_type: ${item.template_type}`,
      );
      return false;
    }

    // Mark as generating.
    await this.supabase
      .from("draft_queue")
      .update({
        status: "generating" as DraftQueueStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    try {
      const output = await generateDraft({
        supabase: this.supabase,
        organizationId: orgId,
        opportunityId,
        templateType,
        createdByUserId: null,
        draftSource: "auto_generated",
      });

      const now = new Date().toISOString();
      const successUpdate: DraftQueueUpdate = {
        status: "generated" as DraftQueueStatus,
        draft_id: output.savedVersion?.id ?? null,
        confidence_score: output.confidenceScore,
        gap_count: output.gapCount,
        word_count: output.wordCount,
        auto_generated_at: now,
        error_message: null,
        updated_at: now,
      };
      await this.supabase
        .from("draft_queue")
        .update(successUpdate)
        .eq("id", item.id);

      // Track billing usage (best-effort; non-fatal).
      try {
        await Promise.all([
          trackUsage(this.supabase, orgId, "api_calls", 1),
          incrementUsage(this.supabase, orgId, "ai_drafts"),
        ]);
      } catch (usageErr: unknown) {
        console.error(
          "[AUTO-GENERATOR] Usage tracking failed:",
          (usageErr as Error).message,
        );
      }

      if (notifyOnGeneration) {
        await this.createNotification(orgId, item.id, output.confidenceScore);
      }

      return true;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Generation failed.";
      await this.markFailed(
        item.id,
        item.retry_count,
        item.max_retries,
        message,
      );
      return false;
    }
  }

  private async markFailed(
    itemId: string,
    currentRetryCount: number | null,
    maxRetries: number | null,
    message: string,
  ): Promise<void> {
    const retryCount = (currentRetryCount ?? 0) + 1;
    const max = maxRetries ?? 3;
    const now = new Date().toISOString();

    const update: DraftQueueUpdate =
      retryCount < max
        ? {
            // Reset to pending so the next processQueue cycle picks it up.
            status: "pending" as DraftQueueStatus,
            retry_count: retryCount,
            error_message: message,
            updated_at: now,
          }
        : {
            status: "failed" as DraftQueueStatus,
            retry_count: retryCount,
            error_message: message,
            updated_at: now,
          };

    await this.supabase.from("draft_queue").update(update).eq("id", itemId);
  }

  private async createNotification(
    orgId: string,
    queueItemId: string,
    confidenceScore: number,
  ): Promise<void> {
    try {
      await this.supabase.from("automation_notifications").insert({
        organization_id: orgId,
        event_type: "agent_completed",
        title: "Draft Auto-Generated",
        message: `A draft was automatically generated with ${confidenceScore}% confidence.`,
        related_entity_type: "draft_queue",
        related_entity_id: queueItemId,
      });
    } catch (notifErr: unknown) {
      console.error(
        "[AUTO-GENERATOR] Notification insert failed:",
        (notifErr as Error).message,
      );
    }
  }

  private async countTodayGenerated(orgId: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { count } = await this.supabase
      .from("draft_queue")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .not("auto_generated_at", "is", null)
      .gte("auto_generated_at", todayStart.toISOString());

    return count ?? 0;
  }

  private async countPendingItems(orgId: string): Promise<number> {
    const { count } = await this.supabase
      .from("draft_queue")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "pending");

    return count ?? 0;
  }
}
