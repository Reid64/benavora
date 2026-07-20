-- Migration 096: agent_type enum value for RelationshipBuilderAgent (AG-19)
--
-- src/lib/agents/relationship-builder-agent.ts calls
-- super(orgId, "ag-19-relationship", supabase), and AutonomousAgent.startRun()
-- inserts agent_type unconditionally before any real work happens
-- (AGENTS_v2.md section 1.2). 'ag-19-relationship' was never added to the
-- agent_type enum (migration 001), so every run of this agent has failed at
-- startRun() before its per-funder scoring loop ever executed. Adding it here
-- follows the same one-migration-per-newly-wired-agent convention already
-- used for every other AutonomousAgent upgrade in this history (085, 086,
-- 088, 090, 091, 092, 093).

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-19-relationship';
