-- ============================================================================
-- BENAVORA - Migration 044: public nofa-pdfs storage bucket
--
-- The NOFA Parser mirrors federal grant PDFs (public documents) from grants.gov
-- into this PUBLIC bucket so the opportunity detail page can show them inline in
-- an iframe via a persistent public URL. Authenticated users may upload; anyone
-- may read (public bucket). Applied to prod via the Management API. Idempotent.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('nofa-pdfs', 'nofa-pdfs', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "nofa_pdfs_authenticated_insert" ON storage.objects;
CREATE POLICY "nofa_pdfs_authenticated_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'nofa-pdfs');

DROP POLICY IF EXISTS "nofa_pdfs_authenticated_update" ON storage.objects;
CREATE POLICY "nofa_pdfs_authenticated_update" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'nofa-pdfs');

DROP POLICY IF EXISTS "nofa_pdfs_public_read" ON storage.objects;
CREATE POLICY "nofa_pdfs_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'nofa-pdfs');

-- ============================================================================
-- END Migration 044
-- ============================================================================
