-- Migration 090: compliance_events - compliance calendar (reports, audits,
-- renewals, meetings), separate from compliance_requirements (085). Column
-- named organization_id (not org_id) and numbered 090 (not 087, already
-- 087_notification_preferences.sql) to match this repo's established
-- convention and avoid colliding with an already-applied migration number.

CREATE TABLE IF NOT EXISTS compliance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('report', 'audit', 'renewal', 'meeting')),
  title text NOT NULL,
  due_date date NOT NULL,
  recurrence text,
  completed_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE compliance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compliance_events_org" ON compliance_events
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_compliance_events_org_due ON compliance_events(organization_id, due_date);
CREATE INDEX IF NOT EXISTS idx_compliance_events_application ON compliance_events(application_id);
