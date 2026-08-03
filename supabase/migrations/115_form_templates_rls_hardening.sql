-- 115_form_templates_rls_hardening.sql
--
-- Closes an ANON_GRANT_AUDIT.md Category C finding: form_templates (org-scoped AutoApply
-- funder-portal login/field-mapping data, organization_id NOT NULL FK'd to organizations) had
-- relrowsecurity = false live, despite 045_autoapply_tables.sql / 066_fix_autoapply_rls_policies.sql
-- already having created 4 real, correctly-shaped org-scoped policies
-- (form_templates_org_select/insert/update/delete, all using
-- organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())) -- confirmed live
-- via pg_policies. The policies exist and are correct; RLS itself was simply never turned on, so
-- they have been silently inert this whole time -- same "some of a migration's DDL landed, some
-- didn't" drift pattern documented elsewhere in this project's history (agent_decisions,
-- corporate_prospects, foundation_directory).
--
-- This is a materially more urgent fix than the read-only reference-data tables fixed alongside it:
-- reading src/app/(dashboard)/autoapply/templates/page.tsx and ReviewQueue.tsx (2026-08-03 research)
-- found two real call sites with ZERO application-level tenant filter (an UPDATE by bare `id` at
-- templates/page.tsx:439, and a SELECT by bare `id` in ReviewQueue.tsx:151) that rely entirely on
-- RLS for tenant isolation -- with RLS off, any authenticated user on any org could read or
-- overwrite any other org's funder-portal credentials/field-mappings by id. Enabling RLS closes
-- this as a side effect, not just the anon-exposure gap.
--
-- No new policies needed -- just turn on enforcement of the ones already correctly defined, plus
-- the same anon REVOKE this session has applied everywhere else (RLS-enabled-with-org-scoped-
-- policies would already default-deny anon for SELECT/INSERT/UPDATE/DELETE since auth.uid() is
-- NULL for an unauthenticated connection, but TRUNCATE is never governed by policy, so it needs an
-- explicit revoke regardless).

ALTER TABLE form_templates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON form_templates FROM anon;
