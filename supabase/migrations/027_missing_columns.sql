-- ============================================================================
-- Migration 027 — idempotent guard for columns referenced in application code
--
-- These three columns were flagged as potentially missing. Migrations 010, 011,
-- and 012 already added them, so every ALTER below is a safe no-op on an
-- up-to-date database. The file exists as an explicit safety net: if a fresh
-- Supabase project is restored from a partial snapshot that skipped any of
-- those earlier migrations, these statements will add what is missing without
-- breaking anything that is already present.
--
-- Codebase audit (2026-06-14): a full grep of Supabase queries in
-- app/api/**, lib/**, and components/** found no additional columns on
-- opportunities, applications, funders, or search_profiles that are referenced
-- in TypeScript but absent from the schema established by migrations 001–026.
-- ============================================================================

-- search_profiles.agent_settings (migration 011 adds this; guard only)
ALTER TABLE search_profiles
  ADD COLUMN IF NOT EXISTS agent_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- opportunities.match_percentage (migration 012 adds this; guard only)
-- Note: migration 012 defines a CHECK constraint; this statement is skipped
-- entirely by IF NOT EXISTS on an up-to-date database.
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS match_percentage integer DEFAULT 0;

-- opportunities.source_type (migration 010 adds this as opportunity_source_type
-- enum; IF NOT EXISTS makes this a no-op on any database where that migration ran)
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'not_classified';
