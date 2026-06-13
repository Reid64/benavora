-- ============================================================
-- BENAVORA — Migration 015: Funder Intelligence
-- Apply AFTER 014_validations.sql
--
-- Adds a funder_intelligence table to store AI-extracted
-- structured intelligence about funders: priorities, recent
-- grants, board members, review criteria, funding cycles,
-- grant size statistics, and application tips.
--
-- One row per (organization_id, funder_id) pair, upserted on
-- each agent run. The funder_intel agent type is added to the
-- agent_type DB enum so BaseAgent can log runs to agent_runs.
-- ============================================================

-- Add funder_intel to the agent_type enum so the agent can
-- write its runs to agent_runs via BaseAgent (Contracts §15).
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'funder_intel';

-- ------------------------------------------------------------
-- funder_intelligence — one row per org × funder pair.
-- Upserted by the FunderIntelAgent on every successful scrape.
-- ------------------------------------------------------------
CREATE TABLE funder_intelligence (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id),
  funder_id            uuid NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  priorities           text[],
  recent_grants        jsonb,
  board_members        jsonb,
  review_criteria      text,
  funding_cycles       text,
  average_grant_size   numeric(12, 2),
  total_annual_giving  numeric(12, 2),
  application_tips     text,
  last_scraped_at      timestamptz,
  raw_data             jsonb,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX idx_funder_intelligence_org    ON funder_intelligence (organization_id);
CREATE INDEX idx_funder_intelligence_funder ON funder_intelligence (funder_id);

-- Enforce one intelligence record per org × funder.
CREATE UNIQUE INDEX uq_funder_intelligence_org_funder
  ON funder_intelligence (organization_id, funder_id);

-- ------------------------------------------------------------
-- RLS — org isolation (master pattern, Migration 001).
-- ------------------------------------------------------------
ALTER TABLE funder_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "funder_intelligence_org_isolation" ON funder_intelligence
  USING (organization_id = public.current_org_id());

-- ============================================================
-- END Migration 015
-- ============================================================
