-- ============================================================================
-- BENAVORA - Migration 157: Prospect Intelligence Layer, PIL-01 Group 8 -- Source Registry
--
-- Fourth of 4 sequential migrations (154-157) applying PROSPECT_INTELLIGENCE_SCHEMA.md
-- groups 5-8, closing out this PIL-01 batch (150-157, all 12 schema groups / 31 tables).
-- See migration 154's header for the batch context.
--
-- pil_source_registry is platform-level shared (the catalog of what sources exist and
-- their permissibility status is identical across tenants), matching the same
-- shared-reference-table pattern as pil_agent_registry (migration 155) and the existing
-- agent_registry table (migration 075/121). No deferred foreign keys in this file --
-- every column here references either organizations (already live) or a table created
-- earlier in this same migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 8.1 pil_source_registry
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_source_registry (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key            text NOT NULL UNIQUE,
  source_name           text NOT NULL,
  source_type           text NOT NULL CHECK (source_type IN (
                           'open_web', 'public_records', 'news', 'nonprofit_filing',
                           'irs_form_990', 'sec_edgar', 'corporate_information',
                           'foundation_information', 'licensed_database', 'permitted_api',
                           'crm', 'internal'
                         )),
  provider              text,
  permissibility_status text NOT NULL DEFAULT 'restricted' CHECK (permissibility_status IN (
                           'permitted', 'restricted', 'prohibited'
                         )),
  tos_notes             text,
  rate_limit_per_minute integer,
  cost_per_call         numeric,
  requires_license      boolean NOT NULL DEFAULT false,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_source_registry_type ON pil_source_registry(source_type, active);

ALTER TABLE pil_source_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_source_registry FROM anon;
CREATE POLICY pil_source_registry_shared_select ON pil_source_registry FOR SELECT TO authenticated USING (true);
-- No authenticated write policy: seeded/maintained by the service-role deploy pipeline,
-- same administration model as pil_agent_registry (migration 155) and the existing
-- agent_registry table.

-- ----------------------------------------------------------------------------
-- 8.2 pil_source_provider_credentials
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_source_provider_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid REFERENCES organizations(id) ON DELETE CASCADE,
  source_id         uuid NOT NULL REFERENCES pil_source_registry(id),
  credential_ref    text NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  last_verified_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_provider_creds_source ON pil_source_provider_credentials(source_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_provider_creds_org ON pil_source_provider_credentials(organization_id) WHERE organization_id IS NOT NULL;

ALTER TABLE pil_source_provider_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_source_provider_credentials FROM anon;
CREATE POLICY pil_provider_creds_select ON pil_source_provider_credentials FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_provider_creds_insert ON pil_source_provider_credentials FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_provider_creds_update ON pil_source_provider_credentials FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
