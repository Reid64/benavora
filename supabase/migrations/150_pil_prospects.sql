-- ============================================================================
-- BENAVORA - Migration 150: Prospect Intelligence Layer, PIL-01 Group 1 -- Prospects
--
-- First of 4 sequential migrations (150-153) applying PROSPECT_INTELLIGENCE_SCHEMA.md
-- groups 1-4 verbatim. Per PIL_MIGRATION_PLAN.md: target tree is `supabase/migrations/`
-- (root, confirmed live-applied), next-free number was 150, zero `pil_*` name collisions,
-- pg_trgm/pgcrypto already installed live (this CREATE EXTENSION is a no-op, kept for
-- idempotency per the schema doc's own convention).
--
-- Deferred foreign keys (see PROSPECT_INTELLIGENCE_SCHEMA.md "Cross-group foreign key
-- summary"): every column below that would reference pil_agent_registry(agent_id) is
-- created as a plain `text` column without the REFERENCES clause, because
-- pil_agent_registry (Group 6) is not part of this migration batch and its own queue has
-- not run yet. Those constraints are added via ALTER TABLE ... ADD CONSTRAINT once
-- pil_agent_registry exists, in that later queue -- not here.
--
-- pil_prospect_classifications.evidence_id is likewise created as a plain `uuid` column
-- without REFERENCES pil_evidence(id): pil_evidence is created later in this same batch
-- (migration 153), but per the task instructions this FK is intentionally deferred
-- further still, to pil-01-005 once pil_research_runs also exists, rather than added
-- immediately after 153.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- 1.1 pil_prospects
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_prospects (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type             text NOT NULL CHECK (entity_type IN (
                             'individual', 'family_foundation', 'private_foundation',
                             'community_foundation', 'corporate_foundation', 'corporation',
                             'executive', 'business_owner', 'board_member', 'trustee',
                             'wealth_holder', 'community_leader', 'institutional_funder', 'other'
                           )),
  display_name            text NOT NULL,
  canonical_name           text NOT NULL,
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN (
                             'active', 'archived', 'merged'
                           )),
  merged_into_prospect_id uuid REFERENCES pil_prospects(id),
  source_of_record        text NOT NULL DEFAULT 'discovery' CHECK (source_of_record IN (
                             'discovery', 'crm_import', 'manual', 'rediscovery'
                           )),
  created_by_agent_id     text, -- FK -> pil_agent_registry(agent_id) added once that table exists (later queue)
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_prospects_org ON pil_prospects(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_prospects_entity_type ON pil_prospects(organization_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_pil_prospects_merged_into ON pil_prospects(merged_into_prospect_id) WHERE merged_into_prospect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pil_prospects_canonical_name_trgm ON pil_prospects USING gin (canonical_name gin_trgm_ops);

ALTER TABLE pil_prospects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_prospects FROM anon;
CREATE POLICY pil_prospects_org_select ON pil_prospects FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_prospects_org_insert ON pil_prospects FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_prospects_org_update ON pil_prospects FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 1.2 pil_prospect_digital_twins
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_prospect_digital_twins (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id             uuid NOT NULL UNIQUE REFERENCES pil_prospects(id) ON DELETE CASCADE,
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  twin_version            integer NOT NULL DEFAULT 1,
  identity                jsonb NOT NULL DEFAULT '{}',
  biography               jsonb NOT NULL DEFAULT '{}',
  organizations_summary   jsonb NOT NULL DEFAULT '[]',
  companies               jsonb NOT NULL DEFAULT '[]',
  foundations             jsonb NOT NULL DEFAULT '[]',
  giving_history          jsonb NOT NULL DEFAULT '[]',
  wealth_indicators       jsonb NOT NULL DEFAULT '{}',
  relationships_summary   jsonb NOT NULL DEFAULT '[]',
  evidence_summary        jsonb NOT NULL DEFAULT '{}',
  timeline                jsonb NOT NULL DEFAULT '[]',
  affinity                jsonb NOT NULL DEFAULT '{}',
  capacity                jsonb NOT NULL DEFAULT '{}',
  opportunities_summary   jsonb NOT NULL DEFAULT '[]',
  research_gaps           jsonb NOT NULL DEFAULT '[]',
  contradictions_summary  jsonb NOT NULL DEFAULT '[]',
  current_strategy        jsonb NOT NULL DEFAULT '{}',
  monitoring_events_summary jsonb NOT NULL DEFAULT '[]',
  completeness_score      numeric CHECK (completeness_score BETWEEN 0 AND 1),
  last_updated_by_agent_id text, -- FK -> pil_agent_registry(agent_id) added once that table exists (later queue)
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_twins_org ON pil_prospect_digital_twins(organization_id);
CREATE INDEX IF NOT EXISTS idx_pil_twins_completeness ON pil_prospect_digital_twins(organization_id, completeness_score);

ALTER TABLE pil_prospect_digital_twins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_prospect_digital_twins FROM anon;
CREATE POLICY pil_twins_org_select ON pil_prospect_digital_twins FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_twins_org_insert ON pil_prospect_digital_twins FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_twins_org_update ON pil_prospect_digital_twins FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 1.3 pil_prospect_classifications
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_prospect_classifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id      uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  dimension        text NOT NULL CHECK (dimension IN (
                      'cause', 'geography', 'affiliation', 'wealth_indicator', 'other'
                    )),
  value            text NOT NULL,
  confidence       numeric CHECK (confidence BETWEEN 0 AND 1),
  evidence_id      uuid, -- FK -> pil_evidence(id) deferred to pil-01-005 once pil_research_runs also exists
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_classifications_prospect ON pil_prospect_classifications(prospect_id, dimension);
CREATE INDEX IF NOT EXISTS idx_pil_classifications_value ON pil_prospect_classifications(organization_id, dimension, value);

ALTER TABLE pil_prospect_classifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_prospect_classifications FROM anon;
CREATE POLICY pil_classifications_org_select ON pil_prospect_classifications FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_classifications_org_insert ON pil_prospect_classifications FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 1.4 pil_prospect_opportunities
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_prospect_opportunities (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id              uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  classification           text NOT NULL DEFAULT 'research_more' CHECK (classification IN (
                              'tier_1_priority', 'tier_2_cultivate', 'tier_3_monitor',
                              'research_more', 'low_probability', 'ineligible', 'disqualified'
                            )),
  mission_affinity_score   numeric CHECK (mission_affinity_score BETWEEN 0 AND 1),
  capacity_estimate_low    numeric,
  capacity_estimate_high   numeric,
  recommended_ask_low      numeric,
  recommended_ask_high     numeric,
  timing_status            text CHECK (timing_status IN (
                              'approach_now', 'cultivate_first', 'monitor', 'defer'
                            )),
  engagement_strategy      text,
  confidence               numeric CHECK (confidence BETWEEN 0 AND 1),
  qualified_by_agent_id    text, -- FK -> pil_agent_registry(agent_id) added once that table exists (later queue)
  qualified_at             timestamptz,
  status                   text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed_won', 'closed_lost')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_prospect_opps_org ON pil_prospect_opportunities(organization_id, classification, status);
CREATE INDEX IF NOT EXISTS idx_pil_prospect_opps_prospect ON pil_prospect_opportunities(prospect_id);

ALTER TABLE pil_prospect_opportunities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_prospect_opportunities FROM anon;
CREATE POLICY pil_prospect_opps_org_select ON pil_prospect_opportunities FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_prospect_opps_org_insert ON pil_prospect_opportunities FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_prospect_opps_org_update ON pil_prospect_opportunities FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
