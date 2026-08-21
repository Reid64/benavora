-- ============================================================================
-- BENAVORA - Migration 143: path-scoped RLS policies for the 4 shared,
-- org-path-prefixed Storage buckets (documents, autoapply-screenshots,
-- org-documents, session-recordings)
--
-- Real bug found by src/__tests__/integration/storage-rls.test.ts (WGR-157):
-- these 4 buckets had storage.objects RLS enabled (the schema-wide default)
-- but ZERO matching policies -- so every operation, including a legitimate
-- org uploading its own file under its own {organizationId}/... prefix, was
-- silently denied ("new row violates row-level security policy"). Not a
-- leak (the opposite failure mode: total lockout), but a real, live defect
-- -- these are exactly the buckets application code actually uploads to
-- (src/lib/autoapply/screenshot-manager.ts, src/lib/autoapply/document-vault.ts,
-- src/app/api/documents/assemble/route.ts, worker/queue-processor.ts), all
-- of which write to `{organizationId}/...`-prefixed paths already.
--
-- Same path-scoping convention already live on the org-per-bucket policies
-- (org_bucket_insert/select/update/delete, migration untracked -- applied
-- out-of-band, confirmed live via psql), just applied at the path level
-- (storage.foldername(name)[1]) instead of the bucket-name level, since
-- these 4 buckets are SHARED across all orgs, not one-bucket-per-org.
-- Applied directly to prod via psql/DATABASE_URL per DIRECTIVE-017; this
-- migration file records that live change. Idempotent.
-- ============================================================================

DO $$
DECLARE
  b text;
BEGIN
  FOREACH b IN ARRAY ARRAY['documents', 'autoapply-screenshots', 'org-documents', 'session-recordings']
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      replace(b, '-', '_') || '_org_scoped_insert'
    );
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects
         FOR INSERT TO authenticated
         WITH CHECK (
           bucket_id = %L
           AND (storage.foldername(name))[1] = (SELECT organization_id::text FROM profiles WHERE id = auth.uid())
         )',
      replace(b, '-', '_') || '_org_scoped_insert', b
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      replace(b, '-', '_') || '_org_scoped_select'
    );
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects
         FOR SELECT TO authenticated
         USING (
           bucket_id = %L
           AND (storage.foldername(name))[1] = (SELECT organization_id::text FROM profiles WHERE id = auth.uid())
         )',
      replace(b, '-', '_') || '_org_scoped_select', b
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      replace(b, '-', '_') || '_org_scoped_update'
    );
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects
         FOR UPDATE TO authenticated
         USING (
           bucket_id = %L
           AND (storage.foldername(name))[1] = (SELECT organization_id::text FROM profiles WHERE id = auth.uid())
         )',
      replace(b, '-', '_') || '_org_scoped_update', b
    );

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      replace(b, '-', '_') || '_org_scoped_delete'
    );
    EXECUTE format(
      'CREATE POLICY %I ON storage.objects
         FOR DELETE TO authenticated
         USING (
           bucket_id = %L
           AND (storage.foldername(name))[1] = (SELECT organization_id::text FROM profiles WHERE id = auth.uid())
         )',
      replace(b, '-', '_') || '_org_scoped_delete', b
    );
  END LOOP;
END $$;

-- ============================================================================
-- END Migration 143
-- ============================================================================
