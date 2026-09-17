import type { SupabaseClient } from "@supabase/supabase-js";

import type { AlertSeverity } from "./alerts-service";

/**
 * AR-6.3 - the three orchestration alert types that are not trigger-derivable
 * (rate_limit, rollback, manual_review_required): nothing in Postgres knows
 * an upstream provider rate-limited a request, that a rollback ran, or that
 * an agent refused an action pending human review — those facts only exist
 * in application code. Rules 1-5 (task_failed, cost_overage, schema_mismatch,
 * state_drift, timeout) are raised by deterministic triggers in migration
 * 191; this is the equivalent write path for the other three, sharing the
 * same dedup contract (uq_alerts_org_dedup, migration 013) so a repeated
 * call with the same dedup key does not create a second row.
 *
 * Mirrors the trigger-side "an alerting failure must never fail the work it
 * is observing" contract: every failure mode here (network error, RLS
 * rejection, bad enum value) is swallowed, never thrown.
 */

export type OrchestrationAlertType = "rate_limit" | "rollback" | "manual_review_required";

export interface RaiseOrchestrationAlertInput {
  organizationId: string;
  orchestrationId?: string | null;
  type: OrchestrationAlertType;
  severity: AlertSeverity;
  message: string;
  dedupKey: string;
  link?: string | null;
}

export async function raiseOrchestrationAlert(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  input: RaiseOrchestrationAlertInput,
): Promise<void> {
  try {
    const { error } = await supabase.from("alerts").upsert(
      {
        organization_id: input.organizationId,
        orchestration_id: input.orchestrationId ?? null,
        type: input.type,
        severity: input.severity,
        message: input.message,
        dedup_key: input.dedupKey,
        link: input.link ?? null,
      },
      { onConflict: "organization_id,dedup_key", ignoreDuplicates: true },
    );
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(`[raiseOrchestrationAlert] failed to raise ${input.type}: ${error.message}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[raiseOrchestrationAlert] threw while raising ${input.type}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
