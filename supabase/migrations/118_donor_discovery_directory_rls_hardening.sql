-- 118_donor_discovery_directory_rls_hardening.sql
--
-- Closes an ANON_GRANT_AUDIT.md Category C finding: donor_discovery_directory (133,780 rows,
-- 067_donor_discovery_foundation.sql) had relrowsecurity=false, fully open to anon. The table's own
-- migration header already documents the design intent: "SHARED, no organization_id: the
-- compounding-moat directory populated by enumeration/enrichment across all tenants. No RLS -- same
-- posture as foundation_directory (migration 046)." -- confirmed live: no organization_id column,
-- no tenant column of any kind.
--
-- Read every real .from("donor_discovery_directory") call site in src/, worker/, and scripts/
-- before writing this (2026-08-03), ~17 call sites total: reads happen from (a) service_role
-- workers/adapters/scripts doing enumeration/enrichment/scoring (the overwhelming majority), and
-- (b) exactly one authenticated-role API route (GET /api/donor-discovery/prospects) doing plain
-- id/naics/civic_kind lookups to translate a taxonomy filter into directory ids for a user-facing
-- list. The dominant write path is a service_role-only RPC
-- (donor_discovery_upsert_directory_record), not a raw .insert/.update from any client-facing code.
-- No literal anon-key browser call site exists anywhere -- every UI page hitting this data sits
-- behind src/middleware.ts's auth gate.

ALTER TABLE donor_discovery_directory ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON donor_discovery_directory FROM anon, authenticated;
GRANT SELECT ON donor_discovery_directory TO authenticated;

CREATE POLICY donor_discovery_directory_authenticated_read
  ON donor_discovery_directory
  FOR SELECT
  TO authenticated
  USING (true);
