-- 082_ag08_ag12_autonomous_agents.sql
-- Schema support for AG-08 through AG-12 (renewal tracker, outcome analyzer,
-- document expiry, knowledge gap, search profile optimizer) - all built on
-- AutonomousAgent (src/lib/agents/autonomous-base.ts, migration 080
-- infrastructure).
--
-- 1. organizations.analytics: AG-09 (Outcome Analyzer) upserts a rollup of
--    successRateByCategory / averageAwardSize / dollarEfficiency /
--    insightSummary here. No such column existed anywhere in the schema.
--
-- 2. agent_type enum: agent_runs.agent_type is a strict Postgres enum
--    (migration 001), extended piecemeal via ALTER TYPE ... ADD VALUE
--    throughout the migration history (see 005, 018, 033, 037-040, etc).
--    AutonomousAgent.startRun() inserts agent_type = this.agentId directly,
--    so each of these 5 agents' constructor ids must be valid enum members
--    or every agent_runs insert they make fails at the database. Adding only
--    the 5 new values this task introduces (pre-existing gaps for
--    'ag-25-deadline-prediction' / 'ag-28-followup' predate this migration
--    and are out of scope here).

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS analytics jsonb DEFAULT '{}';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-08-renewal-tracker';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-09-outcome-analyzer';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-10-document-expiry';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-11-knowledge-gap';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-12-search-optimizer';
