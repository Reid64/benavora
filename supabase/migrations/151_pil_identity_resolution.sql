-- ============================================================================
-- BENAVORA - Migration 151: Prospect Intelligence Layer, PIL-01 Group 2 -- Identity / Resolution
--
-- Second of 4 sequential migrations (150-153) applying PROSPECT_INTELLIGENCE_SCHEMA.md
-- groups 1-4 verbatim. See migration 150's header for the full PIL-01 context and the
-- deferred-FK convention this migration also follows: any column that would reference
-- pil_agent_registry(agent_id) is created as a plain `text` column here, since
-- pil_agent_registry (Group 6) is not part of this batch. That constraint is added via
-- ALTER TABLE ... ADD CONSTRAINT once pil_agent_registry exists, in a later queue.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2.1 pil_entity_resolution_candidates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_entity_resolution_candidates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id_a        uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  prospect_id_b        uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  match_score          numeric CHECK (match_score BETWEEN 0 AND 1),
  status               text NOT NULL DEFAULT 'unresolved' CHECK (status IN (
                          'match', 'probable_match', 'unresolved', 'not_match'
                        )),
  evidence             jsonb NOT NULL DEFAULT '{}',
  resolved_by_agent_id text, -- FK -> pil_agent_registry(agent_id) added once that table exists (later queue)
  resolved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pil_resolution_candidates_distinct CHECK (prospect_id_a <> prospect_id_b)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pil_resolution_pair ON pil_entity_resolution_candidates(
  LEAST(prospect_id_a, prospect_id_b), GREATEST(prospect_id_a, prospect_id_b)
);
CREATE INDEX IF NOT EXISTS idx_pil_resolution_status ON pil_entity_resolution_candidates(organization_id, status);

ALTER TABLE pil_entity_resolution_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_entity_resolution_candidates FROM anon;
CREATE POLICY pil_resolution_org_select ON pil_entity_resolution_candidates FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_resolution_org_insert ON pil_entity_resolution_candidates FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_resolution_org_update ON pil_entity_resolution_candidates FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 2.2 pil_entity_aliases
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_entity_aliases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id   uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  alias_type    text NOT NULL CHECK (alias_type IN (
                   'name_variant', 'email', 'org_name', 'ein', 'crm_id', 'external_id'
                 )),
  alias_value   text NOT NULL,
  source        text,
  confidence    numeric CHECK (confidence BETWEEN 0 AND 1),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_aliases_prospect ON pil_entity_aliases(prospect_id);
CREATE INDEX IF NOT EXISTS idx_pil_aliases_value ON pil_entity_aliases(organization_id, alias_type, alias_value);

ALTER TABLE pil_entity_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_entity_aliases FROM anon;
CREATE POLICY pil_aliases_org_select ON pil_entity_aliases FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_aliases_org_insert ON pil_entity_aliases FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 2.3 pil_identity_resolution_log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_identity_resolution_log (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action                 text NOT NULL CHECK (action IN ('merge', 'split', 'link', 'unlink')),
  primary_prospect_id    uuid NOT NULL REFERENCES pil_prospects(id),
  secondary_prospect_id  uuid REFERENCES pil_prospects(id),
  agent_id               text, -- FK -> pil_agent_registry(agent_id) added once that table exists (later queue)
  rationale               text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_id_resolution_log_prospect ON pil_identity_resolution_log(primary_prospect_id);

ALTER TABLE pil_identity_resolution_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_identity_resolution_log FROM anon;
CREATE POLICY pil_id_res_log_org_select ON pil_identity_resolution_log FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_id_res_log_org_insert ON pil_identity_resolution_log FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
