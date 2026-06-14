-- ============================================================================
-- Migration 033 — integration_keys table + Tier 6 agent_type values
--
-- SCHEMA_REGISTRY v2.0 §2.47 — encrypted API key storage for client-connected
-- services (SAM.gov, 2Captcha, Candid, Gmail, Resend, custom APIs).
--
-- Also adds the Tier 6 agent_type enum values needed by Phase A agents
-- (AGENTS.md Agents 15–29). Values are added idempotently via IF NOT EXISTS.
-- ============================================================================

-- Tier 6 agent types (Phase A–E research and intelligence agents).
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'grants_gov_research';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'sam_gov_research';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'propublica_mining';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'custom_api_research';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'custom_scrape_research';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'giving_history_extractor';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'success_probability';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'funder_relationship';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'competitor_intelligence';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'deadline_prediction';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'application_cloning';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'semantic_matching';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'follow_up_generator';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'automation_worker';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'csv_import';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'notification_dispatcher';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'financial_reconciliation';

-- integration_service enum for the integration_keys table.
DO $$ BEGIN
  CREATE TYPE integration_service AS ENUM (
    'sam_gov',
    'two_captcha',
    'candid',
    'gmail',
    'gcal',
    'resend',
    'custom_api'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Table 47: integration_keys — encrypted API key storage per SCHEMA_REGISTRY v2.0.
-- One row per organization + service. Keys are encrypted server-side before storage.
CREATE TABLE IF NOT EXISTS integration_keys (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES organizations(id),
  service_name      integration_service NOT NULL,
  encrypted_key     text        NOT NULL,
  is_active         boolean     DEFAULT true,
  last_validated_at timestamptz,
  validation_status text        DEFAULT 'pending',
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE(organization_id, service_name)
);

ALTER TABLE integration_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integration_keys_org" ON integration_keys
  USING (
    organization_id = (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_integ_keys_org ON integration_keys(organization_id);
