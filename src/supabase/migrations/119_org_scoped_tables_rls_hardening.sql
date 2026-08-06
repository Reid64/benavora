-- 119_org_scoped_tables_rls_hardening.sql
--
-- Closes 10 more ANON_GRANT_AUDIT.md §5 Category C tables: real organization_id/org_id column,
-- confirmed real authenticated read/write path via grep+read of the actual call sites.

-- adapter_usage_log: organization_id NOT NULL. Written by
-- src/lib/donor-discovery/connectors/usage-log.ts (admin client) and
-- src/lib/donor-discovery/adapters/google-places-adapter.ts; read (org-scoped) by
-- GET /api/donor-discovery/connectors (requireRole-derived session client,
-- .eq("organization_id", organizationId)) for the connectors page's last-used/records-enriched
-- telemetry.
ALTER TABLE adapter_usage_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON adapter_usage_log FROM anon;
CREATE POLICY adapter_usage_log_org_select ON adapter_usage_log FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY adapter_usage_log_org_insert ON adapter_usage_log FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- auto_queue_config: organization_id NOT NULL, UNIQUE(organization_id) (upsert onConflict target
-- in src/app/api/autoapply/config/route.ts, which derives organization_id from the session via
-- its role gate). Per-org AutoApply auto-queue settings (max_per_batch, schedule, exclusions).
ALTER TABLE auto_queue_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auto_queue_config FROM anon;
CREATE POLICY auto_queue_config_org_select ON auto_queue_config FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY auto_queue_config_org_insert ON auto_queue_config FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY auto_queue_config_org_update ON auto_queue_config FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- autoapply_review_queue: organization_id NOT NULL. CONFIRMED LIVE IDOR while investigating this
-- table: src/components/autoapply/ReviewQueue.tsx is a 'use client' component using the browser
-- (anon-key, session-respecting) Supabase client and calls
-- .from("autoapply_review_queue").select("*, funders(name)") with ZERO organization_id filter --
-- it relies entirely on RLS for tenant isolation, exactly the same pattern already documented and
-- fixed for form_templates in migration 115 (that migration's own comment flags this exact file,
-- ReviewQueue.tsx, for a sibling table). With RLS disabled, any authenticated user of any org
-- could read AND update/dismiss/resolve every other org's AutoApply failure-review items. No
-- app-code change needed -- per this codebase's established convention (migration 115 precedent),
-- RLS is the designed enforcement boundary for this client-side query; enabling it with the
-- correct policy is the complete fix.
ALTER TABLE autoapply_review_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON autoapply_review_queue FROM anon;
CREATE POLICY autoapply_review_queue_org_select ON autoapply_review_queue FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY autoapply_review_queue_org_insert ON autoapply_review_queue FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY autoapply_review_queue_org_update ON autoapply_review_queue FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- discovery_matches: org_id NOT NULL (not organization_id -- confirmed live). CONFIRMED LIVE
-- IDOR-adjacent gap: src/app/api/agents/discovery/route.ts's own header comment states
-- "discovery_matches is RLS-scoped to the caller's real organization_id, so a forged header just
-- resolves to no rows" -- that claim was FALSE until this migration, since RLS was disabled. The
-- route does apply .eq("organization_id", ctx.orgId) at the app layer (mitigating direct
-- exploitation via that one route), but src/lib/agents/morning-digest.ts reads the same table the
-- same way and a raw anon/authenticated PostgREST call had zero protection at all. This migration
-- makes the route's own comment true.
ALTER TABLE discovery_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON discovery_matches FROM anon;
CREATE POLICY discovery_matches_org_select ON discovery_matches FOR SELECT TO authenticated
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY discovery_matches_org_insert ON discovery_matches FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY discovery_matches_org_update ON discovery_matches FOR UPDATE TO authenticated
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- grant_agreements: organization_id NOT NULL. Read/written via
-- src/app/api/autoapply/agreements/route.ts and [id]/route.ts, requireRole("viewer")-gated,
-- organization_id derived server-side. Grant/donation/sponsorship award records.
ALTER TABLE grant_agreements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON grant_agreements FROM anon;
CREATE POLICY grant_agreements_org_select ON grant_agreements FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY grant_agreements_org_insert ON grant_agreements FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY grant_agreements_org_update ON grant_agreements FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- knowledge_queries: org_id NOT NULL (not organization_id). Insert-only call site found
-- (src/lib/intelligence/knowledge-engine.ts, per-org query log for the Knowledge Engine search
-- feature) -- org-scoped SELECT/INSERT policy applied per the standard pattern so a future
-- per-org query-history UI has a correct policy already in place, and so the table is never
-- cross-org readable even though no read UI exists yet.
ALTER TABLE knowledge_queries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON knowledge_queries FROM anon;
CREATE POLICY knowledge_queries_org_select ON knowledge_queries FOR SELECT TO authenticated
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY knowledge_queries_org_insert ON knowledge_queries FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- org_learning_contributions: org_id NOT NULL. Read via
-- GET /api/intelligence/learning-network (requireRole-derived session client,
-- .eq("org_id", organizationId)). That route's OWN header comment explicitly flags this table (and
-- platform_learning_patterns) as carrying "no RLS policy... a direct client-side call would be
-- wide open to any authenticated user of any org" -- this migration closes exactly the gap that
-- comment describes for the org-scoped half (platform_learning_patterns itself is genuinely
-- shared/cross-org by design and is handled separately in 121 with an authenticated shared-read
-- policy, not an org-scoped one).
ALTER TABLE org_learning_contributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON org_learning_contributions FROM anon;
CREATE POLICY org_learning_contributions_org_select ON org_learning_contributions FOR SELECT TO authenticated
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- pitch_cache: organization_id NOT NULL. Read/written via src/lib/autoapply/pitch-personalizer.ts
-- (.eq('organization_id', organizationId)), cached AI-personalized pitch text per org+funder.
ALTER TABLE pitch_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pitch_cache FROM anon;
CREATE POLICY pitch_cache_org_select ON pitch_cache FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pitch_cache_org_insert ON pitch_cache FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pitch_cache_org_update ON pitch_cache FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pitch_cache_org_delete ON pitch_cache FOR DELETE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- solicitation_registrations: organization_id NOT NULL. Read via
-- src/lib/autoapply/compliance-guard.ts (.eq('organization_id', organizationId)) -- per-org state
-- charitable-solicitation registration status/expiry, gating AutoApply compliance checks.
ALTER TABLE solicitation_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON solicitation_registrations FROM anon;
CREATE POLICY solicitation_registrations_org_select ON solicitation_registrations FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY solicitation_registrations_org_insert ON solicitation_registrations FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY solicitation_registrations_org_update ON solicitation_registrations FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- submission_receipts: organization_id NOT NULL. Written by
-- src/lib/autoapply/receipt-generator.ts after every successful AutoApply submission
-- (organization_id = submission.organization_id). No authenticated read route found this session,
-- but the column and real per-submission semantics are genuine -- org-scoped SELECT applied so a
-- future receipts UI is correct by default rather than needing its own RLS follow-up.
ALTER TABLE submission_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON submission_receipts FROM anon;
CREATE POLICY submission_receipts_org_select ON submission_receipts FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
