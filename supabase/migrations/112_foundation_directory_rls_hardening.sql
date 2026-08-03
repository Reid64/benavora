-- 112_foundation_directory_rls_hardening.sql
--
-- Closes a live production vulnerability found incidentally while sourcing a safe RLS
-- precedent for 111_corporate_prospects_rls_hardening.sql: foundation_directory
-- (046_foundation_directory.sql's own header says "NO RLS: this is shared public
-- reference data across all tenants") has, confirmed live via `pg_class`/
-- `information_schema.role_table_grants`, relrowsecurity = false AND full
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER grants to BOTH anon and
-- authenticated -- 133,812 real rows, fully writable and truncatable by the public
-- anon key, right now. Same root cause as corporate_prospects would have had: this
-- project's public-schema ALTER DEFAULT PRIVILEGES grants postgres/supabase_admin-
-- created tables full anon/authenticated rights unless explicitly revoked.
--
-- Unlike corporate_prospects, this table genuinely needs read access for the app to
-- function -- confirmed by reading every real .from("foundation_directory") call site
-- in src/, worker/, and scripts/:
--   - All writes (INSERT/UPDATE/UPSERT) are 100% service_role: worker-driven agents
--     (change-monitor-agent, knowledge-indexer-agent, foundation-scraper.ts,
--     foundation-990-template.ts), /api/sources/propublica, and every scripts/*
--     ingestion/enrichment script. No client-component or authenticated-session code
--     path writes to this table anywhere.
--   - Reads are mixed: service_role (worker agents, /api/scraper/status), authenticated
--     session (most /api/** routes via requireRole(), dashboard/page.tsx server
--     component), and three real "use client" components that query the anon-key
--     browser client directly: src/app/(dashboard)/foundations/page.tsx,
--     src/components/foundations/FoundationDetail.tsx,
--     src/components/donor-discovery/ProspectDetail.tsx.
--   - Confirmed via src/middleware.ts: /foundations and /donor-discovery/* are not in
--     PUBLIC_PATHS, so the middleware redirects any request with no valid session to
--     /login before these components ever render. In practice these three call sites
--     therefore always run as the `authenticated` Postgres role (a valid user JWT is
--     required to reach them), never literal unauthenticated `anon` -- so the read
--     policy only needs to cover `authenticated`, not `anon`.
--   - foundation_directory has no organization_id (shared reference data across every
--     tenant, same as corporate_prospects), so there is no per-row tenant boundary to
--     scope the read policy by -- an unconditional USING (true) is the correct,
--     narrowest policy that still serves the real unscoped search/pagination/count
--     queries these pages issue (free-text ilike search, state/ntee/revenue/asset
--     filters, range-based pagination -- none of which are expressible as a row filter
--     without breaking the feature).
--
-- Net effect: anon loses all access (matches corporate_prospects' hardening);
-- authenticated keeps read-only access (unlike corporate_prospects, which has no real
-- authenticated-read path); write/delete/truncate stays service_role-only for both
-- roles, matching how the table is actually written today.

ALTER TABLE foundation_directory ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON foundation_directory FROM anon, authenticated;
GRANT SELECT ON foundation_directory TO authenticated;

CREATE POLICY foundation_directory_authenticated_read
  ON foundation_directory
  FOR SELECT
  TO authenticated
  USING (true);
