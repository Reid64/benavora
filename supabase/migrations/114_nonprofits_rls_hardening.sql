-- 114_nonprofits_rls_hardening.sql
--
-- Closes ANON_GRANT_AUDIT.md's #1-by-scale Category C finding (2026-08-03): nonprofits
-- (098_nonprofits_bmf.sql -- the full IRS Business Master File import, ~1.98M rows) had RLS
-- disabled with full anon+authenticated grants, from this project's public-schema default
-- privileges (same root cause as corporate_prospects/foundation_directory).
--
-- Read every real .from("nonprofits") call site in src/, worker/, and scripts/ before writing this
-- (including one non-literal call site missed by a naive grep: scripts/import-teos-local.ts's
-- fetchExistingRows(admin, table, eins) with table="nonprofits" passed as a variable):
--   - All writes (INSERT/UPSERT/UPDATE) are 100% service_role: the BMF ingestion job
--     (scripts/ingest-nonprofit-bmf.ts), every tiered enrichment script (990 XML parsing,
--     ProPublica, website/contact scraping), and the EA-04 foundation-detector agent (worker-only).
--     No client-component or authenticated-session code path writes to this table anywhere.
--   - Reads are mixed service_role (worker agents, scripts) and authenticated session
--     (/nonprofits dashboard page, /api/agents/discovery, /api/intelligence/twin/auto-populate,
--     /api/onboarding/complete-setup).
--   - One real anon-key browser call site exists (src/app/(dashboard)/knowledge-base/edit/page.tsx),
--     but /knowledge-base/edit is not in src/middleware.ts's PUBLIC_PATHS, so it always runs as
--     `authenticated` in practice, never literal unauthenticated anon -- identical reasoning to
--     foundation_directory's three browser call sites in 112_foundation_directory_rls_hardening.sql.
--   - No organization_id/tenant column exists (confirmed: shared IRS BMF reference data across
--     every tenant, same as foundation_directory/corporate_prospects) -- no per-row boundary to
--     scope a policy by, so an unconditional USING (true) is the correct, narrowest policy that
--     still serves the real unscoped search/pagination/count queries these pages issue.
--
-- Net effect, identical shape to 112: anon loses all access; authenticated keeps read-only access;
-- write/delete/truncate stays service_role-only for both roles, matching how the table is actually
-- written today.

ALTER TABLE nonprofits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON nonprofits FROM anon, authenticated;
GRANT SELECT ON nonprofits TO authenticated;

CREATE POLICY nonprofits_authenticated_read
  ON nonprofits
  FOR SELECT
  TO authenticated
  USING (true);
