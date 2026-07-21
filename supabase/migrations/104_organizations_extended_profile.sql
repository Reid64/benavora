-- 104_organizations_extended_profile.sql — Knowledge Base Editor (10-section
-- profile UI at /knowledge-base/edit) support.
--
-- Task-given spec vs real schema, checked before writing a line of code here
-- per this project's established practice (see migrations 093/101 headers for
-- prior instances of this same pattern): the task's spec assumed a
-- `knowledge_base_profiles` table that does not exist anywhere in this schema.
-- The real 10-section profile data already lives across `organizations`
-- (mission_statement, vision_statement, founding_date, founder_name,
-- founder_bio, service_area, target_population, annual_budget, total_staff,
-- total_volunteers, tax_status, ein), `board_members`, `programs`
-- (impact_metrics jsonb already covers per-program extra fields), and
-- `knowledge_base` (partnerships/impact/organizational_history/need_statement
-- categories) — see src/lib/intelligence/twin-completeness.ts's header for the
-- prior audit of this exact gap.
--
-- Per Core Data Principles #2/#3 (SCHEMA_REGISTRY_v2.md §4.2 — "all
-- enrichment data stored as jsonb, never add columns per field"), the
-- remaining task-requested fields with no relational home (core values, ED
-- contact, financial breakdown, service radius/counties, target-population
-- demographics, KPIs, milestones, partnerships detail, compliance detail) are
-- added as ONE jsonb bucket rather than ~30 new scalar columns.
--
-- Idempotent per repo convention (migrations 058/072/099/100/101). Applied to
-- `supabase/migrations/` (not `src/supabase/migrations/`) — same directory as
-- `organizations` itself (001_initial_schema.sql) and the twin tables
-- (093_digital_twins.sql). NOT YET APPLIED to the live database as of this
-- migration file's creation — apply manually via the Supabase SQL editor or
-- Management API (see STATE_OF_THE_BUILD.md; the Management API PAT on file
-- returned 401 as of 2026-07-19).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'extended_profile') THEN
    ALTER TABLE organizations ADD COLUMN extended_profile jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;
