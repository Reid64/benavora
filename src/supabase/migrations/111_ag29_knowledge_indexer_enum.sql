-- Migration 111 — AG-29 Knowledge Engine Indexer Agent
-- (src/lib/agents/knowledge-indexer-agent.ts, agentId "ag-29-knowledge-indexer").
--
-- Two things, both confirmed missing live before this migration (checked via
-- `psql "$DATABASE_URL"`, not assumed from a prior migration file):
--   1. 'ag-29-knowledge-indexer' was not a value in the `agent_type` enum -
--      every AutonomousAgent subclass's startRun() inserts agent_type
--      unconditionally as the very first line of run(), so this would fail
--      every run with 22P02 (the same class of bug documented throughout
--      AGENTS_v2.md §1.2 / AGENT_VERIFICATION_LOG.md for ~15 other agent
--      literals, already fixed for those via fix-agent-type-enum-gap.sql).
--   2. The well-known "system organization" row this agent uses as its FK
--      target for agent_runs/agent_decisions/agent_queue (since it is
--      platform-wide, not org-scoped - same shape as AG-36/AG-38) did not
--      exist. Seeded directly here so the agent's first run in any
--      environment never has to lazily provision it under load; the agent
--      also defensively re-checks/creates it itself (ensureSystemOrg()),
--      matching AG-36/AG-38's own belt-and-suspenders convention.

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-29-knowledge-indexer';

INSERT INTO organizations (id, name, onboarding_completed)
VALUES (
  '00000000-0000-4000-8000-000000000029',
  'Benavora Platform (System - AG-29 Knowledge Indexer)',
  true
)
ON CONFLICT (id) DO NOTHING;
