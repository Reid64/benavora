-- Migration 129: fix a second agent_registry/agent_configurations schema-drift
-- bug found live-verifying q27-001/002/003 (Agent Marketplace / Log Viewer),
-- 2026-08-07, immediately after 128's agent_configurations fix.
--
-- Same root cause as 128: 094_agent_registry.sql's `CREATE TABLE IF NOT EXISTS
-- agent_registry` silently no-op'd against the table already created by the
-- stray `src/supabase/migrations/075_agent_marketplace.sql`, which has no
-- `avg_tokens_per_run` column at all. `GET /api/agents/registry`'s SELECT
-- lists this column explicitly and 500s live today
-- (`42703: column agent_registry.avg_tokens_per_run does not exist`),
-- confirmed by a real authenticated request against production this session
-- (info@faithfoundationsf.org, the real Faith Foundation org) -- this is not
-- a compile-time or RLS gap, the column is genuinely absent.

ALTER TABLE agent_registry
  ADD COLUMN IF NOT EXISTS avg_tokens_per_run integer;
