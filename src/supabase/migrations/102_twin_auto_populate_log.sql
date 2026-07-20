-- 102_twin_auto_populate_log.sql — mirrors
-- supabase/migrations/101_twin_auto_populate_log.sql in this fork.
--
-- See [[benavora-two-parallel-migrations-directories]] (project memory) /
-- 094_twin_powered_draft_generation.sql's own header: organizational_digital_twins
-- was independently created in BOTH migrations forks (this one's 094, and
-- supabase/migrations/093_digital_twins.sql), with the same column shape,
-- because it was never resolved which fork is actually applied to the live
-- DB. twin-auto-populate.ts (src/lib/intelligence/) needs
-- organizational_digital_twins.twin_auto_populate_log to exist regardless of
-- which fork is live, so this column-add is applied in both places rather
-- than guessing. Safe to re-run (conditional add, matches this fork's own
-- 099/100 style and the other fork's 058/072/099/100 style).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizational_digital_twins')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizational_digital_twins' AND column_name = 'twin_auto_populate_log') THEN
    ALTER TABLE organizational_digital_twins ADD COLUMN twin_auto_populate_log jsonb DEFAULT '[]';
  END IF;
END $$;
