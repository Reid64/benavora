-- Migration 050: Funder credentials, screenshot audit trail, human review queue,
-- solicitation registrations, and portal health columns.
-- NOTE: Apply manually via Supabase SQL Editor.

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

CREATE POLICY "funder_credentials_org_select" ON funder_credentials
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "funder_credentials_org_insert" ON funder_credentials
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "funder_credentials_org_update" ON funder_credentials
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "funder_credentials_org_delete" ON funder_credentials
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
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

CREATE POLICY "autoapply_screenshots_org_select" ON autoapply_screenshots
  FOR SELECT USING (
    submission_id IN (
      SELECT id FROM autoapply_submissions
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "autoapply_screenshots_org_insert" ON autoapply_screenshots
  FOR INSERT WITH CHECK (
    submission_id IN (
      SELECT id FROM autoapply_submissions
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
      )
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

CREATE POLICY "autoapply_review_queue_org_select" ON autoapply_review_queue
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "autoapply_review_queue_org_insert" ON autoapply_review_queue
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "autoapply_review_queue_org_update" ON autoapply_review_queue
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
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

CREATE POLICY "solicitation_registrations_org_select" ON solicitation_registrations
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "solicitation_registrations_org_insert" ON solicitation_registrations
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "solicitation_registrations_org_update" ON solicitation_registrations
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_solicitation_registrations_org ON solicitation_registrations(organization_id);

-- Portal health monitoring columns on funders
ALTER TABLE funders ADD COLUMN IF NOT EXISTS portal_status text DEFAULT 'unknown';
ALTER TABLE funders ADD COLUMN IF NOT EXISTS portal_last_checked_at timestamptz;
ALTER TABLE funders ADD COLUMN IF NOT EXISTS portal_response_time_ms integer;
