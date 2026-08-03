-- 122_intelligence_proposal_sections_rls_hardening.sql
--
-- Closes an ANON_GRANT_AUDIT.md Category C finding: intelligence_proposal_sections (105 rows,
-- 048_grant_intelligence.sql) had relrowsecurity=false, fully open to anon. No organization_id
-- column, no RLS statement anywhere in its migration -- confirmed shared, cross-org AG-29
-- embedding-corpus reference data (NIH proposal sections ground every org's drafts), not per-org
-- data.
--
-- Read every real .from("intelligence_proposal_sections") call site in src/, worker/, and scripts/
-- before writing this (2026-08-03): authenticated needs both SELECT (dashboard counts, the
-- /api/intelligence/stats route, dedup checks) and INSERT -- POST /api/intelligence/ingest's
-- manual/url branches write via the session-bound server client, gated by requireRole('writer'),
-- meaning any writer-role-or-above user from any org can currently contribute rows to this shared
-- library by design (this is the existing, real, intended behavior of that route, not a bug this
-- migration introduces or should silently tighten). service_role handles all bulk NIH ingestion,
-- embedding backfill, and the AG-29 knowledge-indexer's writes, and bypasses RLS regardless. No
-- anon call site exists anywhere.

ALTER TABLE intelligence_proposal_sections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON intelligence_proposal_sections FROM anon, authenticated;
GRANT SELECT, INSERT ON intelligence_proposal_sections TO authenticated;

CREATE POLICY intelligence_proposal_sections_authenticated_read
  ON intelligence_proposal_sections
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY intelligence_proposal_sections_authenticated_insert
  ON intelligence_proposal_sections
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
