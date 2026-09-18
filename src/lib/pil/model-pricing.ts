import { createAdminClient } from "@/lib/supabase/admin";

// AR-10.1: the single resolver every token-to-dollar computation in this repo
// must go through. Supersedes src/lib/ai/pricing.ts (AR-9.2), which read
// model_cost_reference correctly but lived at the wrong address for the
// FORGE gate (gates/ar-10-rate-card-consumed.mjs expects exactly this path)
// and had no typed "unpriced" result or alerting -- an unpriced model
// resolved to a bare `null` with no signal that spend had gone dark.
//
// Cached in-process: rates change rarely (model_cost_reference is a manually
// curated, dated rate card, not a live feed) and this runs in hot paths --
// every Anthropic call and every PIL agent's T-MODEL tool use.

interface ModelRate {
  // AR-10.2: 'token' rows (every pre-existing Anthropic row) carry
  // input/output; 'call' rows (non-LLM per-call APIs -- Google Places,
  // connector enrichers) carry usdPerCall instead. Missing pricing_unit
  // (rows selected before migration 197 added the column, or mocked in
  // ai-pricing.test.ts) defaults to 'token' so every pre-AR-10.2 row and
  // test fixture keeps resolving exactly as before.
  pricingUnit: "token" | "call";
  input: number | null;
  output: number | null;
  usdPerCall: number | null;
  effectiveFrom: string;
  source: string;
}

let cache: Map<string, ModelRate> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadRates(): Promise<Map<string, ModelRate>> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;

  const { data, error } = await createAdminClient()
    .from("model_cost_reference")
    .select("model, input_usd_per_mtok, output_usd_per_mtok, effective_from, source, pricing_unit, usd_per_call");

  if (error || !data) {
    // A stale cache beats no pricing at all. On the very first load (no
    // cache yet) this falls through to an empty map, which every resolver
    // below reads as "every model unpriced" until the next successful
    // refresh -- visible via null cost_usd rows and an unpriced-model alert,
    // never a silent 0.
    return cache ?? new Map();
  }

  cache = new Map(
    data.map((row) => [
      row.model as string,
      {
        pricingUnit: ((row as { pricing_unit?: string }).pricing_unit as "token" | "call" | undefined) ?? "token",
        input: row.input_usd_per_mtok != null ? Number(row.input_usd_per_mtok) : null,
        output: row.output_usd_per_mtok != null ? Number(row.output_usd_per_mtok) : null,
        usdPerCall: (row as { usd_per_call?: number | string | null }).usd_per_call != null
          ? Number((row as { usd_per_call?: number | string | null }).usd_per_call)
          : null,
        effectiveFrom: row.effective_from as string,
        source: row.source as string,
      },
    ]),
  );
  cacheLoadedAt = now;
  return cache;
}

export type PriceResult =
  | {
      priced: true;
      model: string;
      costUsd: number;
      inputUsdPerMtok: number;
      outputUsdPerMtok: number;
      effectiveFrom: string;
      source: string;
    }
  | { priced: false; model: string; costUsd: null };

// Best-effort, per-model-throttled admin alert when a model has no row in
// model_cost_reference. This is the cost_overage-adjacent signal for pricing:
// cost_overage means "we know the spend and it exceeded budget", this means
// "we cannot compute the spend at all" -- an equally invisible-spend failure
// mode if it is allowed to resolve to a silent 0. Written to system_errors,
// the same table AR-9.2's usage-recorder.ts already uses for the two other
// non-DB-derivable ai_usage_log failure modes (no context / write failure),
// rather than inventing a second alerting path for a third variant of the
// same underlying problem.
const lastUnpricedAlertAt = new Map<string, number>();
const UNPRICED_ALERT_THROTTLE_MS = 10 * 60 * 1000;

async function reportUnpricedModel(model: string): Promise<void> {
  const now = Date.now();
  const last = lastUnpricedAlertAt.get(model) ?? 0;
  if (now - last < UNPRICED_ALERT_THROTTLE_MS) return;
  lastUnpricedAlertAt.set(model, now);
  try {
    await createAdminClient().from("system_errors").insert({
      source: "model_pricing",
      error_type: "unpriced_model",
      message:
        `Model "${model}" has no row in model_cost_reference -- its cost cannot ` +
        "be computed and is being recorded as unpriced (null), never as a fabricated " +
        "0 or free call. Add a dated, sourced rate row to restore traceability.",
      severity: "warning",
    });
  } catch {
    // Alerting must never mask or block the caller's real work.
  }
}

