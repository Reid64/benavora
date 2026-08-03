-- 121_opportunity_probability_scores_rls_hardening.sql
--
-- Closes an ANON_GRANT_AUDIT.md Category C finding: opportunity_probability_scores (995 rows,
-- organization_id NOT NULL, FK'd to organizations) had relrowsecurity=false AND zero live policies,
-- despite 093_digital_twins.sql already defining the correct org-scoped policy for it -- confirmed
-- live via pg_policies: it never actually landed. Same "migration written, DDL didn't fully apply"
-- drift pattern as form_templates/organizational_digital_twins fixed alongside it this session.
--
-- Read every real .from("opportunity_probability_scores") call site in src/, worker/, and scripts/
-- before writing this (2026-08-03): this is real per-org tenant data (a probability score per
-- opportunity per org). Every genuine authenticated-role call site (fundability-scorer-agent.ts,
-- grant-probability-engine.ts, simulation-agent.ts, the /draft-generator/autonomous page) filters
-- by organization_id already; every service_role worker/script call site bypasses RLS regardless.
--
-- IMPORTANT, flagged not fixed here (out of scope for a schema-only migration): the same research
-- found src/app/(dashboard)/opportunities/page.tsx:180 queries this table via the authenticated
-- browser client with ZERO organization_id filter in application code -- until this migration
-- lands, that page was a live, real cross-tenant data leak (every authenticated user of every org
-- received every org's probability scores), relying entirely on RLS for isolation. This migration
-- closes that leak as a direct side effect. Also flagged, unrelated to RLS: autonomous-digest-
-- agent.ts:588 and opportunity-discovery-agent.ts:554 both filter on a nonexistent "org_id" column
-- (the real column is organization_id) -- those two queries error today regardless of RLS state;
-- not touched by this migration.

ALTER TABLE opportunity_probability_scores ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON opportunity_probability_scores FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON opportunity_probability_scores TO authenticated;

CREATE POLICY opportunity_probability_scores_org_isolation
  ON opportunity_probability_scores
  FOR ALL
  TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
