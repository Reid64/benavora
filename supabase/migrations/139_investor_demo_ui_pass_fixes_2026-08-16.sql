-- Migration 139: fixes found during the 2026-08-16 investor-demo UI verification pass.
-- Every item below was reproduced live via a real Playwright sweep of every major
-- authenticated page, then root-caused and applied directly via psql/DATABASE_URL
-- (per DIRECTIVE-017), then re-verified live. This migration file exists to keep the
-- migration tree an accurate record of live schema state, matching this project's
-- established convention -- it documents fixes already applied to production, it does
-- not apply them for the first time.

-- 1. org_settings (migration 080) was committed with a comment claiming it had been
--    "applied manually via Supabase Management API," but a live psql check found the
--    table did not exist in production at all -- every GET/POST /api/autoapply/mode
--    call 500'd, which cascaded into a visibly broken Draft Generator template picker
--    (stuck on a faded/disabled render) and a non-functional AutoApply Mode selector.
CREATE TABLE IF NOT EXISTS org_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  autoapply_mode text NOT NULL DEFAULT 'manual' CHECK (autoapply_mode IN ('manual', 'semi_auto', 'autonomous')),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE(organization_id)
);
ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_settings_org_select" ON org_settings;
CREATE POLICY "org_settings_org_select" ON org_settings
  FOR SELECT USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "org_settings_org_insert" ON org_settings;
CREATE POLICY "org_settings_org_insert" ON org_settings
  FOR INSERT WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "org_settings_org_update" ON org_settings;
CREATE POLICY "org_settings_org_update" ON org_settings
  FOR UPDATE USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_org_settings_org ON org_settings(organization_id);

-- 2. funder_relationship_scores (migration 038, extended 039) was live with a much
--    older/thinner shape (id, organization_id, funder_id, score, events,
--    last_updated_at, created_at) than either migration file or the real consuming
--    code (src/lib/agents/funder-relationship.ts, the Funders page, FunderDetail.tsx)
--    expects -- every read of relationship_score/trend/is_stale 400'd. Purely
--    additive: does not touch the score/events columns AG-19's relationship-builder-
--    agent.ts separately writes to on the same table.
ALTER TABLE funder_relationship_scores
  ADD COLUMN IF NOT EXISTS relationship_score integer NOT NULL DEFAULT 0 CHECK (relationship_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS total_interactions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS successful_applications integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS trend text NOT NULL DEFAULT 'neutral' CHECK (trend IN ('rising','falling','neutral')),
  ADD COLUMN IF NOT EXISTS recent_events jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS is_stale boolean NOT NULL DEFAULT false;

-- 3. competitor_tracking (migration 038, extended 040) had the same pattern: 040's
--    comment claimed "existing columns (opportunity_id, estimated_applicants,
--    competition_level) remain intact," but 038's original CREATE TABLE columns were
--    never actually applied live -- the Competitor Intelligence page 400'd.
ALTER TABLE competitor_tracking
  ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS estimated_applicants integer,
  ADD COLUMN IF NOT EXISTS competition_level text CHECK (competition_level IN ('low','medium','high','very_high')),
  ADD COLUMN IF NOT EXISTS observed_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_competitor_opportunity ON competitor_tracking (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_competitor_observed ON competitor_tracking (observed_at DESC);

-- 4. autoapply_review_queue.funder_id had a column but no FK constraint to funders,
--    so PostgREST could not embed funders(name) and the AutoApply page 400'd on its
--    review-queue query. Zero orphaned rows confirmed live before adding the FK.
ALTER TABLE autoapply_review_queue
  ADD CONSTRAINT autoapply_review_queue_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES funders(id);

-- 5. disaster_declarations / disaster_emergency_funds (src/supabase/migrations/
--    079_disaster_response.sql) were created with RLS never enabled and no explicit
--    grants -- later, an anon-grant remediation pass (see project memory
--    benavora-anon-grant-remediation-2026-08-03) enabled RLS on these tables as part
--    of a blanket hardening sweep, but being shared, non-org-scoped reference tables
--    (no organization_id column to key a per-org policy off), no SELECT policy was
--    ever added for them. Result: RLS enabled + zero policies + no authenticated
--    grant = every real user session got a hard "permission denied for table"
--    Postgres error, which the API route's own error handler then leaked verbatim
--    into the UI. The Disaster Response page was completely non-functional.
GRANT SELECT ON disaster_declarations TO authenticated;
GRANT SELECT ON disaster_emergency_funds TO authenticated;
DROP POLICY IF EXISTS "disaster_declarations_authenticated_select" ON disaster_declarations;
CREATE POLICY "disaster_declarations_authenticated_select" ON disaster_declarations
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "disaster_emergency_funds_authenticated_select" ON disaster_emergency_funds;
CREATE POLICY "disaster_emergency_funds_authenticated_select" ON disaster_emergency_funds
  FOR SELECT TO authenticated USING (true);

-- 6. Data backfill (not a schema change): 21 live `opportunities` rows (12 in `name`,
--    9 in `description`), all source='grants_gov' predating the ingestion client's
--    decodeHtmlEntities() call, had literal double-encoded HTML entities (e.g.
--    "Reception &amp; Placement Program" rendering the literal "&amp;" instead of
--    "&") visible on the Opportunities, Gap Analyzer, and Dashboard pages. One-time
--    backfill, safe to re-run (WHERE clause only matches rows still containing an
--    entity):
UPDATE opportunities SET name = regexp_replace(
  regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    name, '&amp;', '&', 'g'), '&lt;', '<', 'g'), '&gt;', '>', 'g'), '&#39;', '''', 'g'), '&quot;', '"', 'g')
WHERE name LIKE '%&amp;%' OR name LIKE '%&lt;%' OR name LIKE '%&gt;%' OR name LIKE '%&#39;%' OR name LIKE '%&quot;%' OR name LIKE '%&apos;%';

UPDATE opportunities SET description = regexp_replace(
  regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    description, '&amp;', '&', 'g'), '&lt;', '<', 'g'), '&gt;', '>', 'g'), '&#39;', '''', 'g'), '&quot;', '"', 'g')
WHERE description LIKE '%&amp;%' OR description LIKE '%&lt;%' OR description LIKE '%&gt;%' OR description LIKE '%&#39;%' OR description LIKE '%&quot;%';
