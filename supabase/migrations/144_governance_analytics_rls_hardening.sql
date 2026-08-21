-- ============================================================================
-- BENAVORA - Migration 144: RLS hardening for 4 org-scoped tables that had
-- none at all (WGR migration-drift remediation, 2026-08-21)
--
-- Real, live cross-org data leak found by src/__tests__/integration/rls.test.ts
-- immediately after applying migrations 052_governance_layer.sql and
-- 053_multichannel_analytics.sql to production (both files, as originally
-- written, create org-scoped tables -- organization_id present -- but never
-- enable RLS or create a policy on any of them; this repo's default schema
-- ACLs grant anon+authenticated full CRUD on every new table by design, see
-- STANDING_DIRECTIVES.md's "public schema default ACL" finding, so an
-- RLS-less org-scoped table is readable/writable cross-org by any
-- authenticated user from the moment it exists). Confirmed live: a real
-- cross-org SELECT sweep found rows leaking on all 4 tables below.
--
-- Not folded into 052/053 themselves -- those files are already applied
-- (recorded in supabase_migrations.schema_migrations) and this project's
-- convention (migrations 112-123, "*_rls_hardening.sql") is a dedicated
-- follow-up file for RLS gaps found after the fact, not silently editing an
-- already-applied migration's history.
--
-- queue_controls and tier_limits (also created by 052_governance_layer.sql)
-- are deliberately NOT included here -- neither has an organization_id
-- column; both are genuinely global/shared config (queue_controls is a
-- platform-wide pause/control-plane table, tier_limits is the one row per
-- subscription tier), matching this schema's existing shared-table
-- convention (agent_registry, worker_status, tier_limits' own siblings).
-- ============================================================================

ALTER TABLE funder_relationships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "funder_relationships_org" ON funder_relationships;
CREATE POLICY "funder_relationships_org" ON funder_relationships
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

ALTER TABLE submission_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "submission_usage_org" ON submission_usage;
CREATE POLICY "submission_usage_org" ON submission_usage
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

ALTER TABLE session_recordings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "session_recordings_org" ON session_recordings;
CREATE POLICY "session_recordings_org" ON session_recordings
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

ALTER TABLE ab_test_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ab_test_variants_org" ON ab_test_variants;
CREATE POLICY "ab_test_variants_org" ON ab_test_variants
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ============================================================================
-- END Migration 144
-- ============================================================================