/**
 * Resolves the dollar cost of one Anthropic call from a real input/output
 * token split. Returns a typed unpriced result -- never a bare 0 or null
 * standing in silently for "don't know" -- when `model` has no row in
 * model_cost_reference.
 */
export async function priceUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<PriceResult> {
  const rates = await loadRates();
  const rate = rates.get(model);
  if (!rate || rate.pricingUnit !== "token" || rate.input == null || rate.output == null) {
    await reportUnpricedModel(model);
    return { priced: false, model, costUsd: null };
  }
  const costUsd = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  return {
    priced: true,
    model,
    costUsd,
    inputUsdPerMtok: rate.input,
    outputUsdPerMtok: rate.output,
    effectiveFrom: rate.effectiveFrom,
    source: rate.source,
  };
}

export type ApiCallPriceResult =
  | {
      priced: true;
      model: string;
      costUsd: number;
      usdPerCall: number;
      effectiveFrom: string;
      source: string;
    }
  | { priced: false; model: string; costUsd: null };

/**
 * AR-10.2: resolves the dollar cost of `calls` invocations of a per-call
 * (non-token) API -- Google Places, donor-discovery connector enrichers --
 * from a model_cost_reference row with pricing_unit='call'. Same never-a-
 * silent-0 contract as priceUsage(): a model with no row, or a row that
 * turns out to be token-priced, resolves to a typed unpriced result and
 * fires the same throttled system_errors alert, not a fabricated $0.00.
 */
export async function priceApiCall(model: string, calls: number): Promise<ApiCallPriceResult> {
  const rates = await loadRates();
  const rate = rates.get(model);
  if (!rate || rate.pricingUnit !== "call" || rate.usdPerCall == null) {
    await reportUnpricedModel(model);
    return { priced: false, model, costUsd: null };
  }
  return {
    priced: true,
    model,
    costUsd: calls * rate.usdPerCall,
    usdPerCall: rate.usdPerCall,
    effectiveFrom: rate.effectiveFrom,
    source: rate.source,
  };
}

/**
 * Simple number|null form of priceUsage(), for callers that just want a
 * ledger value and already treat null as "unpriced" (never 0). Preserves the
 * exact signature src/lib/ai/pricing.ts's computeCostUsd() had, so callers
 * that only need a dollar figure don't have to unwrap the typed result.
 */
export async function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<number | null> {
  const result = await priceUsage(model, inputTokens, outputTokens);
  return result.priced ? result.costUsd : null;
}

// The model every PIL agent (src/lib/pil/agents/**) runs on per governance
// (CLAUDE.md / AGENTS_v2.md: "claude-sonnet-4-6 for all agents unless
// specified"). Centralized here so a future model swap for the PIL framework
// is a one-line change instead of a 24-file one.
export const PIL_AGENT_MODEL = "claude-sonnet-4-6";

/**
 * Blended (input+output averaged) per-token USD rate for PIL_AGENT_MODEL.
 * Exists only for AgentRunner.useTool()'s "model_tokens" costType, which
 * tracks a single combined token count rather than a real input/output
 * split (agent-runner.ts's useTool() call sites pass one `units` number) --
 * a pre-existing shape of that code path, not something this resolver can
 * recover precisely. Callers that DO have a real input/output split (every
 * direct Anthropic call, via src/lib/ai/usage-recorder.ts) must use
 * priceUsage()/computeCostUsd() instead for an exact figure; this blended
 * rate is a documented approximation, not a second source of truth.
 * Returns null -- never 0 -- when PIL_AGENT_MODEL is unpriced.
 */
export async function pilBlendedTokenRateUsd(): Promise<number | null> {
  const rates = await loadRates();
  const rate = rates.get(PIL_AGENT_MODEL);
  if (!rate || rate.pricingUnit !== "token" || rate.input == null || rate.output == null) {
    await reportUnpricedModel(PIL_AGENT_MODEL);
    return null;
  }
  return (rate.input + rate.output) / 2 / 1_000_000;
}
