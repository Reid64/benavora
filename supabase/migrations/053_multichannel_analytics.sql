CREATE TABLE IF NOT EXISTS autoapply_follow_ups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id uuid REFERENCES autoapply_submissions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  funder_id uuid NOT NULL,
  sequence_number integer NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  template_type text NOT NULL,
  content text,
  response_received boolean DEFAULT false,
  created_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_recordings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id uuid REFERENCES autoapply_submissions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  funder_id uuid NOT NULL,
  storage_path text NOT NULL,
  duration_seconds integer,
  file_size_bytes integer,
  recorded_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ab_test_variants (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  funder_category text NOT NULL,
  variant_name text NOT NULL,
  pitch_style text NOT NULL,
  emphasis text,
  submission_count integer DEFAULT 0,
  success_count integer DEFAULT 0,
  is_winner boolean DEFAULT false,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT NOW()
);

ALTER TABLE autoapply_submissions ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES ab_test_variants(id);
ALTER TABLE autoapply_submissions ADD COLUMN IF NOT EXISTS response_received_at timestamptz;
ALTER TABLE autoapply_submissions ADD COLUMN IF NOT EXISTS follow_up_status text DEFAULT 'none';

CREATE INDEX IF NOT EXISTS idx_follow_ups_scheduled ON autoapply_follow_ups(scheduled_at, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_session_recordings_org ON session_recordings(organization_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_ab_variants_category ON ab_test_variants(organization_id, funder_category, active);
