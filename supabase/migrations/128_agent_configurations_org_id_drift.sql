-- Migration 128: fix agent_configurations column-name drift found live-verifying
-- q27-001/002/003 (Agent Marketplace / Log Viewer), 2026-08-07.
--
-- 094_agent_registry.sql's `CREATE TABLE IF NOT EXISTS agent_configurations`
-- silently no-op'd in production: a table with this name already existed,
-- created by the stray `src/supabase/migrations/075_agent_marketplace.sql`
-- (a duplicate-tree file, never meant to be the applied one), with `org_id`
-- instead of `organization_id` and no `updated_at` column. Every route this
-- session verifies (`GET /api/agents/registry`, `POST
-- /api/agents/registry/configure`) was written against 094's real,
-- documented `organization_id`/`updated_at` shape and 500s live today because
-- neither column exists on the actual table.
--
-- Fix: bring the live table in line with 094's real, intended shape rather
-- than reverting the application code to the stray file's column name --
-- every other org-scoped table in this schema uses `organization_id`
-- (094's own header comment already states this explicitly), so `org_id`
-- would be the sole exception if kept.

ALTER TABLE agent_configurations RENAME COLUMN org_id TO organization_id;

ALTER TABLE agent_configurations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE agent_configurations
  ADD CONSTRAINT agent_configurations_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES agent_registry(agent_id) ON DELETE CASCADE;

-- Consolidate the 4 separate org_id-named policies (auto-renamed in-place by
-- the column RENAME above, still functionally correct) into 094's single
-- unified policy, for consistency with every other org-scoped table's RLS
-- pattern in this schema.
DROP POLICY IF EXISTS "agent_configurations_org_select" ON agent_configurations;
DROP POLICY IF EXISTS "agent_configurations_org_insert" ON agent_configurations;
DROP POLICY IF EXISTS "agent_configurations_org_update" ON agent_configurations;
DROP POLICY IF EXISTS "agent_configurations_org_delete" ON agent_configurations;
DROP POLICY IF EXISTS "agent_configurations_org" ON agent_configurations;

CREATE POLICY "agent_configurations_org" ON agent_configurations
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_agent_config_org ON agent_configurations(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_config_agent ON agent_configurations(agent_id);
