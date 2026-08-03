-- 120_donor_discovery_taxonomy_rls_hardening.sql
--
-- Closes an ANON_GRANT_AUDIT.md Category C finding: donor_discovery_taxonomy (1,345 rows,
-- 067_donor_discovery_foundation.sql) had relrowsecurity=false, fully open to anon. The table's own
-- migration header documents the design intent: "SHARED, no organization_id: seeded once (NAICS
-- codes + civic entity types), subscribers reference nodes but never edit them. No RLS -- same
-- posture as foundation_directory." -- confirmed live: no tenant column.
--
-- Read every real .from("donor_discovery_taxonomy") call site in src/, worker/, and scripts/
-- before writing this (2026-08-03): read-only from every subscriber's perspective -- exercised
-- heavily by both browser-side pages (/donor-discovery, /donor-discovery/prospects, ProspectDetail)
-- and two API routes (prospects/route.ts, taxonomy/search/route.ts), all behind
-- requireRole/middleware -> always authenticated in practice. No UI/API path ever inserts/updates
-- it -- only seed scripts do (service_role). No anon call site exists anywhere.

ALTER TABLE donor_discovery_taxonomy ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON donor_discovery_taxonomy FROM anon, authenticated;
GRANT SELECT ON donor_discovery_taxonomy TO authenticated;

CREATE POLICY donor_discovery_taxonomy_authenticated_read
  ON donor_discovery_taxonomy
  FOR SELECT
  TO authenticated
  USING (true);
