-- Migration 109 — adds agent_runs.output_payload (defined in migration 080's
-- original schema but never applied live — same "some of a migration's DDL
-- landed, some silently didn't" pattern already found for agent_decisions in
-- migration 104, per AGENT_VERIFICATION_LOG.md).
--
-- Found live 2026-08-03 while verifying AG-10 (GrantDnaAgent): every
-- AutonomousAgent.completeRun() call that passes `outputPayload` builds an
-- UPDATE against agent_runs including an output_payload column that doesn't
-- exist. PostgREST rejects the whole UPDATE, but completeRun() never checks
-- for an error (see autonomous-base.ts), so the failure is completely
-- silent — the agent_runs row is left stuck at status='running',
-- completed_at=null forever, even though the agent's real work (decisions,
-- profile writes) already succeeded. Confirmed live-reproduced for AG-10;
-- by grep this also silently affects every completeRun() call passing
-- outputPayload: autonomous-digest-agent.ts (live, 7AM digest pipeline),
-- strategic-advisor-agent.ts (live, nightly 2AM sweep), fundability-scorer-
-- agent.ts, learning-network-aggregator-agent.ts.

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS output_payload jsonb DEFAULT '{}';
