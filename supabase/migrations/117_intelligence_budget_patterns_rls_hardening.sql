-- 117_intelligence_budget_patterns_rls_hardening.sql
--
-- Closes an ANON_GRANT_AUDIT.md Category C finding: intelligence_budget_patterns (059_budget_
-- patterns.sql) had relrowsecurity=false, fully open to anon. Confirmed by schema (no
-- organization_id/tenant column) and by content (5 static, seed-only budget-template rows,
-- generic line-items/percentages by program_category x grant_type -- not org-specific data) that
-- this is shared/global reference content, matching foundation_directory's pattern, not tenant data.
--
-- Read every real .from("intelligence_budget_patterns") call site in src/ before writing this
-- (2026-08-03): every real call site is authenticated (dashboard widget on
-- /intelligence-library/dashboard, plus 3 server-side reads gated by requireRole/session via
-- BudgetPatternLibrary.getTemplateByCategory, used by the budget-patterns API route, unified
-- search, and draft generation). No service_role or literal anon path exists in app code beyond
-- the one-time migration seed. Nothing in src/, worker/, or scripts/ writes to this table outside
-- that seed, so no authenticated write policy is needed.

ALTER TABLE intelligence_budget_patterns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON intelligence_budget_patterns FROM anon, authenticated;
GRANT SELECT ON intelligence_budget_patterns TO authenticated;

CREATE POLICY intelligence_budget_patterns_authenticated_read
  ON intelligence_budget_patterns
  FOR SELECT
  TO authenticated
  USING (true);
