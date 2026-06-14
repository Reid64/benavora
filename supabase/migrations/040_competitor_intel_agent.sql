-- Migration 040: Competitor Intelligence Agent (AGENTS.md Agent 24, BEHAVIORAL_CONTRACTS §27).
-- Adds agent_type enum value and extends competitor_tracking with per-competitor fields
-- for 990-PF giving history analysis. Enterprise/Consultant tiers only.

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'competitor_intelligence';

-- Extend competitor_tracking to support individual competitor records from 990-PF analysis.
-- Existing columns (opportunity_id, estimated_applicants, competition_level) remain intact
-- for backward-compatible opportunity-level competition tracking.
ALTER TABLE competitor_tracking
  ADD COLUMN IF NOT EXISTS competitor_name text,
  ADD COLUMN IF NOT EXISTS grant_amount     numeric(12,2),
  ADD COLUMN IF NOT EXISTS grant_purpose    text,
  ADD COLUMN IF NOT EXISTS fiscal_year      integer;

CREATE INDEX IF NOT EXISTS idx_competitor_funder ON competitor_tracking (funder_id)
  WHERE funder_id IS NOT NULL;
