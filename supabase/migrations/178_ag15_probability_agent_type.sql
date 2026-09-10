-- Adds the missing 'ag-15-probability' value to the agent_type enum.
--
-- src/lib/agents/probability-scoring-agent.ts (AGENTS_v2.md AG-15, PLATFORM_
-- VISION_ARCHITECTURE.md Pillar 5) passes agentId="ag-15-probability" to
-- AutonomousAgent's constructor, which BaseAgent.startRun() writes into
-- agent_runs.agent_type. That column is backed by this Postgres enum, which
-- never had this literal added -- every real run of this agent fails at
-- startRun() with "invalid input value for enum agent_type" before any
-- scoring logic executes. Manual audit found exactly 1 agent_runs row for
-- this agent ever (a failure), which is the symptom, not a fluke.
--
-- The value keeps the agent's existing hyphenated literal rather than
-- renaming to the more common ag15_* convention (see migration 109's
-- ag22_propensity_scoring) because opportunity-discovery-agent.ts chains
-- into this agent via queueChainedAgent("ag-15-probability", ...) -- renaming
-- would require touching that call site's string too, for no functional
-- benefit. Migration 137 already established the precedent that agent_type
-- values may contain hyphens (ag-43-funder-signals).

alter type agent_type add value if not exists 'ag-15-probability';
