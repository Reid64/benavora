-- Migration 082: outreach_templates - reusable multi-channel outreach templates
-- (email, LinkedIn, phone script, physical mail) for cold outreach and campaigns.

CREATE TABLE IF NOT EXISTS outreach_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'linkedin', 'phone_script', 'physical_mail')),
  subject text,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE outreach_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outreach_templates_org" ON outreach_templates
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_outreach_templates_org ON outreach_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_outreach_templates_channel ON outreach_templates(organization_id, channel);
