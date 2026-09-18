import { createAdminClient } from "@/lib/supabase/admin";

// AR-9.2: reads the live rate card (migration 192, model_cost_reference)
// instead of a hardcoded map, so a rate change or a newly-seeded model
// doesn't require a code deploy. Cached in-process for CACHE_TTL_MS -- every
// Anthropic call would otherwise pay a DB round trip for pricing alone.

interface ModelRate {
  input: number;
  output: number;
}

let cache: Map<string, ModelRate> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadRates(): Promise<Map<string, ModelRate>> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;

  const { data, error } = await createAdminClient()
    .from("model_cost_reference")
    .select("model, input_usd_per_mtok, output_usd_per_mtok");

  if (error || !data) {
    // A stale cache beats no pricing at all. On the very first load (no
    // cache yet) this falls through to an empty map, which computeCostUsd
    // reads as "every model unpriced" until the next successful refresh --
    // visible via null cost_usd rows, never a silent 0.
    return cache ?? new Map();
  }

  cache = new Map(
    data.map((row) => [
      row.model as string,
      {
        input: Number(row.input_usd_per_mtok),
        output: Number(row.output_usd_per_mtok),
      },
    ]),
  );
  cacheLoadedAt = now;
  return cache;
}

/**
 * Returns null -- never 0 -- when `model` has no row in
 * model_cost_reference. AR-9.2: a silent 0 there is indistinguishable from a
 * real free (subscription-billed) call, which is exactly the ambiguity that
 * let the cost ledger go unnoticed while empty. Callers must persist null
 * and let dashboards read it as "unpriced", not "free".
 */
export async function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<number | null> {
  const rates = await loadRates();
  const rate = rates.get(model);
  if (!rate) return null;
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}
