import { createAdminClient } from "@/lib/supabase/admin";
import { priceApiCall } from "@/lib/pil/model-pricing";
import { recordCost } from "@/lib/pil/cost";

/**
 * Shared `adapter_usage_log` (migration 076) writer for §6 BYO-key
 * connectors — same table `google-places-adapter.ts` already logs to, with
 * `adapter_name` set to the connector's provider key ("apollo"/"hunter") so
 * the connectors page's `GET /api/donor-discovery/connectors` route (which
 * already aggregates this table by `adapter_name` for `last_used_at`/
 * `records_enriched`) picks these calls up with no route change needed.
 *
 * AR-10.2: this used to also write an api_cost_cents (now superseded) value
 * of `0` unconditionally, a dishonest zero for a call that may well have
 * cost real money. That column is frozen (migration 197); the cost
 * dimension now goes to ai_usage_log via
 * recordCost(), priced through model_cost_reference if a rate for this
 * connector exists, or recorded as an explicit unpriced null (never a
 * fabricated $0) if it doesn't — neither Apollo nor Hunter has a seeded rate
 * today (see migration 197's comment), so every call currently resolves
 * unpriced and fires the same throttled system_errors alert an unpriced
 * Anthropic model does.
 */
export async function logConnectorUsage(params: {
  organizationId: string;
  adapterName: string;
  recordsReturned: number;
}): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("adapter_usage_log").insert({
    organization_id: params.organizationId,
    adapter_name: params.adapterName,
    records_returned: params.recordsReturned,
    cache_hit: false,
  });

  try {
    const priced = await priceApiCall(params.adapterName, 1);
    await recordCost({
      organization_id: params.organizationId,
      model: params.adapterName,
      endpoint: "donor-discovery-connector-enrichment",
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_usd: priced.costUsd,
      duration_ms: null,
      agent_type: null,
      agent_run_id: null,
      pil_agent_run_id: null,
      provider: params.adapterName,
      billing_path: "api",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[usage-log] Failed to record ai_usage_log cost for ${params.adapterName}: ${message}`);
  }
}
