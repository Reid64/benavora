-- ============================================================================
-- BENAVORA — Migration 025: Fix alerts route — missing schema for /api/alerts
-- Apply AFTER 024_audit_logs.sql
--
-- The GET /api/alerts route queries opportunities.match_percentage and the
-- alerts table. If either migration 012 (match_percentage) or migration 013
-- (alerts table) was not applied to this database, the route returns 500 on
-- every request:
--
--   • Missing match_percentage → opportunitiesRes.error truthy → route returns
--     "Failed to assemble alerts." (line 103) even for an org with no data.
--   • Missing alerts table    → readError truthy at the read-back query →
--     route returns "Failed to load alerts." after the assemble phase passes.
--
-- Both guards are idempotent (IF NOT EXISTS / DO $$ EXCEPTION) so re-running
-- this migration against a database that already has these objects is harmless.
-- No governance document or existing RLS policy is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. opportunities.match_percentage (migration 012 guard)
--
-- Added by migration 012 but may be absent if that migration was skipped.
-- All three columns are agent-owned (BEHAVIORAL_CONTRACTS §5) and nullable
-- so existing rows keep NULL until the eligibility-scoring agent re-scores.
-- ----------------------------------------------------------------------------

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS match_percentage integer
    CHECK (match_percentage IS NULL OR (match_percentage >= 0 AND match_percentage <= 100));

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS is_high_priority boolean NOT NULL DEFAULT false;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS match_mismatch_reasons text[];

CREATE INDEX IF NOT EXISTS idx_opportunities_match_percentage
  ON opportunities (match_percentage DESC NULLS LAST);

-- ----------------------------------------------------------------------------
-- 2. alert_type / alert_severity enums (migration 013 guard)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE alert_type AS ENUM (
    'deadline_due',
    'new_opportunity',
    'application_action',
    'draft_review',
    'system'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ----------------------------------------------------------------------------
-- 3. alerts table (migration 013 guard)
--
-- One row per actionable item, org-scoped. Idempotent regeneration is driven
-- by dedup_key (unique per organization). read/dismiss/snooze state is
-- preserved across regeneration via the upsert in GET /api/alerts.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  type             alert_type NOT NULL,
  severity         alert_severity NOT NULL DEFAULT 'info',
  message          text NOT NULL,
  link             text,
  is_read          boolean NOT NULL DEFAULT false,
  read_at          timestamptz,
  is_dismissed     boolean NOT NULL DEFAULT false,
  dismissed_at     timestamptz,
  snoozed_until    timestamptz,
  opportunity_id   uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  application_id   uuid REFERENCES applications(id) ON DELETE CASCADE,
  deadline_id      uuid REFERENCES deadlines(id) ON DELETE CASCADE,
  dedup_key        text NOT NULL,
  created_by       uuid REFERENCES profiles(id),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_org_dedup
  ON alerts (organization_id, dedup_key);
CREATE INDEX IF NOT EXISTS idx_alerts_org ON alerts (organization_id);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts (type);
CREATE INDEX IF NOT EXISTS idx_alerts_active
  ON alerts (organization_id, is_dismissed, snoozed_until);

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "alerts_org_isolation" ON alerts;
CREATE POLICY "alerts_org_isolation" ON alerts
  USING (organization_id = public.current_org_id());

-- ============================================================================
-- END Migration 025
-- ============================================================================
