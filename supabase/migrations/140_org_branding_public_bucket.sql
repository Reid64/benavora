-- ============================================================================
-- BENAVORA - Migration 140: public org-branding storage bucket
--
-- Real bug found 2026-08-18 (PRODUCTION_READINESS_TESTING_PLAN.md item 4):
-- Settings > Branding's "Organization Logo" upload writes to the per-org
-- `org-{organizationId}` bucket via getPublicUrl() and saves that URL to
-- platform_config.branding.logo_url. That bucket is NOT public (it's the
-- same bucket application/compliance documents use, correctly private), so
-- the resulting "public" URL 400s for anyone who tries to load it -
-- including the app's own sidebar logo once it's wired to read this value.
-- Uploads themselves succeed (confirmed via a real live upload — the file
-- lands in storage with a real eTag/size), the bucket-choice was just wrong.
--
-- This bucket is genuinely public, shared across orgs (objects namespaced
-- by organization id in the object path, e.g.
-- `{organizationId}/logo-<timestamp>.<ext>`), for branding assets meant to
-- be publicly viewable by design (displayed in the app header, the login
-- page, and outgoing emails - all contexts with no auth boundary to enforce
-- against). Same real pattern as migration 044's nofa-pdfs bucket. Applied
-- to prod via the Management API. Idempotent.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('org-branding', 'org-branding', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "org_branding_authenticated_insert" ON storage.objects;
CREATE POLICY "org_branding_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'org-branding');

DROP POLICY IF EXISTS "org_branding_authenticated_update" ON storage.objects;
CREATE POLICY "org_branding_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'org-branding');

DROP POLICY IF EXISTS "org_branding_public_read" ON storage.objects;
CREATE POLICY "org_branding_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'org-branding');

-- ============================================================================
-- END Migration 140
-- ============================================================================
