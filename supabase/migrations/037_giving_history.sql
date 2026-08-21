-- Migration 037: Funder giving history (SCHEMA_REGISTRY v2 Table 49)
-- Stores historical grant awards extracted from 990 data and other sources.
-- Used by the Success Probability Agent (Agent 22) for Factor 2 (Giving History Match).

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'giving_history_extractor';

CREATE TABLE IF NOT EXISTS funder_giving_history (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid         NOT NULL REFERENCES organizations(id),
  funder_id       uuid         NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  amount          numeric(12,2),
  fiscal_year     integer,
  grant_purpose   text,
  recipient_name  text,
  source          text,
  created_at      timestamptz  DEFAULT now()
);

ALTER TABLE funder_giving_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "giving_history_org" ON funder_giving_history;
CREATE POLICY "giving_history_org" ON funder_giving_history
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_giving_history_org    ON funder_giving_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_giving_history_funder ON funder_giving_history(funder_id);
CREATE INDEX IF NOT EXISTS idx_giving_history_year   ON funder_giving_history(fiscal_year DESC);
