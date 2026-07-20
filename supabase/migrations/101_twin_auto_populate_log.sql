-- 101_twin_auto_populate_log.sql — adds a jsonb audit-log column to
-- organizational_digital_twins (migration 093) for twin-auto-populate.ts,
-- which fills twin/KB gaps from nonprofits (IRS BMF, migration 098/099),
-- foundation_directory/foundation_profiles (migrations 046/081), Claude web
-- search, and agent_decisions, then records every populated/skipped field
-- here rather than silently mutating the twin.
--
-- Same conditional-add style as migrations 058/072/099/100 so this is safe
-- to re-run. Applied to `supabase/migrations/` (not `src/supabase/migrations/`)
-- because organizational_digital_twins itself lives there (093_digital_twins.sql).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizational_digital_twins' AND column_name = 'twin_auto_populate_log') THEN
    ALTER TABLE organizational_digital_twins ADD COLUMN twin_auto_populate_log jsonb DEFAULT '[]';
  END IF;
END $$;
