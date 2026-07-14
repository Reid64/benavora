-- Migration 083: followup_sequences + followup_enrollments - multi-step
-- post-submission follow-up sequences (check-in, thank-you, renewal, etc.)
-- and per-application enrollment/progress tracking.

CREATE TABLE IF NOT EXISTS followup_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_stage text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE followup_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "followup_sequences_org" ON followup_sequences
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_followup_sequences_org ON followup_sequences(organization_id);

CREATE TABLE IF NOT EXISTS followup_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL REFERENCES followup_sequences(id) ON DELETE CASCADE,
  enrolled_at timestamptz DEFAULT now(),
  current_step int DEFAULT 0,
  status text DEFAULT 'active'
);

ALTER TABLE followup_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "followup_enrollments_org" ON followup_enrollments
  USING (
    application_id IN (
      SELECT id FROM applications
      WHERE organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  );

CREATE INDEX IF NOT EXISTS idx_followup_enrollments_application ON followup_enrollments(application_id);
CREATE INDEX IF NOT EXISTS idx_followup_enrollments_sequence ON followup_enrollments(sequence_id);
CREATE INDEX IF NOT EXISTS idx_followup_enrollments_status ON followup_enrollments(status);
