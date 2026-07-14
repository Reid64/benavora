-- Migration 080: org_settings - per-org platform settings, starting with AutoApply mode.
-- Applied manually via Supabase Management API (see project memory: prod DDL path).

CREATE TABLE IF NOT EXISTS org_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  autoapply_mode text NOT NULL DEFAULT 'manual' CHECK (autoapply_mode IN ('manual', 'semi_auto', 'autonomous')),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE(organization_id)
);

ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_settings_org_select" ON org_settings
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "org_settings_org_insert" ON org_settings
  FOR INSERT WITH CHECK (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "org_settings_org_update" ON org_settings
  FOR UPDATE USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_org_settings_org ON org_settings(organization_id);
