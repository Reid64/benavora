-- 123_knowledge_patterns_rls_hardening.sql
--
-- Closes an ANON_GRANT_AUDIT.md Category C finding: knowledge_patterns (33 rows,
-- 096_knowledge_engine.sql) had relrowsecurity=false, fully open to anon. No organization_id
-- column -- the migration's own header comment is explicit: "knowledge_patterns has no
-- organization_id/RLS: it mirrors the existing intelligence_scoring_rubrics /
-- intelligence_logic_models / etc. tables, which are shared, cross-org intelligence library data,
-- not per-org data." (Contrast with knowledge_queries in the same migration, which does get
-- organization_id + RLS because it's a per-org search log.)
--
-- Read every real .from("knowledge_patterns") call site in src/, worker/, and scripts/ before
-- writing this (2026-08-03): every real authenticated-role path is SELECT-only (the
-- /intelligence/knowledge dashboard count, and queryKnowledgeEngine()'s keyword search via
-- POST /api/intelligence/knowledge-query). No production call site does INSERT/UPDATE from an
-- authenticated/session client -- all writes (the curated seed script, and the AG-29
-- knowledge-indexer agent's pattern-mining pass) run as service_role and bypass RLS regardless. No
-- anon call site exists anywhere.

ALTER TABLE knowledge_patterns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON knowledge_patterns FROM anon, authenticated;
GRANT SELECT ON knowledge_patterns TO authenticated;

CREATE POLICY knowledge_patterns_authenticated_read
  ON knowledge_patterns
  FOR SELECT
  TO authenticated
  USING (true);
