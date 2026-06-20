-- Migration 049: auto_queue_config table for AutoApply autonomous queue population.
-- Applied manually via Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS auto_queue_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  max_per_batch integer NOT NULL DEFAULT 50,
  schedule text NOT NULL DEFAULT 'nightly',
  categories text[],
  geographic_scope text[],
  min_company_size text,
  exclusion_list uuid[],
  dedup_window_days integer NOT NULL DEFAULT 30,
  last_run_at timestamptz,
  last_run_queued integer DEFAULT 0,
  last_run_skipped integer DEFAULT 0,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE(organization_id)
);

ALTER TABLE auto_queue_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auto_queue_config_org" ON auto_queue_config
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_auto_queue_config_org ON auto_queue_config(organization_id);
