-- 120_autoapply_screenshots_join_rls_hardening.sql
--
-- autoapply_screenshots has no organization_id/org_id column of its own -- it is scoped only via
-- submission_id -> autoapply_submissions.organization_id. CONFIRMED LIVE IDOR while investigating:
-- src/components/autoapply/ReviewQueue.tsx ('use client', browser session-respecting Supabase
-- client) calls .from("autoapply_screenshots").select(...).eq("submission_id", item.submission_id)
-- with no organization ownership check at all -- with RLS disabled, any authenticated user of any
-- org who learned or guessed another org's submission_id could view that org's AutoApply
-- screenshots (funder portal pages, confirmation numbers visible in-frame, etc). Also written by
-- src/lib/autoapply/screenshot-manager.ts (worker, admin client -- unaffected by RLS).
--
-- Policy uses an EXISTS subquery against autoapply_submissions (which itself is being RLS-enabled
-- in migration 118) rather than a direct organization_id column, since none exists on this table.

ALTER TABLE autoapply_screenshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON autoapply_screenshots FROM anon;

CREATE POLICY autoapply_screenshots_org_select ON autoapply_screenshots FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM autoapply_submissions s
      WHERE s.id = autoapply_screenshots.submission_id
        AND s.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY autoapply_screenshots_org_insert ON autoapply_screenshots FOR INSERT TO authenticated
  WITH CHECK (
    submission_id IS NULL OR EXISTS (
      SELECT 1 FROM autoapply_submissions s
      WHERE s.id = autoapply_screenshots.submission_id
        AND s.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY autoapply_screenshots_org_update ON autoapply_screenshots FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM autoapply_submissions s
      WHERE s.id = autoapply_screenshots.submission_id
        AND s.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
  );
