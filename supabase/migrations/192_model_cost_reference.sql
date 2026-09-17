-- ============================================================================
-- BENAVORA - Migration 192: AR-6.4 Part B - model_cost_reference, the current
-- per-model Anthropic rate card.
--
-- public.model_cost_reference did not exist before this migration (verified
-- against project vbjplpquqxxfbpazyalt on 2026-09-17).
--
-- The originating spec's rate card (dated September 2025; claude-opus-4 /
-- claude-sonnet-4) is NOT used here — neither model id appears anywhere in
-- src/ or worker/ (grep, 2026-09-17: 0 hits for both, vs. 41 references to
-- claude-sonnet-4-6, 5 to claude-haiku-4-5-20251001, 1 to claude-haiku-4-5).
-- claude-sonnet-5 and claude-opus-5 are seeded ahead of any call site in this
-- repo so a future model swap is never silently unpriced.
--
-- Rates verified directly against https://claude.com/pricing on 2026-09-17
-- (live fetch, not recalled from training data) — every row below matches
-- that page exactly, including per-model cache read/write rates. source
-- records that URL per row rather than "spec" or a static doc.
--
-- Cache pricing: cache_write_usd_per_mtok holds the 5-minute-TTL rate
-- (1.25x input_usd_per_mtok), matching what the pricing page publishes
-- per-model. The 1-hour-TTL write rate (2x input_usd_per_mtok) is not a
-- separate column — see the column comment. Cache read is 0.1x
-- input_usd_per_mtok for both TTLs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.model_cost_reference (
  model                     text PRIMARY KEY,
  input_usd_per_mtok        numeric(10,4) NOT NULL,
  output_usd_per_mtok       numeric(10,4) NOT NULL,
  cache_write_usd_per_mtok  numeric(10,4) NOT NULL,
  cache_read_usd_per_mtok   numeric(10,4) NOT NULL,
  effective_from            date NOT NULL,
  source                    text NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.model_cost_reference.cache_write_usd_per_mtok IS
  'Rate for the 5-minute cache TTL (1.25x input_usd_per_mtok). For the '
  '1-hour TTL, multiply input_usd_per_mtok by 2x instead of using this '
  'column -- Anthropic prices the two TTLs differently and this table '
  'carries only the 5-minute write rate.';

-- No tenant column -- this is a global reference table (rates apply to every
-- org identically), unlike every other table this migration set touches.
ALTER TABLE public.model_cost_reference ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_cost_reference FROM anon;
GRANT SELECT ON public.model_cost_reference TO authenticated;

CREATE POLICY "model_cost_reference_read_all" ON public.model_cost_reference
  FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.model_cost_reference
  (model, input_usd_per_mtok, output_usd_per_mtok, cache_write_usd_per_mtok, cache_read_usd_per_mtok, effective_from, source)
VALUES
  ('claude-sonnet-4-6',          3.00, 15.00, 3.75, 0.30, '2026-09-17', 'https://claude.com/pricing'),
  ('claude-haiku-4-5',           1.00,  5.00, 1.25, 0.10, '2026-09-17', 'https://claude.com/pricing'),
  ('claude-haiku-4-5-20251001',  1.00,  5.00, 1.25, 0.10, '2026-09-17', 'https://claude.com/pricing'),
  ('claude-sonnet-5',            2.00, 10.00, 2.50, 0.20, '2026-09-17', 'https://claude.com/pricing'),
  ('claude-opus-5',              5.00, 25.00, 6.25, 0.50, '2026-09-17', 'https://claude.com/pricing')
ON CONFLICT (model) DO UPDATE SET
  input_usd_per_mtok = EXCLUDED.input_usd_per_mtok,
  output_usd_per_mtok = EXCLUDED.output_usd_per_mtok,
  cache_write_usd_per_mtok = EXCLUDED.cache_write_usd_per_mtok,
  cache_read_usd_per_mtok = EXCLUDED.cache_read_usd_per_mtok,
  effective_from = EXCLUDED.effective_from,
  source = EXCLUDED.source;

-- ============================================================================
-- END Migration 192
-- ============================================================================
