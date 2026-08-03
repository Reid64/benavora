-- 119_intelligence_funded_proposals_rls_hardening.sql
--
-- Closes an ANON_GRANT_AUDIT.md Category C finding: intelligence_funded_proposals (3,169 rows,
-- 048_grant_intelligence.sql, extended by 096/106) had relrowsecurity=false, fully open to anon.
-- No organization_id column ever added across any of its 3 migrations; explicitly documented
-- ("shared, cross-org table, no organization_id column") in 106's header and in
-- src/app/api/intelligence/proposals/route.ts's own comments -- this is the shared grant-
-- intelligence corpus every org reads to power draft generation, dashboards, and the intelligence
-- library, not per-org data.
--
-- Read every real .from("intelligence_funded_proposals") call site in src/, worker/, and scripts/
-- before writing this (2026-08-03), ~25 call sites: reads span both authenticated (dashboard
-- widgets, knowledge page, intelligence-library search, proposals list/search/stats -- all gated by
-- requireRole or a session-bound Server Component) and service_role (all bulk ingestion scripts:
-- NIH/NSF/federal-register/SAMHSA-HRSA/federal-awards/foundation-awards, plus seed/cleanup/backfill
-- scripts). One real, currently-working INSERT path runs on the AUTHENTICATED role specifically,
-- not admin: POST /api/intelligence/ingest's manual/url source branch
-- (src/app/api/intelligence/ingest/route.ts:140) is gated by requireRole('writer') but executes the
-- insert on the session-bound server client -- an authenticated INSERT policy is required or this
-- route breaks. The separate "Add Awarded Grant Narrative" owner-gated manual-entry path
-- (proposals/route.ts:140) already uses createAdminClient() (service_role), so it is unaffected
-- either way. No anon call site exists anywhere.

ALTER TABLE intelligence_funded_proposals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON intelligence_funded_proposals FROM anon, authenticated;
GRANT SELECT, INSERT ON intelligence_funded_proposals TO authenticated;

CREATE POLICY intelligence_funded_proposals_authenticated_read
  ON intelligence_funded_proposals
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY intelligence_funded_proposals_authenticated_insert
  ON intelligence_funded_proposals
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
