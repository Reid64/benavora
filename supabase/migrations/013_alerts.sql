-- ============================================================================
-- BENAVORA — Migration 013: Alerts / Daily Action List
-- Apply AFTER 012_opportunity_match_percentage.sql
--
-- Backs the Alerts page (a daily action list) and the red notification badges
-- on the sidebar nav. Alerts are generated from live data — deadlines due within
-- 7 days, opportunities discovered since the user's last login, applications in
-- action-needed pipeline stages, and drafts awaiting review — and persisted here
-- so each one can be dismissed or snoozed and that state survives regeneration.
--
-- Regeneration is idempotent: each candidate alert carries a stable `dedup_key`
-- (unique per organization). The sync upserts current candidates without
-- touching is_read / is_dismissed / snoozed_until, and prunes generated alerts
-- whose underlying item is no longer actionable. The `link` column points each
-- alert at the record it concerns so the UI can navigate straight to it.
--
-- Additive and safe: two new enums + one new table with org-isolation RLS
-- (master pattern, Migration 001). Written idempotently so a re-run via
-- apply-migration.mjs is harmless. No governance document or existing RLS
-- policy is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums — guarded so a re-run does not error on the existing type.
-- ----------------------------------------------------------------------------

-- The category of an alert. Each maps to one sidebar badge / nav destination.
DO $$ BEGIN
  CREATE TYPE alert_type AS ENUM (
    'deadline_due',         -- a deadline falls within the next 7 days (or is overdue)
    'new_opportunity',      -- an opportunity discovered since the user's last login
    'application_action',   -- an application sits in an action-needed pipeline stage
    'draft_review',         -- a generated draft is ready for human review
    'system'                -- manually created / future system notices
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Visual urgency. 'critical' renders red, 'warning' amber, 'info' neutral.
DO $$ BEGIN
  CREATE TYPE alert_severity AS ENUM ('info', 'warning', 'critical');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ----------------------------------------------------------------------------
-- alerts — one row per actionable item, org-scoped.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  type             alert_type NOT NULL,
  severity         alert_severity NOT NULL DEFAULT 'info',
  message          text NOT NULL,
  -- Where clicking the alert takes the user (e.g. /opportunities/<id>). Nullable
  -- so a purely informational alert can omit a destination.
  link             text,
  -- Read / dismiss / snooze state. Preserved across regeneration.
  is_read          boolean NOT NULL DEFAULT false,
  read_at          timestamptz,
  is_dismissed     boolean NOT NULL DEFAULT false,
  dismissed_at     timestamptz,
  -- When set and in the future, the alert is hidden from the active list and
  -- the badge counts until this moment passes.
  snoozed_until    timestamptz,
  -- Optional provenance links to the record this alert concerns (for cascade
  -- cleanup and richer UI). Exactly which is set depends on `type`.
  opportunity_id   uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  application_id   uuid REFERENCES applications(id) ON DELETE CASCADE,
  deadline_id      uuid REFERENCES deadlines(id) ON DELETE CASCADE,
  -- Stable identity for idempotent regeneration (e.g. "deadline:<uuid>").
  -- Unique per organization so an upsert preserves user state.
  dedup_key        text NOT NULL,
  created_by       uuid REFERENCES profiles(id),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_org_dedup
  ON alerts (organization_id, dedup_key);
CREATE INDEX IF NOT EXISTS idx_alerts_org ON alerts (organization_id);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts (type);
-- Drives the active-list query and the badge counts (org + not dismissed,
-- ordered/filtered by snooze).
CREATE INDEX IF NOT EXISTS idx_alerts_active
  ON alerts (organization_id, is_dismissed, snoozed_until);

-- ----------------------------------------------------------------------------
-- RLS — organization isolation (master pattern, Migration 001). USING also
-- governs INSERT/UPDATE, so a row can only ever be written with the caller's
-- own organization_id.
-- ----------------------------------------------------------------------------
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "alerts_org_isolation" ON alerts;
CREATE POLICY "alerts_org_isolation" ON alerts
  USING (organization_id = public.current_org_id());

-- ============================================================================
-- END Migration 013
-- ============================================================================
