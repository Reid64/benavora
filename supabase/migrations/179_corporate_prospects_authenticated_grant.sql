-- 179_corporate_prospects_authenticated_grant.sql
--
-- corporate_prospects was created (107_corporate_prospects.sql) as a shared,
-- cross-org reference table with no RLS by design (see
-- benavora-corporate-prospects-no-org-id memory) -- but the `authenticated`
-- Postgres role was never granted any privileges on it, only `service_role`.
-- This makes the AG-22 propensity-scoring route 500 for any real logged-in
-- user with "permission denied for table corporate_prospects" even though
-- the route itself is correct, because it reads/writes as the caller's
-- session (authenticated), not service-role.
--
-- Scoped to SELECT + UPDATE(scores, scores_computed_at) only -- the columns
-- AG-22 actually needs to read prospects and persist scores. No INSERT/
-- DELETE for authenticated; prospect rows are populated by
-- service-role-only ingestion agents.
--
-- Separately: relrowsecurity is TRUE on this table (RLS enabled) despite
-- 107_corporate_prospects.sql's comment intending no RLS, and zero policies
-- exist. RLS enabled + zero policies = default-deny for every non-owner
-- role, so the GRANT above is necessary but not sufficient -- authenticated
-- would still see 0 rows. Adding explicit permissive policies rather than
-- disabling RLS outright, matching Supabase convention of RLS-enabled-with-
-- explicit-policy over RLS-disabled for anything reachable via PostgREST.

GRANT SELECT ON corporate_prospects TO authenticated;
GRANT UPDATE (scores, scores_computed_at) ON corporate_prospects TO authenticated;

CREATE POLICY corporate_prospects_authenticated_select
  ON corporate_prospects FOR SELECT TO authenticated USING (true);

CREATE POLICY corporate_prospects_authenticated_update
  ON corporate_prospects FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
