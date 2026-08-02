-- Migration 104 — restore agent_decisions to its migration-080 definition
--
-- Live production agent_decisions (project vbjplpquqxxfbpazyalt) is missing
-- 3 of the 16 columns 080_autonomous_agent_infrastructure.sql defines:
-- agent_run_id, action_payload, human_reviewer_id. Confirmed via the live
-- PostgREST OpenAPI schema (GET /rest/v1/ with Accept: application/openapi+json),
-- not just the surface error message — only action_payload showed up in the
-- error AutonomousAgent.logDecision() actually hit (AGENT_VERIFICATION_LOG.md,
-- AG-17 re-run entry), but agent_run_id is also written by that same insert
-- and would have failed next with an identical error had action_payload alone
-- been added. Same "some of a migration's DDL landed live, some silently
-- didn't" pattern already documented for the agent_type enum gap and
-- migrations 093/088 -- this table's own CREATE TABLE apparently ran, but a
-- later ALTER/portion of 080 (or the statement batch that created it) lost
-- these three columns somewhere along the way.
--
-- agent_run_id and action_payload are load-bearing: AutonomousAgent.logDecision()
-- (src/lib/agents/autonomous-base.ts) writes both on every call, for every
-- Generation-2 autonomous agent, not just AG-17 (AG-17 was simply the first
-- agent in the AG-15/17/19/25/28/30 re-verification run whose business logic
-- happened to reach a logDecision() call). human_reviewer_id is not currently
-- written by any code path but is part of the original table's documented
-- shape (set later by a human-review action) -- restored for parity, not
-- because anything is blocked on it today.
--
-- Applied directly via the working DATABASE_URL psql connection
-- (STANDING_DIRECTIVES.md DIRECTIVE-017), each statement separately.

ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS agent_run_id uuid REFERENCES agent_runs(id);

ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS action_payload jsonb DEFAULT '{}';

ALTER TABLE agent_decisions ADD COLUMN IF NOT EXISTS human_reviewer_id uuid REFERENCES profiles(id);
