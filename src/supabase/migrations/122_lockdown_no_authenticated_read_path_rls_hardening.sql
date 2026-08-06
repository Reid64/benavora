-- 122_lockdown_no_authenticated_read_path_rls_hardening.sql
--
-- 23 tables confirmed via grep+read to have NO real read/write path through any authenticated
-- (session-respecting) client anywhere in src/ or worker/ -- every real call site uses
-- createAdminClient() (service role, bypasses RLS regardless of policy), or no call site exists
-- in the app at all (orphaned/never-wired schema). Matches the corporate_prospects precedent
-- (migration 111): enable RLS, revoke both anon and authenticated grants, add NO policy at all.
-- Service-role-only callers are completely unaffected; this closes only the anon (and, for
-- defense-in-depth, authenticated) exposure with zero functional risk since nothing legitimate
-- ever reached these tables via anon/authenticated in the first place.

-- Confirmed admin-client-only real call sites:
-- agent_performance_metrics: src/app/api/admin/improvements/route.ts (createAdminClient, that
--   route's own comment states "platform-wide tables with no RLS -- gated at the app layer via
--   requireRole" -- this migration corrects that reliance-on-app-layer-only pattern, since a raw
--   PostgREST call bypasses the Next.js route entirely).
-- cross_client_submissions: src/lib/autoapply/submission-controls.ts, instantiated only from
--   auto-queue-populator.ts (background queue populator, admin client) -- genuinely cross-tenant
--   by design (hashed org_id anti-abuse dedup) but never exposed to any user-facing route.
-- dd_api_spend: src/lib/donor-discovery/adapters/google-places.ts (createAdminClient), monthly
--   API-spend budget cap tracking.
-- discovery_runs: created by migration 075 (Agent Marketplace); confirmed by
--   src/lib/agents/fundability-scorer-agent.ts's own header comment that this whole schema
--   concept was never wired to any consumer -- zero real read/write call sites found anywhere.
-- donor_discovery_geocache: src/lib/donor-discovery/adapters/geocoding-adapter.ts
--   (createAdminClient), address-hash-keyed Google Geocoding API cache.
-- donor_discovery_tos_registry, dd_robots_cache: src/lib/donor-discovery/crawler-core.ts
--   (createAdminClient), domain-keyed scraping-compliance cache.
-- enrichment_jobs: src/lib/enrichment/{engine,runner}.ts (createAdminClient exclusively, CLI/
--   worker job processing) -- has an organization_id column but zero .tsx/UI call site found.
-- impersonation_log: src/app/api/admin/orgs/[id]/impersonate/route.ts (createAdminClient,
--   owner-only route) -- platform-admin audit trail, that route's own comment notes it is
--   "currently unwired anywhere else in the app."
-- improvement_proposals: src/app/api/admin/improvements/route.ts (createAdminClient), same
--   comment/reasoning as agent_performance_metrics above.
-- platform_tasks, system_errors: system_errors written by
--   src/lib/autoapply/confirmation-monitor.ts and read only by
--   src/app/api/admin/system/route.ts (both createAdminClient); platform_tasks has zero call
--   sites found anywhere in src/.
-- sales_campaign_steps, sending_domains: src/lib/admin/{sales-campaign-engine,domain-manager}.ts
--   (createAdminClient exclusively) -- part of the same internal sales-tool table family as
--   prospects/sales_campaigns/sales_sends/suppression_list (migration 118).
--
-- Confirmed zero real call sites anywhere in src/ (orphaned/never-wired schema):
-- ai_usage_log, community_foundation_registry, corporate_giving_targets,
-- intelligence_budget_templates, intelligence_grant_dna_scores, intelligence_narrative_patterns,
-- intelligence_post_award_reports, kb_extended_needs, fundability_deficiencies (the last is
-- explicitly documented as never-real by fundability-scorer-agent.ts's own header comment: "there
-- is no separate fundability_deficiencies table" per the live schema it was actually built
-- against -- this table is leftover/superseded schema, deficiencies are stored inside
-- fundability_scores.deficiencies jsonb instead).

ALTER TABLE agent_performance_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_performance_metrics FROM anon;
REVOKE ALL ON agent_performance_metrics FROM authenticated;

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_usage_log FROM anon;
REVOKE ALL ON ai_usage_log FROM authenticated;

ALTER TABLE community_foundation_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON community_foundation_registry FROM anon;
REVOKE ALL ON community_foundation_registry FROM authenticated;

ALTER TABLE corporate_giving_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON corporate_giving_targets FROM anon;
REVOKE ALL ON corporate_giving_targets FROM authenticated;

ALTER TABLE cross_client_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cross_client_submissions FROM anon;
REVOKE ALL ON cross_client_submissions FROM authenticated;

ALTER TABLE dd_api_spend ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dd_api_spend FROM anon;
REVOKE ALL ON dd_api_spend FROM authenticated;

ALTER TABLE dd_robots_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dd_robots_cache FROM anon;
REVOKE ALL ON dd_robots_cache FROM authenticated;

ALTER TABLE discovery_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON discovery_runs FROM anon;
REVOKE ALL ON discovery_runs FROM authenticated;

ALTER TABLE donor_discovery_geocache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON donor_discovery_geocache FROM anon;
REVOKE ALL ON donor_discovery_geocache FROM authenticated;

ALTER TABLE donor_discovery_tos_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON donor_discovery_tos_registry FROM anon;
REVOKE ALL ON donor_discovery_tos_registry FROM authenticated;

ALTER TABLE enrichment_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON enrichment_jobs FROM anon;
REVOKE ALL ON enrichment_jobs FROM authenticated;

ALTER TABLE fundability_deficiencies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fundability_deficiencies FROM anon;
REVOKE ALL ON fundability_deficiencies FROM authenticated;

ALTER TABLE impersonation_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON impersonation_log FROM anon;
REVOKE ALL ON impersonation_log FROM authenticated;

ALTER TABLE improvement_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON improvement_proposals FROM anon;
REVOKE ALL ON improvement_proposals FROM authenticated;

ALTER TABLE intelligence_budget_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON intelligence_budget_templates FROM anon;
REVOKE ALL ON intelligence_budget_templates FROM authenticated;

ALTER TABLE intelligence_grant_dna_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON intelligence_grant_dna_scores FROM anon;
REVOKE ALL ON intelligence_grant_dna_scores FROM authenticated;

ALTER TABLE intelligence_narrative_patterns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON intelligence_narrative_patterns FROM anon;
REVOKE ALL ON intelligence_narrative_patterns FROM authenticated;

ALTER TABLE intelligence_post_award_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON intelligence_post_award_reports FROM anon;
REVOKE ALL ON intelligence_post_award_reports FROM authenticated;

ALTER TABLE kb_extended_needs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON kb_extended_needs FROM anon;
REVOKE ALL ON kb_extended_needs FROM authenticated;

ALTER TABLE platform_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_tasks FROM anon;
REVOKE ALL ON platform_tasks FROM authenticated;

ALTER TABLE sales_campaign_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sales_campaign_steps FROM anon;
REVOKE ALL ON sales_campaign_steps FROM authenticated;

ALTER TABLE sending_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sending_domains FROM anon;
REVOKE ALL ON sending_domains FROM authenticated;

ALTER TABLE system_errors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON system_errors FROM anon;
REVOKE ALL ON system_errors FROM authenticated;
