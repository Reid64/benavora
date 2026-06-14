-- Migration 039: Funder Relationship Agent (AGENTS.md Agent 23).
-- Adds agent_type enum value, plus trend/recent_events/is_stale columns to
-- funder_relationship_scores (table 50, created in migration 038).

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'funder_relationship';

ALTER TABLE funder_relationship_scores
  ADD COLUMN IF NOT EXISTS trend text NOT NULL DEFAULT 'neutral'
    CHECK (trend IN ('rising', 'falling', 'neutral')),
  ADD COLUMN IF NOT EXISTS recent_events jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS is_stale boolean NOT NULL DEFAULT false;
