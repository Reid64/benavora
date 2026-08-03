-- 111_corporate_prospects_rls_hardening.sql
--
-- Applies AFTER 107_corporate_prospects.sql / 108_corporate_prospects_ea06_ea10.sql /
-- 109_corporate_prospects_ag22_propensity_scoring.sql. Those three files were written
-- and committed but never actually applied to production (confirmed live via
-- DATABASE_URL 2026-08-03: information_schema has no corporate_prospects table, and
-- none of the 11 agent_type enum values they add exist in the live enum either).
--
-- 107's own header comment says "NO RLS: shared public/cross-org reference data, same
-- convention as foundation_directory (046_foundation_directory.sql)". Read all 6
-- consuming agents (EA-01/EA-08 via corporate-enrichment-shared.ts, AG-22, the AG-30
-- donor-intent-monitor-agent, AG-32 relationship-graph-builder-agent) live 2026-08-03:
-- confirmed none of them filter or join by organization_id -- the table is genuinely
-- shared/global, not org-scoped, so an org-scoped RLS policy would be wrong for this
-- table's real access pattern.
--
-- But "NO RLS" as literally implemented for foundation_directory turns out to be a live
-- production vulnerability, not a safe precedent to copy: checked foundation_directory
-- directly this session and found relrowsecurity = false AND full
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE grants to both anon and authenticated (133,812
-- rows, fully open to the public anon key right now -- flagged separately, out of
-- scope to fix here). That exposure exists because this project's public schema has
-- ALTER DEFAULT PRIVILEGES granting anon/authenticated full rights on every new table
-- created by postgres/supabase_admin unless explicitly locked down -- so simply
-- omitting RLS (matching 107's literal instruction) would silently make
-- corporate_prospects just as exposed as foundation_directory already is.
--
-- This migration keeps the real access pattern 107 intended (service-role-only, no
-- client-facing route reads it, no organization_id column, no org-scoped policy) but
-- closes the default-privilege gap: RLS ON with zero permissive policies blocks
-- anon/authenticated SELECT/INSERT/UPDATE/DELETE by default (service_role bypasses RLS
-- per Supabase convention, so the agents' service-role client is unaffected); the
-- explicit REVOKE additionally closes TRUNCATE, which RLS policies do not govern.

ALTER TABLE corporate_prospects ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON corporate_prospects FROM anon, authenticated;
