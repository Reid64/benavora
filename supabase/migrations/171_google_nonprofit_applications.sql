-- ============================================================================
-- BENAVORA - Migration 171: google_nonprofit_applications
--
-- Backs POST /api/google-nonprofit/apply (src/app/api/google-nonprofit/apply/
-- route.ts). GoogleNonprofitForm (src/components/GoogleNonprofitForm.tsx)
-- submits org info, eligibility, and contact fields as JSON-in-FormData plus
-- up to two required documents (registration proof, affiliation proof) and
-- any number of optional supporting documents. Documents are uploaded to the
-- existing org-path-scoped `documents` Storage bucket (migration 143) under
-- `{organizationId}/google-nonprofit-applications/{applicationId}/...`; this
-- table stores the form fields plus the resulting storage paths, not the
-- file bytes themselves.
--
-- One row per submission (append-only, matching the pil_* convention): a
-- resubmission after a rejection is a new row, not an update, so the full
-- history of what was submitted and when is preserved.
-- ============================================================================

CREATE TABLE IF NOT EXISTS google_nonprofit_applications (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  submitted_by                uuid REFERENCES profiles(id) ON DELETE SET NULL,

  -- Organization info
  legal_name                  text NOT NULL,
  dba                         text,
  registration_number         text NOT NULL,
  country                     text NOT NULL,
  mission                     text NOT NULL,
  website                     text,
  phone                       text,
  org_email                   text NOT NULL,
  address_line1               text,
  city                        text,
  state                       text,
  postal_code                 text,

  -- Eligibility
  org_type                    text NOT NULL,
  is_government_entity        boolean NOT NULL DEFAULT false,
  is_hospital                 boolean NOT NULL DEFAULT false,
  is_school                   boolean NOT NULL DEFAULT false,
  agrees_to_terms             boolean NOT NULL DEFAULT false,

  -- Contact
  contact_full_name           text NOT NULL,
  contact_role                text NOT NULL,
  contact_email                text NOT NULL,
  contact_phone               text,

  -- Documents (paths into the `documents` Storage bucket)
  registration_document_path  text NOT NULL,
  affiliation_document_path   text NOT NULL,
  additional_document_paths   text[] NOT NULL DEFAULT '{}',

  status                      text NOT NULL DEFAULT 'submitted' CHECK (status IN (
                                'submitted', 'under_review', 'approved', 'rejected'
                              )),
  confirmation_email_sent     boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_nonprofit_applications_org
  ON google_nonprofit_applications(organization_id, created_at DESC);

ALTER TABLE google_nonprofit_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON google_nonprofit_applications FROM anon;

CREATE POLICY google_nonprofit_applications_org_select ON google_nonprofit_applications
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY google_nonprofit_applications_org_insert ON google_nonprofit_applications
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ============================================================================
-- END Migration 171
-- ============================================================================
