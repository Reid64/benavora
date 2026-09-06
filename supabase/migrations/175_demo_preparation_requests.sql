-- ============================================================================
-- BENAVORA - Migration 175: demo_preparation_requests + demo-proposal-uploads
-- storage bucket
--
-- Backs POST /api/public/demo/prepare (src/app/api/public/demo/prepare/
-- route.ts), the optional post-booking step of the /demo flow
-- (src/app/(marketing)/demo/DemoClient.tsx). Per the outline (BENAVORA
-- MARKETING PAGE.docx section 6): "After booking, let the prospect
-- optionally upload an old proposal or select a real opportunity for the
-- demonstration."
--
-- One row per demo_requests row that actually uses this optional step - NOT
-- every /demo visitor gets one, since the step is opt-in and skippable.
-- Same split pattern as scan_submissions -> scan_report_requests (migrations
-- 172 -> 173): the mandatory intake and the optional follow-up action are
-- separate tables so a skipped follow-up leaves no row at all.
--
-- "select a real opportunity" is deliberately NOT a live query against this
-- org's or any org's `opportunities` table: that table is strictly
-- org-isolated (migration 001's opportunities_org_isolation policy), and
-- src/lib/scan/scoring-engine.ts's own file-level comment documents the
-- established invariant that an anonymous, org-less visitor must never be
-- shown another org's discovered-opportunity id/name/description/funder_id.
-- A /demo visitor has no organization_id yet (same as a /scan visitor), so
-- opportunity_reference is free text the visitor supplies themselves (a
-- name or URL of a real opportunity they already know about) for the human
-- strategist to prepare against - not a browsable list sourced from the
-- live table.
--
-- Public-schema default ACLs auto-grant anon+authenticated full CRUD on any
-- new table (see governance memory benavora-public-schema-default-acl-anon-
-- exposure), so anon's write access below is made EXPLICIT, matching
-- migrations 172/173/174's pattern: anon can INSERT and nothing else.
-- ============================================================================

CREATE TABLE IF NOT EXISTS demo_preparation_requests (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  demo_request_id             uuid NOT NULL REFERENCES demo_requests(id) ON DELETE CASCADE,

  action                      text NOT NULL CHECK (action IN ('proposal_upload', 'opportunity_reference')),
  proposal_storage_path       text,
  proposal_original_filename  text,
  opportunity_reference       text,

  ip_hash                     text,
  user_agent                  text,

  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demo_preparation_requests_demo_request
  ON demo_preparation_requests(demo_request_id);

ALTER TABLE demo_preparation_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON demo_preparation_requests FROM anon;
REVOKE ALL ON demo_preparation_requests FROM authenticated;

GRANT INSERT ON demo_preparation_requests TO anon;

CREATE POLICY demo_preparation_requests_anon_insert ON demo_preparation_requests
  FOR INSERT TO anon
  WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- demo-proposal-uploads storage bucket
--
-- PRIVATE (public = false) - unlike migration 044's nofa-pdfs or 140's
-- org-branding (both genuinely public-read documents), an uploaded old
-- proposal is a prospect's unpublished draft and must not be readable by
-- anyone holding the object path. anon may only INSERT; there is
-- deliberately no anon or authenticated SELECT/UPDATE/DELETE policy, so
-- these files are write-only from the public side, same posture as the
-- demo_requests/demo_preparation_requests tables above. Only a service-role
-- client (future sales-ops tooling) can read them back.
--
-- File-size and mime-type limits are enforced in the API route
-- (src/app/api/public/demo/prepare/route.ts) rather than via
-- storage.buckets.file_size_limit/allowed_mime_types columns, matching this
-- repo's existing bucket migrations (044, 140), none of which set those
-- columns either.
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('demo-proposal-uploads', 'demo-proposal-uploads', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "demo_proposal_uploads_anon_insert" ON storage.objects;
CREATE POLICY "demo_proposal_uploads_anon_insert" ON storage.objects
  FOR INSERT TO anon WITH CHECK (bucket_id = 'demo-proposal-uploads');

-- ============================================================================
-- END Migration 175
-- ============================================================================
