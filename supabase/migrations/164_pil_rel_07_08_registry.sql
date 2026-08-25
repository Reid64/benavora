-- ============================================================================
-- BENAVORA - Migration 164: Prospect Intelligence Layer -- BEN-REL-07/08 registry seed
--
-- Seeds pil_agent_registry rows for BEN-REL-07 (Foundation Relationship
-- Mapping) and BEN-REL-08 (Professional Connection Mapping). Neither agent
-- appears in PROSPECT_INTELLIGENCE_AGENTS.md -- that document's Family 4
-- (Relationship & Graph Intelligence) defines exactly 6 agents, BEN-REL-01
-- through BEN-REL-06 (confirmed against the document's own agent-count
-- table, "| Relationship & Graph Intelligence | 6 | BEN-REL-01 .. BEN-REL-06
-- |"), and the platform's agent registry (migration 155) has no BEN-REL-07/
-- 08 rows. A task spec directed building 8 Relationship-family agents with
-- concrete behavioral requirements for all 8; REL-01 through REL-06 were
-- reconciled against the live 6-agent registry/spec (see BEN-REL-05.ts's and
-- BEN-REL-06.ts's headers), leaving two of the task's eight missions
-- (Foundation Relationship Mapping, Professional Connection Mapping)
-- unbuilt. They are registered here as the fleet's 47th/48th agents --
-- without a pil_agent_registry row, AgentRunner.run()'s loadAgent() throws
-- AgentNotFoundError for any unregistered agent_id, so the implementations
-- in src/lib/pil/agents/rel/BEN-REL-07.ts and BEN-REL-08.ts could never
-- actually execute without this seed. Same resolution this codebase already
-- applied to BEN-SUP-07/08 (migration 163).
-- ============================================================================

INSERT INTO pil_agent_registry (agent_id, name, family, mission, default_autonomy_level, human_boundary, cadence, spec_ref)
VALUES
('BEN-REL-07', $$Foundation Relationship Mapping Agent$$, 'relationship_intelligence', $$Map foundation networks -- trustees, grant recipients, associated family members, and co-funders -- using 990 data extensively.$$, 'A2', NULL, $$On demand, per foundation-type prospect.$$, $$Task-directed addition, PIL-03 batch (not present in PROSPECT_INTELLIGENCE_AGENTS.md's Family 4 6-agent list)$$),
('BEN-REL-08', $$Professional Connection Mapping Agent$$, 'relationship_intelligence', $$For a prospect, find colleagues at the same companies, co-authors on publications, co-panelists at events, and co-board members.$$, 'A2', NULL, $$On demand, per prospect.$$, $$Task-directed addition, PIL-03 batch (not present in PROSPECT_INTELLIGENCE_AGENTS.md's Family 4 6-agent list)$$)
ON CONFLICT (agent_id) DO NOTHING;
