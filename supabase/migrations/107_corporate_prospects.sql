-- 107_corporate_prospects.sql
--
-- Creates corporate_prospects (CORPORATE_INTELLIGENCE_ARCHITECTURE.md Section 1C,
-- SCHEMA_REGISTRY_v2.md table 36) and registers the 5 new EA-0X corporate
-- enrichment agent_type values these EA-01..EA-05 agents log to agent_runs.
--
-- This table is referenced extensively in SCHEMA_REGISTRY_v2.md and
-- CORPORATE_INTELLIGENCE_ARCHITECTURE.md, but SCHEMA_REGISTRY_v2.md's own
-- July 19 2026 live-database-audit section lists it under "Tables documented
-- above that do NOT exist in production" ("no successor found; feature never
-- shipped to prod") -- confirmed again this session via grep across
-- supabase/migrations/, src/supabase/migrations/, and src/types/database.ts:
-- zero matches anywhere. This migration creates it fresh so EA-01..EA-05 have
-- a real write target for `enrichment` jsonb instead of writing to a
-- nonexistent table.
--
-- NO RLS: shared public/cross-org reference data, same convention as
-- foundation_directory (046_foundation_directory.sql) -- service-role only
-- access via these agents, no client-facing route reads it yet.
--
-- NOT CONFIRMED APPLIED TO PRODUCTION this session -- no working Management
-- API / MCP DDL path was exercised (see project memory on the July 19 2026
-- 401 and the recurring "no DDL path found" pattern). Apply manually via the
-- Supabase SQL Editor: https://supabase.com/dashboard/project/vbjplpquqxxfbpazyalt/sql/new

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ea01_giving_detector';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ea02_community_outreach_detector';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ea03_sponsorship_detector';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ea04_foundation_detector';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ea05_career_page_analyzer';

CREATE TABLE IF NOT EXISTS corporate_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identity
  legal_name text NOT NULL,
  dba_name text,
  ein text,
  duns_number text,
  -- Contact
  website text,
  phone text,
  email text,
  address_street text,
  address_city text,
  address_state text,
  address_zip text,
  address_lat numeric,
  address_lng numeric,
  -- Classification
  naics_code text,
  naics_description text,
  sic_code text,
  industry_category text,
  -- Size indicators
  employee_count_estimate text,
  revenue_estimate text,
  location_count integer,
  geographic_footprint text[],
  -- Ownership
  ownership_type text,
  is_family_owned boolean,
  is_veteran_owned boolean,
  is_minority_owned boolean,
  is_woman_owned boolean,
  parent_company_id uuid REFERENCES corporate_prospects(id),
  -- Source tracking
  source_adapters text[],
  first_seen_at timestamptz DEFAULT now(),
  last_verified_at timestamptz,
  -- Enrichment (AI-populated, written by EA-01..EA-10)
  enrichment jsonb DEFAULT '{}',
  enrichment_version integer DEFAULT 0,
  enrichment_started_at timestamptz,
  enrichment_completed_at timestamptz,
  -- Scoring
  scores jsonb DEFAULT '{}',
  scores_computed_at timestamptz,
  giving_dna jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT corporate_prospects_name_city_state_unique UNIQUE (legal_name, address_city, address_state)
);

CREATE INDEX IF NOT EXISTS idx_corporate_prospects_naics ON corporate_prospects(naics_code);
CREATE INDEX IF NOT EXISTS idx_corporate_prospects_state ON corporate_prospects(address_state);
CREATE INDEX IF NOT EXISTS idx_corporate_prospects_ein ON corporate_prospects(ein);
CREATE INDEX IF NOT EXISTS idx_corporate_prospects_scores ON corporate_prospects USING gin(scores);
CREATE INDEX IF NOT EXISTS idx_corporate_prospects_enrichment ON corporate_prospects USING gin(enrichment);
