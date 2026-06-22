-- Migration 057: Draft Automation Pipeline
-- Creates draft_queue and draft_automation_config tables for autonomous draft generation

CREATE TYPE draft_queue_status AS ENUM ('pending', 'generating', 'generated', 'review', 'approved', 'rejected', 'submitted', 'failed');
CREATE TYPE draft_trigger AS ENUM ('auto_scheduled', 'eligibility_threshold', 'deadline_approaching', 'manual');

-- The draft queue: opportunities waiting for or having received auto-generated drafts
CREATE TABLE IF NOT EXISTS draft_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id),
  status draft_queue_status DEFAULT 'pending',
  trigger_reason draft_trigger NOT NULL DEFAULT 'auto_scheduled',
  template_type text NOT NULL DEFAULT 'grant_narrative',
  priority integer DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),
  draft_id uuid,
  confidence_score integer,
  gap_count integer DEFAULT 0,
  word_count integer DEFAULT 0,
  auto_generated_at timestamptz,
  reviewed_by uuid REFERENCES profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  approved_at timestamptz,
  rejected_reason text,
  submitted_to_autoapply_at timestamptz,
  deadline_date timestamptz,
  scheduled_for date,
  error_message text,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 2,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE(organization_id, opportunity_id, template_type)
);

ALTER TABLE draft_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "draft_queue_org" ON draft_queue USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE INDEX idx_draft_queue_org ON draft_queue(organization_id);
CREATE INDEX idx_draft_queue_status ON draft_queue(status);
CREATE INDEX idx_draft_queue_scheduled ON draft_queue(scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_draft_queue_priority ON draft_queue(priority ASC, deadline_date ASC);

-- Draft automation settings per org
CREATE TABLE IF NOT EXISTS draft_automation_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  is_enabled boolean DEFAULT false,
  min_eligibility_score integer DEFAULT 70,
  auto_generate_on_discovery boolean DEFAULT true,
  auto_generate_on_deadline_days integer DEFAULT 14,
  daily_draft_limit integer DEFAULT 5,
  preferred_template_rules jsonb DEFAULT '{}',
  excluded_categories text[] DEFAULT '{}',
  excluded_funder_ids uuid[] DEFAULT '{}',
  require_approval_before_submit boolean DEFAULT true,
  auto_submit_above_confidence integer,
  notification_on_generation boolean DEFAULT true,
  notification_on_deadline boolean DEFAULT true,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

ALTER TABLE draft_automation_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "draft_auto_config_org" ON draft_automation_config USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
