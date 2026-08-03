-- 116_organizational_digital_twins_rls_hardening.sql
--
-- Closes an ANON_GRANT_AUDIT.md Category C finding: organizational_digital_twins (organization_id
-- NOT NULL UNIQUE, FK'd to organizations) had relrowsecurity=false AND zero live policies, despite
-- two separate migration tracks (093_digital_twins.sql, src/supabase/migrations/
-- 094_twin_powered_draft_generation.sql) both defining an org-scoped policy for it -- confirmed
-- live via pg_policies: neither ever actually landed. This is the most sensitive table fixed this
-- session by content (financial_profile, board_composition, known_weaknesses jsonb columns,
-- one row per org).
--
-- Read every real .from("organizational_digital_twins") call site in src/, worker/, and scripts/
-- before writing this (2026-08-03): every genuine call site already filters by organization_id/
-- orgId in application code, and every real caller resolves orgId server-side from the session
-- (requireRole, profile.organization_id, or a middleware-set header) -- never from client-supplied
-- input. So the exposure here isn't "app code has no filter" (unlike form_templates), it's that RLS
-- was the only thing that should have been backstopping a forged/replayed request or a future call
-- site written without the same discipline, and it was providing zero backstop.

ALTER TABLE organizational_digital_twins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON organizational_digital_twins FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON organizational_digital_twins TO authenticated;

CREATE POLICY organizational_digital_twins_org_isolation
  ON organizational_digital_twins
  FOR ALL
  TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
