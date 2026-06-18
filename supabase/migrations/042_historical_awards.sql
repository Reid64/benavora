-- ============================================================================
-- BENAVORA - Migration 042: Historical awards (USAspending.gov competitive intel)
--
-- Stores historical federal awards pulled from the public USAspending.gov API
-- (who got funded, how much, for what). This is competitive intelligence shown
-- on the Research Command Center: what funders ACTUALLY funded vs what they say.
--
-- Org-scoped (each tenant pulls its own keyword-matched set). award_id is unique
-- per organization so two tenants can each store the same public federal award.
-- Org isolation via the master RLS pattern (Migration 001). Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS historical_awards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  recipient_name   text,
  award_amount     numeric(12,2),
  award_date       date,
  awarding_agency  text,
  description      text,
  award_id         text,
  source           text DEFAULT 'usaspending.gov',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_awards_org_award
  ON historical_awards (organization_id, award_id);
CREATE INDEX IF NOT EXISTS idx_historical_awards_org
  ON historical_awards (organization_id);

ALTER TABLE historical_awards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "historical_awards_org_isolation" ON historical_awards;
CREATE POLICY "historical_awards_org_isolation" ON historical_awards
  USING (organization_id = public.current_org_id());

-- ============================================================================
-- END Migration 042
-- ============================================================================
