-- Migration 088: extend foundation_profiles (migration 081, not yet applied to
-- production as of this migration) with total_grants_made, top_recipients, a
-- multi-value geographic_focus, and a uniqueness constraint so the foundation
-- profile builder (api/foundations/[id]/profile) can upsert idempotently by
-- foundation_id. Written as an ALTER against 081 rather than editing that
-- already-committed file, matching this project's established convention of
-- never rewriting a prior migration once committed.

ALTER TABLE foundation_profiles
  ADD COLUMN IF NOT EXISTS total_grants_made numeric,
  ADD COLUMN IF NOT EXISTS top_recipients jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'foundation_profiles'
      AND column_name = 'geographic_focus'
      AND data_type <> 'ARRAY'
  ) THEN
    ALTER TABLE foundation_profiles
      ALTER COLUMN geographic_focus TYPE text[]
      USING CASE WHEN geographic_focus IS NULL THEN NULL ELSE ARRAY[geographic_focus] END;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'foundation_profiles_foundation_id_key'
  ) THEN
    ALTER TABLE foundation_profiles
      ADD CONSTRAINT foundation_profiles_foundation_id_key UNIQUE (foundation_id);
  END IF;
END $$;
