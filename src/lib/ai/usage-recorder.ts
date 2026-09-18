import { createAdminClient } from "@/lib/supabase/admin";
import { getUsageContext } from "@/lib/ai/usage-context";
import { computeCostUsd } from "@/lib/ai/pricing";
import { recordCost } from "@/lib/pil/cost";

// AR-9.2 (recovery): this was originally inline in src/lib/ai/claude.ts, which
// meant only the four callClaude* wrappers could record. The ~34 modules that
// build their own `new Anthropic(...)` client (autoapply, intelligence,
// donor-discovery, scraper-v2, enrichment) went through none of it and
// recorded nothing. Lifting it here lets src/lib/ai/tracked-anthropic.ts
// instrument those raw clients through the SAME recorder, so there is exactly
// one implementation of "an Anthropic call becomes a cost row" rather than two
// that can drift.

// FORGE build runs execute on a Max subscription and carry no per-token dollar
// cost; runtime agents burn ANTHROPIC_API_KEY and do. Nothing in the request
// distinguishes them, so the runtime path is 'api' and 'subscription' exists
// for callers that know they are not metered.
export type BillingPath = "api" | "subscription";

// Best-effort, throttled admin alert when an Anthropic call ran with no usage
// context set (getUsageContext() returned undefined) -- its cost could not be
// attributed to an org and was not recorded. This is the visible signal for
// exactly the failure mode this fix exists to close: a call that goes
// unmeasured must never look identical to one that cost nothing.
let lastUncontextedCallAlertAt = 0;
const USAGE_LOG_ALERT_THROTTLE_MS = 10 * 60 * 1000;

async function reportUncontextedCall(source: string): Promise<void> {
  const now = Date.now();
  if (now - lastUncontextedCallAlertAt < USAGE_LOG_ALERT_THROTTLE_MS) return;
  lastUncontextedCallAlertAt = now;
  try {
    await createAdminClient().from("system_errors").insert({
      source: "ai_usage_log",
      error_type: "usage_log_no_context",
      message:
        `A ${source} call ran with no organization/agent usage context set ` +
        "(src/lib/ai/usage-context.ts) -- its cost could not be attributed " +
        "and was not recorded in ai_usage_log.",
      severity: "warning",
    });
  } catch {
    // Alerting must never mask or block the caller's real response.
  }
}

let lastUsageLogWriteErrorAlertAt = 0;

async function reportUsageLogWriteFailure(source: string, err: unknown): Promise<void> {
  const now = Date.now();
  if (now - lastUsageLogWriteErrorAlertAt < USAGE_LOG_ALERT_THROTTLE_MS) return;
  lastUsageLogWriteErrorAlertAt = now;
  try {
    await createAdminClient().from("system_errors").insert({
      source: "ai_usage_log",
      error_type: "usage_log_write_failed",
      message:
        `Failed to write ai_usage_log for a ${source} call: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      severity: "warning",
    });
  } catch {
    // Alerting must never mask or block the caller's real response.
  }
}

/**
 * Records one Anthropic call's cost to the single per-call ledger
 * (ai_usage_log, AR-5.1/AR-9.2). Never throws -- a logging failure must never
 * fail an Anthropic call that already succeeded. Skips recording (and alerts
 * instead) when no usage context is set, since organization_id is NOT NULL on
 * ai_usage_log and there is nothing to attribute the row to.
 */
export async function recordUsage(
  source: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  durationMs: number,
  billingPath: BillingPath = "api",
): Promise<void> {
  const context = getUsageContext();
  if (!context) {
    await reportUncontextedCall(source);
    return;
  }

  try {
    // A subscription-billed call has no per-token dollar cost; recording a
    // computed price for it would overstate spend. It still gets a row with
    // its real token counts -- the tokens are the measurement, the dollars
    // are not applicable.
    const costUsd = billingPath === "subscription"
      ? null
      : await computeCostUsd(model, inputTokens, outputTokens);
    await recordCost({
      organization_id: context.organizationId,
      model,
      endpoint: source,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      cost_usd: costUsd,
      duration_ms: durationMs,
      agent_type: context.agentType,
      agent_run_id: context.agentRunId ?? null,
      pil_agent_run_id: null,
      provider: "anthropic",
      billing_path: billingPath,
    });
  } catch (err) {
    await reportUsageLogWriteFailure(source, err);
  }
}
