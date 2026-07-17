-- Migration 094: agent_registry + agent_configurations (Pillar 17, Agent
-- Marketplace).
--
-- Deviations from the task-given spec, per this project's established practice
-- of checking real state before applying a literal migration spec (see 093's
-- header for the prior instance of this pattern):
--   - Path/number: a stray `src/supabase/migrations/075_agent_marketplace.sql`
--     already defines tables with these names, but `src/supabase/migrations/`
--     is a duplicate directory the Management API apply step never reads --
--     only `supabase/migrations/` is real, and that stray file was never
--     applied (no `agent_registry`/`agent_configurations` entries exist in
--     `src/types/database.ts`, and every other real table has one). This file
--     uses the real next-free number, 094, at the real path.
--   - `org_id` -> `organization_id` on agent_configurations: every org-scoped
--     table in this schema uses `organization_id`, FK'd to organizations(id);
--     the stray migration's `org_id` would be the only exception.
--   - agent_registry has no organization_id and no RLS, matching the
--     `state_portals` precedent (migration 010) for shared, admin-managed
--     reference tables that every authenticated user may read.
--   - Added a FK from agent_configurations.agent_id to agent_registry.agent_id,
--     an RLS policy on agent_configurations matching this schema's universal
--     org-scoping pattern, and an updated_at column for consistency with other
--     mutable tables -- all omitted by the task's literal SQL.

CREATE TABLE IF NOT EXISTS agent_registry (
  agent_id             text        PRIMARY KEY,
  name                 text        NOT NULL,
  description          text        NOT NULL,
  version              text        NOT NULL DEFAULT '1.0',
  plan_requirement     text        NOT NULL DEFAULT 'starter',
  trigger_type         text        NOT NULL DEFAULT 'manual',
  schedule_cron        text,
  avg_runtime_seconds  integer,
  avg_tokens_per_run   integer,
  active               boolean     NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_configurations (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id               text        NOT NULL REFERENCES agent_registry(agent_id) ON DELETE CASCADE,
  enabled                boolean     NOT NULL DEFAULT false,
  config                 jsonb       NOT NULL DEFAULT '{}',
  last_run_at            timestamptz,
  run_count              integer     NOT NULL DEFAULT 0,
  total_tokens_consumed  integer     NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, agent_id)
);

ALTER TABLE agent_configurations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_configurations_org" ON agent_configurations;
CREATE POLICY "agent_configurations_org" ON agent_configurations
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_agent_config_org ON agent_configurations(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_config_agent ON agent_configurations(agent_id);
