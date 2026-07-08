-- Migration 060: Grantmaker profiles for the Grant Intelligence Library
-- (GrantmakerProfileBuilder / build-grantmaker-profiles.ts).
--
-- Migration 048 already created a table named intelligence_grantmaker_profiles
-- for the funder-intel / semantic-matching agents (funder_id, priorities,
-- award_range_min/max, typical_language, common_keywords, decision_timeline,
-- application_tips). Since 048 runs before this migration, a second
-- `CREATE TABLE IF NOT EXISTS intelligence_grantmaker_profiles` here would
-- silently no-op and never add the columns this feature actually reads/writes
-- (foundation_id, name, program_priorities, typical_award_range,
-- language_patterns, ...) — breaking GrantmakerProfileBuilder and the CLI
-- script with "column does not exist" at runtime. Extend the existing table
-- instead of redefining it, so both feature sets share one table safely.

ALTER TABLE intelligence_grantmaker_profiles
  ADD COLUMN IF NOT EXISTS foundation_id uuid REFERENCES foundation_directory(id),
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS total_annual_giving numeric(14,2),
  ADD COLUMN IF NOT EXISTS program_priorities text[],
  ADD COLUMN IF NOT EXISTS typical_award_range jsonb,
  ADD COLUMN IF NOT EXISTS language_patterns text[],
  ADD COLUMN IF NOT EXISTS application_url text,
  ADD COLUMN IF NOT EXISTS last_profiled_at timestamptz,
  ADD COLUMN IF NOT EXISTS profile_data jsonb DEFAULT '{}';

-- Backfill name for pre-existing (048-era) rows keyed by funder_id, so legacy
-- rows aren't left with a null name now that the column exists.
UPDATE intelligence_grantmaker_profiles gp
  SET name = f.name
  FROM funders f
  WHERE gp.funder_id = f.id AND gp.name IS NULL;

-- Plain (non-partial) unique index: required for the CLI script's
-- `.upsert(rows, { onConflict: 'foundation_id' })` to resolve conflicts.
-- Multiple NULLs are allowed under a unique index, so this is safe for
-- legacy 048-era rows that have no foundation_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_grantmaker_profiles_foundation_id ON intelligence_grantmaker_profiles(foundation_id);
CREATE INDEX IF NOT EXISTS idx_grantmaker_profiles_ein ON intelligence_grantmaker_profiles(ein);
CREATE INDEX IF NOT EXISTS idx_grantmaker_profiles_geo ON intelligence_grantmaker_profiles USING gin(geographic_focus);
