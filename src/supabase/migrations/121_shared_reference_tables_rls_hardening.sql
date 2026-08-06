-- 121_shared_reference_tables_rls_hardening.sql
--
-- 10 tables with no organization_id/org_id column, confirmed via grep+read to be genuinely
-- shared/cross-tenant reference or aggregate data (matching the precedent already established in
-- migrations 112/114/117/118/120/122/123 for foundation_directory/nonprofits/
-- intelligence_budget_patterns/donor_discovery_directory/intelligence_funded_proposals/
-- knowledge_patterns): authenticated-only shared read, anon fully revoked. Each is read via a
-- real authenticated (session-respecting) client, not admin-only, so a bare RLS lock-down would
-- break a real feature -- but there is no tenant boundary to enforce, only an anon boundary.

-- agent_registry: no org column. Read via src/app/api/agents/registry/route.ts
-- (requireRole-derived session client) -- the Agent Marketplace catalog, identical for every org.
ALTER TABLE agent_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_registry FROM anon;
CREATE POLICY agent_registry_shared_select ON agent_registry FOR SELECT TO authenticated USING (true);

-- enrichment_results: no org column, keyed by entity_id (a foundation). Read via
-- src/lib/intelligence/grantmaker-profiles.ts using createClient() from
-- @/lib/supabase/server (session-respecting), no org filter -- shared enrichment output about a
-- foundation, not about the calling org.
ALTER TABLE enrichment_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON enrichment_results FROM anon;
CREATE POLICY enrichment_results_shared_select ON enrichment_results FOR SELECT TO authenticated USING (true);

-- foundation_profiles: no org column, keyed by foundation_id. Read+upserted via
-- src/app/api/foundations/[id]/profile/route.ts, requireRole('viewer')-gated session client --
-- computed/cached foundation analytics shared across every org that looks up the same foundation.
ALTER TABLE foundation_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON foundation_profiles FROM anon;
CREATE POLICY foundation_profiles_shared_select ON foundation_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY foundation_profiles_shared_insert ON foundation_profiles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY foundation_profiles_shared_update ON foundation_profiles FOR UPDATE TO authenticated USING (true);

-- intelligence_evaluation_frameworks: no org column. Read via
-- src/lib/intelligence/evaluation-library.ts -- shared Intelligence Library corpus content,
-- ingested by CLI/admin scripts, read by every org's draft/evaluation flows.
ALTER TABLE intelligence_evaluation_frameworks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON intelligence_evaluation_frameworks FROM anon;
CREATE POLICY intelligence_evaluation_frameworks_shared_select ON intelligence_evaluation_frameworks
  FOR SELECT TO authenticated USING (true);

-- intelligence_grantmaker_profiles: no org column, keyed by foundation_id. Read via
-- src/lib/intelligence/{unified-search,funder-recommender,grantmaker-profiles}.ts and the
-- Intelligence Library dashboard client component, session client, no org filter.
ALTER TABLE intelligence_grantmaker_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON intelligence_grantmaker_profiles FROM anon;
CREATE POLICY intelligence_grantmaker_profiles_shared_select ON intelligence_grantmaker_profiles
  FOR SELECT TO authenticated USING (true);

-- intelligence_logic_models: no org column. Read via
-- src/app/api/intelligence/logic-model/route.ts, logic-model-generator.ts, rag-retrieval.ts,
-- Intelligence Library dashboard, stats route -- shared corpus content.
ALTER TABLE intelligence_logic_models ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON intelligence_logic_models FROM anon;
CREATE POLICY intelligence_logic_models_shared_select ON intelligence_logic_models
  FOR SELECT TO authenticated USING (true);

-- intelligence_need_data: no org column. Read via
-- src/app/api/intelligence/need-data/route.ts, Intelligence Library dashboard, stats route,
-- rag-retrieval.ts -- shared community-need reference data.
ALTER TABLE intelligence_need_data ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON intelligence_need_data FROM anon;
CREATE POLICY intelligence_need_data_shared_select ON intelligence_need_data
  FOR SELECT TO authenticated USING (true);

-- intelligence_scoring_rubrics: no org column. Read via
-- src/lib/drafts/generator.ts, ingest scripts, stats route, rag-retrieval.ts, Intelligence Library
-- dashboard -- shared scoring-rubric reference content used across every org's draft generation.
ALTER TABLE intelligence_scoring_rubrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON intelligence_scoring_rubrics FROM anon;
CREATE POLICY intelligence_scoring_rubrics_shared_select ON intelligence_scoring_rubrics
  FOR SELECT TO authenticated USING (true);

-- platform_learning_patterns: no org column (deliberately cross-tenant aggregate, per AG-36's own
-- design). GET /api/intelligence/learning-network's own header comment explicitly states: "carries
-- no RLS policy... a direct client-side call would be wide open to any authenticated user of any
-- org" -- confirmed true and unfixed until this migration. Also read by draft-generation-agent.ts,
-- strategic-advisor-agent.ts, simulation-agent.ts (admin-client agents, unaffected either way).
-- Matches the knowledge_patterns precedent (migration 123): shared aggregate, authenticated-only
-- read, anon fully revoked.
ALTER TABLE platform_learning_patterns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform_learning_patterns FROM anon;
CREATE POLICY platform_learning_patterns_shared_select ON platform_learning_patterns
  FOR SELECT TO authenticated USING (true);

-- worker_status: no org column (single global Railway worker heartbeat row). Read via
-- src/components/autoapply/WorkerStatus.tsx using the plain browser session client with a
-- Realtime subscription, no org filter -- there is no per-org meaning for this table. Low
-- sensitivity (worker_id, status, heartbeat timestamp, item counts) -- authenticated shared read.
ALTER TABLE worker_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON worker_status FROM anon;
CREATE POLICY worker_status_shared_select ON worker_status FOR SELECT TO authenticated USING (true);
