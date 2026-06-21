-- Request profiles for multi-type submissions
CREATE TABLE IF NOT EXISTS request_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  request_type text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  needs_description text NOT NULL,
  specific_requirements jsonb DEFAULT '{}',
  target_funder_categories text[],
  target_funder_types text[],
  pitch_template text,
  form_field_overrides jsonb DEFAULT '{}',
  success_criteria text,
  min_value numeric(12,2),
  max_value numeric(12,2),
  value_unit text DEFAULT 'usd',
  geographic_requirements jsonb,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

-- Extended KB for non-monetary needs
CREATE TABLE IF NOT EXISTS kb_extended_needs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_profile_id uuid REFERENCES request_profiles(id) ON DELETE CASCADE,
  need_type text NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz DEFAULT NOW()
);

-- Pitch cache
CREATE TABLE IF NOT EXISTS pitch_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  funder_id uuid NOT NULL,
  request_profile_id uuid REFERENCES request_profiles(id) ON DELETE SET NULL,
  personalized_pitch text NOT NULL,
  pitch_hash text NOT NULL,
  created_at timestamptz DEFAULT NOW(),
  expires_at timestamptz DEFAULT NOW() + INTERVAL '30 days',
  UNIQUE(organization_id, funder_id, request_profile_id)
);

-- Organization document vault for form attachments
CREATE TABLE IF NOT EXISTS org_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  display_name text NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_size integer,
  mime_type text,
  is_current boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  uploaded_by uuid,
  created_at timestamptz DEFAULT NOW()
);

-- Submission receipts
CREATE TABLE IF NOT EXISTS submission_receipts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id uuid REFERENCES autoapply_submissions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  receipt_pdf_path text,
  receipt_data jsonb NOT NULL,
  generated_at timestamptz DEFAULT NOW()
);

-- Grant agreements (post-award tracking)
CREATE TABLE IF NOT EXISTS grant_agreements (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id uuid REFERENCES autoapply_submissions(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  funder_id uuid NOT NULL REFERENCES funders(id),
  amount_awarded numeric(12,2),
  award_type text,
  agreement_date timestamptz,
  start_date timestamptz,
  end_date timestamptz,
  terms text,
  reporting_requirements jsonb,
  payment_schedule jsonb,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz DEFAULT NOW()
);

-- Webhook notification configs
CREATE TABLE IF NOT EXISTS webhook_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  webhook_type text NOT NULL DEFAULT 'slack',
  webhook_url text NOT NULL,
  events text[] NOT NULL DEFAULT '{submission_completed,submission_failed}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT NOW()
);

-- Cross-client submission tracking (anonymized)
CREATE TABLE IF NOT EXISTS cross_client_submissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  funder_domain text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT NOW(),
  org_hash text NOT NULL
);

-- Add columns to existing tables
ALTER TABLE submission_queue ADD COLUMN IF NOT EXISTS request_profile_id uuid REFERENCES request_profiles(id);
ALTER TABLE autoapply_submissions ADD COLUMN IF NOT EXISTS request_profile_id uuid REFERENCES request_profiles(id);
ALTER TABLE autoapply_submissions ADD COLUMN IF NOT EXISTS submission_channel text DEFAULT 'web_form';
ALTER TABLE autoapply_submissions ADD COLUMN IF NOT EXISTS personalized_pitch text;
ALTER TABLE autoapply_submissions ADD COLUMN IF NOT EXISTS optimized_amount numeric(12,2);
ALTER TABLE autoapply_submissions ADD COLUMN IF NOT EXISTS timing_score numeric(3,2);
ALTER TABLE autoapply_submissions ADD COLUMN IF NOT EXISTS confirmation_data jsonb;
ALTER TABLE autoapply_submissions ADD COLUMN IF NOT EXISTS documents_attached text[];

-- Indexes
CREATE INDEX IF NOT EXISTS idx_request_profiles_org ON request_profiles(organization_id, active);
CREATE INDEX IF NOT EXISTS idx_pitch_cache_lookup ON pitch_cache(organization_id, funder_id, request_profile_id);
CREATE INDEX IF NOT EXISTS idx_org_documents_type ON org_documents(organization_id, document_type, is_current);
CREATE INDEX IF NOT EXISTS idx_cross_client_domain ON cross_client_submissions(funder_domain, submitted_at DESC);

-- NOTE: Migration 051 must be applied manually via Supabase SQL Editor.
