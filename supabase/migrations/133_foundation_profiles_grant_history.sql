-- Migration 133: extend foundation_profiles (migrations 081/088) with
-- grant_history — row #66, per-recipient 990 Schedule I line items
-- ([{recipient, amount, year, purpose}]) surfaced by
-- src/lib/intelligence/foundation-profiler.ts's computeFoundationProfile()
-- and persisted by src/app/api/foundations/[id]/profile/route.ts. Written as
-- an ALTER against 081/088 rather than editing those already-committed
-- files, matching this project's established convention (see 088's own
-- header) of never rewriting a prior migration once committed.

ALTER TABLE foundation_profiles
  ADD COLUMN IF NOT EXISTS grant_history jsonb;
