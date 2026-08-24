-- ============================================================================
-- Migration 149 -- success_probability_scores unique constraint (WGR-170)
--
-- src/lib/agents/success-probability.ts upserts with
-- { onConflict: "application_id" }, which requires a real unique (or
-- exclusion) constraint on that column - without one, Postgres raises 42P10
-- ("no unique or exclusion constraint matching the ON CONFLICT
-- specification") on every write.
--
-- 038_intelligence_tables.sql's CREATE TABLE declares application_id ...
-- UNIQUE inline, but per migration 145's header comment, this table already
-- existed live (created out-of-band) before 038 ran, so CREATE TABLE IF NOT
-- EXISTS no-op'd against it and the inline UNIQUE never actually applied to
-- the live table - the same column-drift pattern 145 closed for
-- data_quality/created_at/updated_at. This closes the same gap for the
-- unique constraint. Guarded so it is a no-op if the constraint (or an
-- equivalent one under a different name) already exists.
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE success_probability_scores
    ADD CONSTRAINT success_probability_scores_application_id_key UNIQUE (application_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
