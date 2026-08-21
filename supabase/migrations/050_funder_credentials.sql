-- Migration 050: Funder credentials, screenshot audit trail, human review queue,
-- solicitation registrations, and portal health columns.
-- NOTE: Apply manually via Supabase SQL Editor.
--
-- Fixed 2026-08-21 (migration-drift remediation): every policy below
-- originally scoped org membership via `organization_members`, a table that
-- does not exist anywhere in this schema -- this file could never have
-- succeeded past its first CREATE POLICY as originally written. The tables
-- it creates DO exist live today (a prior partial run got that far before
-- failing), and their real, live, currently-working policies use this
-- schema's actual and only org-membership pattern: `profiles.organization_id`
-- keyed by `profiles.id = auth.uid()` (confirmed live via `pg_policies`,
-- identical policy names, `profiles`-based logic). Rewritten to match —
-- same intended access control, the real mechanism instead of a
-- never-existed one — plus DROP POLICY IF EXISTS guards throughout so this
-- file is safe to re-run against both a fresh database and this already-
-- partially-applied production state.

-- Funder portal credentials (encrypted at the application layer)
CREATE TABLE IF NOT EXISTS funder_credentials (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id uuid NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  portal_url text NOT NULL,
  username text NOT NULL,
  encrypted_password text NOT NULL,
  mfa_secret text,
  login_method text NOT NULL DEFAULT 'form',
  last_login_at timestamptz,
  login_success boolean,
  notes text,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE(organization_id, funder_id)
);

ALTER TABLE funder_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "funder_credentials_org_select" ON funder_credentials;
CREATE POLICY "funder_credentials_org_select" ON funder_credentials
  FOR SELECT TO authenticated USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "funder_credentials_org_insert" ON funder_credentials;
CREATE POLICY "funder_credentials_org_insert" ON funder_credentials
  FOR INSERT TO authenticated WITH CHECK (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "funder_credentials_org_update" ON funder_credentials;
CREATE POLICY "funder_credentials_org_update" ON funder_credentials
  FOR UPDATE TO authenticated USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "funder_credentials_org_delete" ON funder_credentials;
CREATE POLICY "funder_credentials_org_delete" ON funder_credentials
  FOR DELETE TO authenticated USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_funder_credentials_org ON funder_credentials(organization_id);
CREATE INDEX IF NOT EXISTS idx_funder_credentials_funder ON funder_credentials(funder_id);

-- Screenshot audit trail per submission
CREATE TABLE IF NOT EXISTS autoapply_screenshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id uuid REFERENCES autoapply_submissions(id) ON DELETE CASCADE,
  stage text NOT NULL,
  storage_path text NOT NULL,
  captured_at timestamptz DEFAULT NOW(),
  metadata jsonb DEFAULT '{}'
);

ALTER TABLE autoapply_screenshots ENABLE ROW LEVEL SECURITY;

-- Matches the real live policies exactly (confirmed via pg_policies): INSERT
-- must allow submission_id IS NULL -- screenshot-manager.ts captures and
-- uploads screenshots before the autoapply_submissions row exists yet (see
-- its own CaptureAndUploadParams doc comment), so a strict submission_id IN
-- (...) check (no NULL allowance) would reject every one of those inserts.
DROP POLICY IF EXISTS "autoapply_screenshots_org_select" ON autoapply_screenshots;
CREATE POLICY "autoapply_screenshots_org_select" ON autoapply_screenshots
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM autoapply_submissions s
      WHERE s.id = autoapply_screenshots.submission_id
        AND s.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "autoapply_screenshots_org_insert" ON autoapply_screenshots;
CREATE POLICY "autoapply_screenshots_org_insert" ON autoapply_screenshots
  FOR INSERT TO authenticated WITH CHECK (
    submission_id IS NULL
    OR EXISTS (
      SELECT 1 FROM autoapply_submissions s
      WHERE s.id = autoapply_screenshots.submission_id
        AND s.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS idx_autoapply_screenshots_submission ON autoapply_screenshots(submission_id);

-- Human review queue for failed/blocked submissions
CREATE TABLE IF NOT EXISTS autoapply_review_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id uuid REFERENCES autoapply_submissions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  funder_id uuid NOT NULL,
  reason text NOT NULL,
  failure_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  assigned_to uuid,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz DEFAULT NOW()
);

ALTER TABLE autoapply_review_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "autoapply_review_queue_org_select" ON autoapply_review_queue;
CREATE POLICY "autoapply_review_queue_org_select" ON autoapply_review_queue
  FOR SELECT TO authenticated USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "autoapply_review_queue_org_insert" ON autoapply_review_queue;
CREATE POLICY "autoapply_review_queue_org_insert" ON autoapply_review_queue
  FOR INSERT TO authenticated WITH CHECK (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "autoapply_review_queue_org_update" ON autoapply_review_queue;
CREATE POLICY "autoapply_review_queue_org_update" ON autoapply_review_queue
  FOR UPDATE TO authenticated USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_autoapply_review_queue_org ON autoapply_review_queue(organization_id);
CREATE INDEX IF NOT EXISTS idx_autoapply_review_queue_status ON autoapply_review_queue(status);

-- Charitable solicitation registrations by state
CREATE TABLE IF NOT EXISTS solicitation_registrations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  state text NOT NULL,
  registration_number text,
  registered_at timestamptz,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT NOW(),
  UNIQUE(organization_id, state)
);

ALTER TABLE solicitation_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "solicitation_registrations_org_select" ON solicitation_registrations;
CREATE POLICY "solicitation_registrations_org_select" ON solicitation_registrations
  FOR SELECT TO authenticated USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "solicitation_registrations_org_insert" ON solicitation_registrations;
CREATE POLICY "solicitation_registrations_org_insert" ON solicitation_registrations
  FOR INSERT TO authenticated WITH CHECK (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "solicitation_registrations_org_update" ON solicitation_registrations;
CREATE POLICY "solicitation_registrations_org_update" ON solicitation_registrations
  FOR UPDATE TO authenticated USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_solicitation_registrations_org ON solicitation_registrations(organization_id);

-- Portal health monitoring columns on funders
ALTER TABLE funders ADD COLUMN IF NOT EXISTS portal_status text DEFAULT 'unknown';
ALTER TABLE funders ADD COLUMN IF NOT EXISTS portal_last_checked_at timestamptz;
ALTER TABLE funders ADD COLUMN IF NOT EXISTS portal_response_time_ms integer;
