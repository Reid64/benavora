-- Migration 045: AutoApply browser automation tables

-- 1. form_templates: stores reusable field mappings per funder giving portal
CREATE TABLE IF NOT EXISTS form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id uuid REFERENCES funders(id) ON DELETE SET NULL,
  portal_url text NOT NULL,
  form_structure jsonb,
  field_mapping jsonb,
  is_multi_step boolean NOT NULL DEFAULT false,
  step_navigation jsonb,
  requires_login boolean NOT NULL DEFAULT false,
  requires_file_upload boolean NOT NULL DEFAULT false,
  file_upload_fields jsonb,
  last_verified_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_templates_org_select" ON form_templates
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "form_templates_org_insert" ON form_templates
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "form_templates_org_update" ON form_templates
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "form_templates_org_delete" ON form_templates
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- 2. autoapply_submissions: logs every submission attempt
CREATE TABLE IF NOT EXISTS autoapply_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id uuid REFERENCES funders(id) ON DELETE SET NULL,
  form_template_id uuid REFERENCES form_templates(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','in_progress','submitted','failed',
    'captcha_blocked','account_required','site_error','already_submitted'
  )),
  request_description text,
  request_type text,
  request_amount numeric(12,2),
  pre_submit_screenshot_url text,
  confirmation_screenshot_url text,
  confirmation_number text,
  error_message text,
  error_screenshot_url text,
  retry_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE autoapply_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "autoapply_submissions_org_select" ON autoapply_submissions
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "autoapply_submissions_org_insert" ON autoapply_submissions
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "autoapply_submissions_org_update" ON autoapply_submissions
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "autoapply_submissions_org_delete" ON autoapply_submissions
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- 3. submission_queue: active queue for the AutoApply worker
CREATE TABLE IF NOT EXISTS submission_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id uuid REFERENCES funders(id) ON DELETE SET NULL,
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','processing','completed','failed','skipped'
  )),
  automation_mode text NOT NULL DEFAULT 'manual',
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  submission_id uuid REFERENCES autoapply_submissions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE submission_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "submission_queue_org_select" ON submission_queue
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "submission_queue_org_insert" ON submission_queue
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "submission_queue_org_update" ON submission_queue
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "submission_queue_org_delete" ON submission_queue
  FOR DELETE USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_form_templates_org ON form_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_form_templates_funder ON form_templates(funder_id);
CREATE INDEX IF NOT EXISTS idx_autoapply_submissions_org ON autoapply_submissions(organization_id);
CREATE INDEX IF NOT EXISTS idx_autoapply_submissions_status ON autoapply_submissions(status);
CREATE INDEX IF NOT EXISTS idx_autoapply_submissions_funder ON autoapply_submissions(funder_id);
CREATE INDEX IF NOT EXISTS idx_submission_queue_org ON submission_queue(organization_id);
CREATE INDEX IF NOT EXISTS idx_submission_queue_status ON submission_queue(status);
CREATE INDEX IF NOT EXISTS idx_submission_queue_priority ON submission_queue(priority, scheduled_for);
