-- Migration 108 — adds 'ag-10-grant-dna' to the agent_type enum (AGENTS_v2.md
-- §1.2's enum-gap pattern, same root cause as the 15-value fix in
-- fix-agent-type-enum-gap.sql and the follow-up ag-18-reputation/
-- ag-32-relationship-graph fix, per AGENT_VERIFICATION_LOG.md). Without this,
-- GrantDnaAgent.startRun() (src/lib/agents/grant-dna-agent.ts) fails
-- immediately on its first agent_runs insert with
-- "22P02: invalid input value for enum agent_type" on every trigger path.

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-10-grant-dna';
