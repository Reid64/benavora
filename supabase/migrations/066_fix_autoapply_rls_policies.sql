-- 066_fix_autoapply_rls_policies.sql — fix migration 045's RLS policies
--
-- Migration 045 (form_templates, autoapply_submissions, submission_queue) wrote
-- every policy against an `organization_members` table. That table does not
-- exist in this schema — the live auth model derives org membership from
-- `profiles.organization_id` (see migration 020's automation_steps/
-- automation_screenshots policies, and src/lib/auth/role-gate.ts). Confirmed
-- live: `select 1 from organization_members` errors with
-- "relation \"public.organization_members\" does not exist".
--
-- This is not just theoretical cleanup — these 3 tables are read/written via
-- the session-scoped (RLS-enforced) Supabase client, not the admin/service-role
-- client, in real user-facing routes: GET/POST /api/autoapply/queue
-- (submission_queue), POST /api/autoapply/templates/test (form_templates), and
-- GET /api/autoapply/profiles (autoapply_submissions). Every one of those reads
-- has been failing for real users because of the invalid table reference in
-- their RLS policies.
--
-- Replaces all 12 policies (4 actions × 3 tables) with the correct pattern.

-- ── form_templates ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "form_templates_org_select" ON form_templates;
DROP POLICY IF EXISTS "form_templates_org_insert" ON form_templates;
DROP POLICY IF EXISTS "form_templates_org_update" ON form_templates;
DROP POLICY IF EXISTS "form_templates_org_delete" ON form_templates;

CREATE POLICY "form_templates_org_select" ON form_templates
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "form_templates_org_insert" ON form_templates
  FOR INSERT WITH CHECK (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "form_templates_org_update" ON form_templates
  FOR UPDATE USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "form_templates_org_delete" ON form_templates
  FOR DELETE USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

-- ── autoapply_submissions ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "autoapply_submissions_org_select" ON autoapply_submissions;
DROP POLICY IF EXISTS "autoapply_submissions_org_insert" ON autoapply_submissions;
DROP POLICY IF EXISTS "autoapply_submissions_org_update" ON autoapply_submissions;
DROP POLICY IF EXISTS "autoapply_submissions_org_delete" ON autoapply_submissions;

CREATE POLICY "autoapply_submissions_org_select" ON autoapply_submissions
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "autoapply_submissions_org_insert" ON autoapply_submissions
  FOR INSERT WITH CHECK (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "autoapply_submissions_org_update" ON autoapply_submissions
  FOR UPDATE USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "autoapply_submissions_org_delete" ON autoapply_submissions
  FOR DELETE USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

-- ── submission_queue ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "submission_queue_org_select" ON submission_queue;
DROP POLICY IF EXISTS "submission_queue_org_insert" ON submission_queue;
DROP POLICY IF EXISTS "submission_queue_org_update" ON submission_queue;
DROP POLICY IF EXISTS "submission_queue_org_delete" ON submission_queue;

CREATE POLICY "submission_queue_org_select" ON submission_queue
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "submission_queue_org_insert" ON submission_queue
  FOR INSERT WITH CHECK (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "submission_queue_org_update" ON submission_queue
  FOR UPDATE USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "submission_queue_org_delete" ON submission_queue
  FOR DELETE USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );
