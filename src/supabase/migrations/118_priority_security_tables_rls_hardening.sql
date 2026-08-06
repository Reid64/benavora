-- 118_priority_security_tables_rls_hardening.sql
--
-- Closes 11 of ANON_GRANT_AUDIT.md §5's Category C tables, prioritized first per this task's
-- explicit ordering (security/PII-sensitive despite low current row counts): funder_credentials,
-- platform_admins, submission_queue, autoapply_submissions, prospects, sales_campaigns,
-- sales_sends, suppression_list, prospect_lists, agent_configurations, webhook_configs.
--
-- Methodology per DIRECTIVE-017 precedent (form_templates/opportunity_probability_scores fixes):
-- real app-code call sites were grepped and read before choosing a policy shape. See
-- ANON_GRANT_AUDIT.md §8 (updated this session) for the full per-table investigation record.

-- funder_credentials: organization_id NOT NULL, read/written exclusively via
-- CredentialManager (src/lib/autoapply/credential-manager.ts), org-scoped
-- (.eq("organization_id", organizationId)). Portal login credentials — encrypted at rest, but
-- rows (which funder a customer has AutoApply credentials for) were fully anon-readable.
ALTER TABLE funder_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON funder_credentials FROM anon;
CREATE POLICY funder_credentials_org_select ON funder_credentials FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY funder_credentials_org_insert ON funder_credentials FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY funder_credentials_org_update ON funder_credentials FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY funder_credentials_org_delete ON funder_credentials FOR DELETE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- platform_admins: no organization_id (platform-wide, cross-org by nature). Confirmed the only
-- real read/write path is src/app/api/platform/bootstrap/route.ts's createAdminClient() (service
-- role, bypasses RLS regardless). No authenticated policy — matches the corporate_prospects
-- precedent (migration 111): registry of platform super-admin emails/permissions, was fully
-- anon-readable, the single highest-severity finding in ANON_GRANT_AUDIT.md/RLS_POLICY_AUDIT.md.
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_admins FROM anon;
REVOKE ALL ON platform_admins FROM authenticated;

-- submission_queue: organization_id NOT NULL. Live pg_policies check this session confirmed 4
-- correct org-scoped policies (submission_queue_org_select/insert/update/delete, using
-- organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())) already exist
-- from 066_fix_autoapply_rls_policies.sql -- RLS itself was simply never turned on, so they've
-- been silently inert (same "some of a migration's DDL landed, some didn't" drift pattern as
-- form_templates/agent_decisions/corporate_prospects). No new policies needed.
-- Schema-drift check performed per this task's explicit instruction: queue-20/21's new columns
-- (pause_reason, paused_at, paused_screenshot_path, paused_history, resume_count) and the
-- widened status CHECK constraint (117_submission_queue_status_check_fix.sql) do not appear in
-- any policy's USING/WITH CHECK expression -- the existing policies reference organization_id
-- only, unaffected by that column/status drift.
ALTER TABLE submission_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON submission_queue FROM anon;

-- autoapply_submissions: organization_id NOT NULL. Same situation as submission_queue -- 4
-- correct org-scoped policies already exist (066_fix_autoapply_rls_policies.sql), RLS was never
-- enabled. No new policies needed.
ALTER TABLE autoapply_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON autoapply_submissions FROM anon;

-- prospects, prospect_lists, sales_campaigns, sales_sends, suppression_list: Benavora's own
-- internal sales/outreach tool (src/lib/admin/prospect-manager.ts, sales-campaign-engine.ts,
-- unsubscribe-agent.ts) -- not customer/tenant data. Every real read/write call site confirmed
-- via grep+read to use createAdminClient() (service role) exclusively, gated at the app layer via
-- requireRole in the calling API routes. No organization_id column on any of the 5 (platform-wide,
-- not per-customer-org). No authenticated policy needed -- service role bypasses RLS for the
-- routes that already work; this closes only the anon hole.
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prospects FROM anon;
REVOKE ALL ON prospects FROM authenticated;

ALTER TABLE prospect_lists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prospect_lists FROM anon;
REVOKE ALL ON prospect_lists FROM authenticated;

ALTER TABLE sales_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_campaigns FROM anon;
REVOKE ALL ON sales_campaigns FROM authenticated;

ALTER TABLE sales_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_sends FROM anon;
REVOKE ALL ON sales_sends FROM authenticated;

-- suppression_list: also written by /api/unsubscribe/route.ts (a deliberately unauthenticated,
-- public unsubscribe-link endpoint) -- but that route also uses createAdminClient() exclusively,
-- so it is unaffected by revoking anon/authenticated table grants; the route's own logic (not a
-- table grant) is what makes it reachable by a logged-out recipient.
ALTER TABLE suppression_list ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON suppression_list FROM anon;
REVOKE ALL ON suppression_list FROM authenticated;

-- agent_configurations: org_id NOT NULL (note: this table uses org_id, not organization_id --
-- confirmed live via information_schema). Read/written via
-- src/app/api/agents/registry/configure/route.ts, organization_id derived server-side via
-- requireRole (never the request body), upserted on (org_id, agent_id). Per-org Agent Marketplace
-- enable/disable + config state -- was fully anon-readable and anon-writable.
ALTER TABLE agent_configurations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_configurations FROM anon;
CREATE POLICY agent_configurations_org_select ON agent_configurations FOR SELECT TO authenticated
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY agent_configurations_org_insert ON agent_configurations FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY agent_configurations_org_update ON agent_configurations FOR UPDATE TO authenticated
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY agent_configurations_org_delete ON agent_configurations FOR DELETE TO authenticated
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- webhook_configs: organization_id NOT NULL. Read via webhook-notifier.ts
-- (.eq('organization_id', orgId).eq('is_active', true)) and surfaced on
-- /autoapply/webhooks -- outbound webhook URLs + event subscriptions per org.
ALTER TABLE webhook_configs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON webhook_configs FROM anon;
CREATE POLICY webhook_configs_org_select ON webhook_configs FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY webhook_configs_org_insert ON webhook_configs FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY webhook_configs_org_update ON webhook_configs FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY webhook_configs_org_delete ON webhook_configs FOR DELETE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
