-- ============================================================================
-- BENAVORA - Migration 197: AR-10.2 - adapter_usage_log retired as a cost
-- writer.
--
-- adapter_usage_log (migration 076) is real operational telemetry --
-- adapter_name, records_returned, cache_hit, called_at all have live readers
-- (google-places-adapter.ts's own cache-hit bookkeeping, the connectors page
-- via GET /api/donor-discovery/connectors's last_used_at/records_enriched
-- aggregation). api_cost_cents is the dishonest column: google-places-
-- adapter.ts computed a real number for paid Nearby Search calls but never
-- durably priced it against a rate card, and connectors/usage-log.ts (the
-- Apollo/Hunter §6 BYOK path) wrote a literal 0 unconditionally regardless of
-- real spend. AR-5.1 already made ai_usage_log the platform's single per-call
-- cost ledger for Anthropic calls; this migration extends that same ledger
-- to the last cost writer outside it.
--
-- ── model_cost_reference: extend for non-token (per-call) API pricing ──────
-- Every existing row (migration 192) is a token-priced Anthropic model.
-- pricing_unit defaults to 'token' so those rows -- and every reader that
-- selects them -- are byte-for-byte unaffected. Non-LLM per-call APIs get
-- pricing_unit='call' rows instead: usd_per_call replaces the four per-Mtok
-- columns, which don't apply to a call-metered API and are nullable
-- specifically to make room for these rows (they stay NOT NULL in spirit --
-- enforced instead by the CHECK below -- for every 'token' row).
-- ============================================================================

ALTER TABLE public.model_cost_reference
  ALTER COLUMN input_usd_per_mtok DROP NOT NULL,
  ALTER COLUMN output_usd_per_mtok DROP NOT NULL,
  ALTER COLUMN cache_write_usd_per_mtok DROP NOT NULL,
  ALTER COLUMN cache_read_usd_per_mtok DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS pricing_unit text NOT NULL DEFAULT 'token',
  ADD COLUMN IF NOT EXISTS usd_per_call numeric(10,4);

ALTER TABLE public.model_cost_reference
  DROP CONSTRAINT IF EXISTS model_cost_reference_pricing_unit_check;
ALTER TABLE public.model_cost_reference
  ADD CONSTRAINT model_cost_reference_pricing_unit_check
  CHECK (
    (pricing_unit = 'token'
      AND input_usd_per_mtok IS NOT NULL AND output_usd_per_mtok IS NOT NULL
      AND cache_write_usd_per_mtok IS NOT NULL AND cache_read_usd_per_mtok IS NOT NULL
      AND usd_per_call IS NULL)
    OR
    (pricing_unit = 'call'
      AND usd_per_call IS NOT NULL
      AND input_usd_per_mtok IS NULL AND output_usd_per_mtok IS NULL
      AND cache_write_usd_per_mtok IS NULL AND cache_read_usd_per_mtok IS NULL)
  );

-- google_places: $0.032/request, carried forward verbatim from
-- google-places-adapter.ts's pre-existing COST_PER_REQUEST_USD constant
-- ("Basic Data SKU, same rate as Text Search (New)") -- not re-verified live
-- against Google's pricing page in this migration, unlike migration 192's
-- Anthropic rates. Keyed as 'google_places' to match that file's own
-- PROVIDER constant (also `adapter_usage_log.adapter_name` and
-- `donor_discovery_connectors.provider`), not a new naming convention.
INSERT INTO public.model_cost_reference
  (model, pricing_unit, usd_per_call, effective_from, source)
VALUES
  ('google_places', 'call', 0.032, '2026-09-18',
   'src/lib/donor-discovery/adapters/google-places-adapter.ts COST_PER_REQUEST_USD (Basic Data SKU, same rate as Text Search (New))')
ON CONFLICT (model) DO UPDATE SET
  pricing_unit = EXCLUDED.pricing_unit,
  usd_per_call = EXCLUDED.usd_per_call,
  input_usd_per_mtok = NULL,
  output_usd_per_mtok = NULL,
  cache_write_usd_per_mtok = NULL,
  cache_read_usd_per_mtok = NULL,
  effective_from = EXCLUDED.effective_from,
  source = EXCLUDED.source;

-- Apollo/Hunter (§6 BYOK connectors, connectors/usage-log.ts) have no known
-- real per-call rate anywhere in this codebase (grep, 2026-09-18: zero hits
-- for "cost"/"price"/"USD" in connectors/apollo-connector.ts,
-- connectors/hunter-connector.ts) -- no row is seeded for either. Every call
-- through priceApiCall('apollo' | 'hunter', ...) resolves to
-- {priced:false, costUsd:null}, an honest unpriced marker rather than an
-- invented rate, until a real one is sourced and added here.

-- ── adapter_usage_log: freeze api_cost_cents ────────────────────────────────
COMMENT ON COLUMN adapter_usage_log.api_cost_cents IS
  'Superseded by ai_usage_log.cost_usd (AR-10.2) -- Google Places/connector '
  'spend now flows through recordCost() via model_cost_reference''s '
  'pricing_unit=''call'' rows (or an explicit unpriced null), the same '
  'single per-call cost ledger every Anthropic call uses. No code writes '
  'this column going forward -- it stays at its DEFAULT 0 on every new row. '
  'Historical non-zero rows are unchanged here; they were backfilled into '
  'ai_usage_log below before this freeze. adapter_name, records_returned, '
  'cache_hit, and called_at remain live operational telemetry, not '
  'superseded by anything.';

-- ── Backfill: historical api_cost_cents > 0 rows into ai_usage_log ─────────
-- One ai_usage_log row per historical adapter_usage_log row that recorded
-- real spend (api_cost_cents > 0). Cache-hit and budget-limited rows are
-- correctly 0 already (no API call happened) and carry nothing to backfill.
-- organization_id is nullable on adapter_usage_log (platform-wide adapter
-- runs have no owning org) but NOT NULL on ai_usage_log -- rows with no
-- organization_id have no attributable org and are skipped rather than
-- guessed at. Every historical non-zero row was written by
-- google-places-adapter.ts (connectors/usage-log.ts always wrote a literal
-- 0), so adapter_name is 'google_places' for all of them; the backfill
-- reads it from the row rather than hardcoding that fact, in case that ever
-- changes before this migration runs.
INSERT INTO ai_usage_log
  (organization_id, model, endpoint, input_tokens, output_tokens, total_tokens,
   cost_usd, duration_ms, agent_type, provider, billing_path, created_at)
SELECT
  organization_id,
  adapter_name,
  'donor-discovery-adapter-backfill',
  0, 0, 0,
  api_cost_cents / 100.0,
  NULL,
  NULL,
  adapter_name,
  'api',
  called_at
FROM adapter_usage_log
WHERE api_cost_cents > 0
  AND organization_id IS NOT NULL;

-- ============================================================================
-- END Migration 197
-- ============================================================================
