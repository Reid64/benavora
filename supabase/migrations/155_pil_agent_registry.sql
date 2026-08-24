-- ============================================================================
-- BENAVORA - Migration 155: Prospect Intelligence Layer, PIL-01 Group 6 -- Agent Registry / Runs
--
-- Second of 4 sequential migrations (154-157) applying PROSPECT_INTELLIGENCE_SCHEMA.md
-- groups 5-8. See migration 154's header for the batch context.
--
-- pil_agent_registry is platform-level shared (one row per agent ID, identical across
-- every tenant) -- same pattern as the existing agent_registry table (migration 075,
-- hardened in migration 121). Seeded below with all 44 agent rows from
-- PROSPECT_INTELLIGENCE_AGENTS.md (Families 1-7 plus the cross-cutting Operations,
-- Evaluation & Learning agent). Text values use dollar-quoting ($$...$$) since several
-- contain apostrophes (e.g. "tenant's").
--
-- BEN-OPS-01's own spec states "default A1/A2" -- the CHECK constraint on
-- default_autonomy_level only accepts a single value, so this seed stores 'A1' (Research &
-- Recommend), matching the agent's own description ("may recommend... never applies
-- directly"); the full A1/A2 nuance is preserved in this agent's human_boundary text.
--
-- Deferred foreign keys in this file (pil_delegated_tasks, Group 7, is not part of this
-- batch until migration 156):
--   - pil_agent_runs.delegated_task_id -> pil_delegated_tasks(task_id)
-- Added via ALTER TABLE ... ADD CONSTRAINT in migration 156, once pil_delegated_tasks
-- exists (this is one half of the documented pil_agent_runs <-> pil_delegated_tasks
-- two-table cycle; the other half is pil_delegated_tasks.child_agent_run_id, which is
-- created directly below with its REFERENCES clause since pil_agent_runs already exists
-- by the time migration 156 runs).
--
-- Backfilling every agent_id-referencing FK deferred by migrations 150, 151, 153, and 154,
-- now that pil_agent_registry exists:
--   - pil_prospects.created_by_agent_id
--   - pil_prospect_digital_twins.last_updated_by_agent_id
--   - pil_prospect_opportunities.qualified_by_agent_id
--   - pil_entity_resolution_candidates.resolved_by_agent_id
--   - pil_identity_resolution_log.agent_id
--   - pil_evidence.agent_id
--   - pil_contradictions.investigated_by_agent_id
--   - pil_research_goals.owner_agent_id
--   - pil_research_runs.initiating_agent_id
-- Also backfilling pil_research_run_steps.agent_run_id -> pil_agent_runs(id), deferred by
-- migration 154 until this table exists.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 6.1 pil_agent_registry
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_agent_registry (
  agent_id                text PRIMARY KEY,
  name                    text NOT NULL,
  family                  text NOT NULL CHECK (family IN (
                            'supervisory', 'discovery', 'prospect_intelligence',
                            'relationship_intelligence', 'qualification', 'strategy',
                            'knowledge_integrity', 'operations_evaluation_learning'
                          )),
  mission                 text NOT NULL,
  default_autonomy_level  text NOT NULL CHECK (default_autonomy_level IN ('A0', 'A1', 'A2', 'A3', 'A4')),
  human_boundary          text,
  cadence                 text NOT NULL,
  version                 text NOT NULL DEFAULT '1.0',
  spec_ref                text NOT NULL,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pil_agent_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_agent_registry FROM anon;
CREATE POLICY pil_agent_registry_shared_select ON pil_agent_registry FOR SELECT TO authenticated USING (true);
-- No authenticated INSERT/UPDATE policy: the registry is seeded and maintained by the
-- service-role deploy pipeline only (this migration), matching agent_registry's own
-- administration model (migration 075/121).

INSERT INTO pil_agent_registry (agent_id, name, family, mission, default_autonomy_level, human_boundary, cadence, spec_ref) VALUES
('BEN-SUP-01', $$Chief Prospect Intelligence Orchestrator$$, 'supervisory', $$Own the persistent prospect-intelligence objective for each tenant and coordinate the entire research fleet.$$, 'A4', $$H1 for strategic changes outside tenant policy (e.g. widening scope beyond the tenant's configured cause/geography bounds).$$, $$Continuous.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-SUP-01$$),
('BEN-SUP-02', $$Research Strategy Architect$$, 'supervisory', $$Transform broad fundraising objectives into evidence-driven prospect-research strategies.$$, 'A2', $$H1 for fundamental fundraising strategy changes (e.g. redefining the tenant's core cause taxonomy).$$, $$On demand (triggered by a new natural-language objective) + periodic review (weekly).$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-SUP-02$$),
('BEN-SUP-03', $$Cross-Agent Research Planner$$, 'supervisory', $$Convert research strategy into dependency-aware multi-agent execution plans.$$, 'A4', $$H1 for workflows requiring actions beyond research authority (e.g. any step that would touch CRM write access or outbound contact).$$, $$Per objective / replan.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-SUP-03$$),
('BEN-SUP-04', $$Research Portfolio Allocator$$, 'supervisory', $$Allocate research resources toward prospects with the highest expected fundraising intelligence value.$$, 'A3', $$H1 for budget increases beyond tenant-configured limits.$$, $$Continuous / daily rebalance.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-SUP-04$$),
('BEN-SUP-05', $$Prospect Research Critic & Red-Team Agent$$, 'supervisory', $$Independently challenge consequential research findings before they become trusted intelligence.$$, 'A2', $$H1; cannot override policy or certify its own prior work (spec §12: a research-producing agent cannot certify its own high-impact conclusions -- this agent must run in a context separate from the agent whose work it reviews).$$, $$Per consequential dossier (any prospect approaching TIER_1_PRIORITY/TIER_2_CULTIVATE classification, or any pil_evidence row flagged verification_status IN (reasoned_inference, estimate) feeding a capacity or giving conclusion).$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-SUP-05$$),
('BEN-SUP-06', $$Research Recovery Investigator$$, 'supervisory', $$Diagnose failed, incomplete, contradictory, or corrupted research workflows and determine the safest recovery path.$$, 'A3', $$H1/H2 for irreversible destructive recovery (e.g. discarding a partially-completed research run's evidence rather than salvaging it).$$, $$Event-driven (triggered by a pil_agent_runs.status = failed, a pil_research_runs.status = failed, a Durable Workflow Orchestration dead-letter event, or a detected duplicate-execution signature).$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-SUP-06$$),

('BEN-DIS-01', $$Individual Prospect Discovery Agent$$, 'discovery', $$Discover individual philanthropic prospects matching tenant-defined fundraising objectives.$$, 'A2', $$none beyond standard A2 (dossiers/candidates only, no outreach).$$, $$Continuous / on demand.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-DIS-01$$),
('BEN-DIS-02', $$Major Donor Discovery Agent$$, 'discovery', $$Identify individuals with evidence suggesting capacity and propensity for significant philanthropic giving.$$, 'A2', NULL, $$Continuous / on demand.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-DIS-02$$),
('BEN-DIS-03', $$Foundation Discovery Agent$$, 'discovery', $$Discover private, family, corporate, and community foundations aligned with tenant programs.$$, 'A2', NULL, $$Continuous / on demand.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-DIS-03$$),
('BEN-DIS-04', $$Corporate Giving Discovery Agent$$, 'discovery', $$Identify companies with relevant charitable-giving, sponsorship, employee-giving, or community-investment programs.$$, 'A2', NULL, $$Continuous / on demand.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-DIS-04$$),
('BEN-DIS-05', $$Executive Prospect Discovery Agent$$, 'discovery', $$Identify executives, founders, owners, and senior decision-makers who may have philanthropic relevance.$$, 'A2', NULL, $$Continuous / on demand.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-DIS-05$$),
('BEN-DIS-06', $$Geographic Funding Discovery Agent$$, 'discovery', $$Discover prospects based on geographic relevance (e.g. "Texas philanthropists," "within 150 miles of Austin").$$, 'A2', NULL, $$Continuous / on demand.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-DIS-06$$),
('BEN-DIS-07', $$Cause-Aligned Prospect Discovery Agent$$, 'discovery', $$Discover prospects whose documented charitable interests align with the tenant's mission.$$, 'A2', NULL, $$Continuous / on demand.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-DIS-07$$),
('BEN-DIS-08', $$Hidden Prospect & CRM Rediscovery Agent$$, 'discovery', $$Identify overlooked high-potential prospects already present within first-party organizational data.$$, 'A2', $$no automatic solicitation escalation (spec §6: reclassification only, never triggers outreach itself).$$, $$Continuous / on demand, plus triggered on new CRM import.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-DIS-08$$),

('BEN-INT-01', $$Individual Intelligence Agent$$, 'prospect_intelligence', $$Build the canonical evidence-backed biographical intelligence profile for an individual prospect.$$, 'A2', NULL, $$Per prospect, on discovery + on monitoring-triggered refresh.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-INT-01$$),
('BEN-INT-02', $$Employment & Career Intelligence Agent$$, 'prospect_intelligence', $$Reconstruct the prospect's relevant professional history.$$, 'A2', NULL, $$Per prospect, on discovery + monitoring refresh.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-INT-02$$),
('BEN-INT-03', $$Business Ownership Intelligence Agent$$, 'prospect_intelligence', $$Investigate documented ownership, founder, partnership, and significant business relationships.$$, 'A2', NULL, $$Per prospect, on discovery + monitoring refresh (especially acquisition/company_sale triggers).$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-INT-03$$),
('BEN-INT-04', $$Education & Alumni Intelligence Agent$$, 'prospect_intelligence', $$Research educational affiliations relevant to relationship discovery or philanthropic behavior.$$, 'A2', NULL, $$Per prospect, on discovery.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-INT-04$$),
('BEN-INT-05', $$Nonprofit Board Intelligence Agent$$, 'prospect_intelligence', $$Identify and verify nonprofit board memberships and leadership roles.$$, 'A2', NULL, $$Per prospect, on discovery + monitoring refresh (board_appointment trigger).$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-INT-05$$),
('BEN-INT-06', $$Foundation Intelligence Agent$$, 'prospect_intelligence', $$Develop detailed intelligence on foundations associated with prospects.$$, 'A2', NULL, $$Per foundation prospect, on discovery + monitoring refresh (new_foundation_filing).$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-INT-06$$),
('BEN-INT-07', $$Giving History Intelligence Agent$$, 'prospect_intelligence', $$Reconstruct documented charitable-giving behavior.$$, 'A2', NULL, $$Per prospect, on discovery + monitoring refresh (major_charitable_gift).$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-INT-07$$),
('BEN-INT-08', $$Wealth & Capacity Intelligence Agent$$, 'prospect_intelligence', $$Evaluate evidence relevant to philanthropic capacity without treating estimated net worth as confirmed giving ability.$$, 'A2', $$H1 for sensitive/high-impact capacity determinations (any capacity range that would place a prospect in TIER_1_PRIORITY on capacity alone).$$, $$Per flagged prospect (from BEN-DIS-02 or BEN-DIS-08), on demand.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-INT-08$$),
('BEN-INT-09', $$Wealth Origin & Liquidity Event Agent$$, 'prospect_intelligence', $$Explain, with citations, the documented mechanisms through which substantial wealth or liquidity appears to have arisen.$$, 'A2', NULL, $$Per prospect with a flagged capacity signal, on demand + monitoring refresh (ipo/acquisition/company_sale).$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-INT-09$$),
('BEN-INT-10', $$Contact Intelligence Agent$$, 'prospect_intelligence', $$Identify permissible and relevant contact pathways.$$, 'A2', NULL, $$Per qualified/near-qualified prospect, on demand.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-INT-10$$),

('BEN-REL-01', $$Relationship Discovery Agent$$, 'relationship_intelligence', $$Discover documented relationships between prospects and relevant people or organizations.$$, 'A2', NULL, $$Per prospect, on discovery + monitoring refresh.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-REL-01$$),
('BEN-REL-02', $$Board Relationship Mapping Agent$$, 'relationship_intelligence', $$Analyze board and trustee networks for introduction opportunities.$$, 'A2', NULL, $$On demand (triggered by BEN-REL-01 delegation or a qualification workflow needing introduction pathways).$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-REL-02$$),
('BEN-REL-03', $$Corporate Relationship Mapping Agent$$, 'relationship_intelligence', $$Identify relationships connecting the tenant to corporations and decision-makers.$$, 'A2', NULL, $$On demand.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-REL-03$$),
('BEN-REL-04', $$Organizational Overlap Agent$$, 'relationship_intelligence', $$Identify shared organizational memberships among prospects and tenant-connected individuals.$$, 'A2', NULL, $$On demand + periodic batch sweep (weekly) across the active prospect pool.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-REL-04$$),
('BEN-REL-05', $$Warm Introduction Pathfinding Agent$$, 'relationship_intelligence', $$Find the strongest evidence-backed introduction path between the organization and a prospect.$$, 'A2', NULL, $$On demand (triggered when a prospect reaches TIER_1_PRIORITY/TIER_2_CULTIVATE).$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-REL-05$$),
('BEN-REL-06', $$Relationship Strength Agent$$, 'relationship_intelligence', $$Evaluate the practical strength and usefulness of identified relationship paths.$$, 'A2', NULL, $$On demand, called by BEN-REL-01/02/04/05.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-REL-06$$),

('BEN-QLF-01', $$Mission Affinity Agent$$, 'qualification', $$Determine how strongly documented philanthropic behavior aligns with the tenant mission.$$, 'A2', NULL, $$On demand, once Family 3/4 research reaches sufficiency for a prospect.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-QLF-01$$),
('BEN-QLF-02', $$Funding Eligibility Agent$$, 'qualification', $$Determine whether a foundation, corporation, or funding program is actually available to the tenant.$$, 'A2', NULL, $$On demand, per foundation/corporate prospect.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-QLF-02$$),
('BEN-QLF-03', $$Philanthropic Capacity & Propensity Agent$$, 'qualification', $$Combine capacity and behavior evidence without conflating them.$$, 'A2', NULL, $$On demand, once capacity (BEN-INT-08) and giving history (BEN-INT-07) are available.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-QLF-03$$),
('BEN-QLF-04', $$Opportunity Qualification Agent$$, 'qualification', $$Integrate research into a defensible fundraising-opportunity classification.$$, 'A3', NULL, $$On demand, as the final qualification step before a prospect enters Strategy family workflows.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-QLF-04$$),
('BEN-QLF-05', $$Timing & Readiness Agent$$, 'qualification', $$Determine whether the opportunity should be approached now, cultivated first, monitored, or deferred.$$, 'A2', NULL, $$On demand + monitoring-triggered re-evaluation.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-QLF-05$$),

('BEN-STR-01', $$Prospect Engagement Strategy Agent$$, 'strategy', $$Determine the most appropriate evidence-based engagement strategy for a qualified prospect.$$, 'A2', NULL, $$On demand, once a prospect reaches TIER_1_PRIORITY/TIER_2_CULTIVATE.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-STR-01$$),
('BEN-STR-02', $$Best First Ask Agent$$, 'strategy', $$Recommend an appropriate initial ask or engagement objective.$$, 'A2', $$H1, final solicitation decision always remains human.$$, $$On demand.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-STR-02$$),
('BEN-STR-03', $$Cultivation Strategy Agent$$, 'strategy', $$Create a multi-step relationship-development plan when immediate solicitation is not appropriate.$$, 'A2', NULL, $$On demand, when BEN-QLF-05/BEN-STR-01 indicate cultivate_first.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-STR-03$$),
('BEN-STR-04', $$Next-Best-Action Agent$$, 'strategy', $$Continuously determine the most valuable next action for each qualified opportunity.$$, 'A3', NULL, $$Continuous, per active pil_prospect_opportunities row.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-STR-04$$),

('BEN-KNW-01', $$Prospect Digital Twin Agent$$, 'knowledge_integrity', $$Maintain the living structured representation of each prospect.$$, 'A3', NULL, $$Continuous (updates on every accepted write from any Family 3/4/5/6 agent).$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-KNW-01$$),
('BEN-KNW-02', $$Entity Resolution Agent$$, 'knowledge_integrity', $$Reason through ambiguous identities and determine whether records refer to the same entity.$$, 'A3', $$H1 for sensitive/high-impact identity linkage (a merge that would materially change a prospect's giving-history attribution or capacity classification).$$, $$On demand (triggered by any agent surfacing an ambiguous match) + periodic batch sweep.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-KNW-02$$),
('BEN-KNW-03', $$Evidence & Provenance Verification Agent$$, 'knowledge_integrity', $$Verify that consequential claims are supported by permissible, traceable evidence.$$, 'A3', NULL, $$Continuous (runs against every new pil_evidence row feeding a consequential claim -- capacity, giving, qualification tier) + on-demand from BEN-SUP-05.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-KNW-03$$),
('BEN-KNW-04', $$Contradiction & Freshness Investigator$$, 'knowledge_integrity', $$Detect conflicting or outdated prospect information and determine what should remain canonical.$$, 'A3', NULL, $$Continuous (triggered on any two pil_evidence rows for the same claim_type/entity with divergent values) + periodic staleness sweep.$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-KNW-04$$),

('BEN-OPS-01', $$Agent Fleet Performance & Learning Agent$$, 'operations_evaluation_learning', $$Continuously evaluate whether the Prospect Intelligence agent fleet is actually improving research outcomes and determine where behaviors, routing, tools, or research strategies should be adjusted.$$, 'A1', $$may recommend but may not independently increase autonomy, change security/privacy policy, modify canonical facts, remove safety controls, or rewrite production governance (spec's own explicit boundary list for this agent). Spec states default autonomy as A1/A2; A1 stored here since the CHECK constraint accepts a single value.$$, $$Continuous + scheduled evaluation (nightly rollup, weekly deep review).$$, $$PROSPECT_INTELLIGENCE_AGENTS.md § BEN-OPS-01$$)
ON CONFLICT (agent_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6.2 pil_agent_runs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_agent_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id              text NOT NULL REFERENCES pil_agent_registry(agent_id),
  research_run_id       uuid REFERENCES pil_research_runs(id),
  delegated_task_id     uuid, -- FK -> pil_delegated_tasks(task_id) added once that table exists (migration 156)
  goal_id               uuid REFERENCES pil_research_goals(id),
  status                text NOT NULL DEFAULT 'queued' CHECK (status IN (
                           'queued', 'planning', 'running', 'observing', 'replanning',
                           'completed', 'blocked', 'failed', 'escalated'
                         )),
  autonomy_level_used   text CHECK (autonomy_level_used IN ('A0', 'A1', 'A2', 'A3', 'A4')),
  input                 jsonb NOT NULL DEFAULT '{}',
  output                jsonb,
  tokens_consumed       integer NOT NULL DEFAULT 0,
  cost_usd              numeric NOT NULL DEFAULT 0,
  started_at            timestamptz,
  completed_at          timestamptz,
  error                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_agent_runs_org_agent ON pil_agent_runs(organization_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_pil_agent_runs_status ON pil_agent_runs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_agent_runs_research_run ON pil_agent_runs(research_run_id);
CREATE INDEX IF NOT EXISTS idx_pil_agent_runs_delegated_task ON pil_agent_runs(delegated_task_id);

ALTER TABLE pil_agent_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_agent_runs FROM anon;
CREATE POLICY pil_agent_runs_org_select ON pil_agent_runs FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_agent_runs_org_insert ON pil_agent_runs FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_agent_runs_org_update ON pil_agent_runs FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 6.3 pil_agent_run_events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_agent_run_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id   uuid NOT NULL REFERENCES pil_agent_runs(id) ON DELETE CASCADE,
  event_type     text NOT NULL CHECK (event_type IN (
                    'tool_call', 'delegation_issued', 'evidence_collected', 'replan',
                    'escalation', 'budget_warning', 'stop_condition_met'
                  )),
  payload        jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_agent_run_events_run ON pil_agent_run_events(agent_run_id, created_at);

ALTER TABLE pil_agent_run_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_agent_run_events FROM anon;
CREATE POLICY pil_agent_run_events_select ON pil_agent_run_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pil_agent_runs r WHERE r.id = agent_run_id
      AND r.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));
CREATE POLICY pil_agent_run_events_insert ON pil_agent_run_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM pil_agent_runs r WHERE r.id = agent_run_id
      AND r.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));
-- No UPDATE/DELETE policy for any role: append-only by design.

-- ----------------------------------------------------------------------------
-- Backfill: pil_research_run_steps.agent_run_id -> pil_agent_runs(id)
-- Deferred by migration 154 until pil_agent_runs exists.
-- ----------------------------------------------------------------------------
ALTER TABLE pil_research_run_steps
  ADD CONSTRAINT pil_research_run_steps_agent_run_id_fkey
  FOREIGN KEY (agent_run_id) REFERENCES pil_agent_runs(id);

-- ----------------------------------------------------------------------------
-- Backfill: every agent_id-referencing FK deferred by migrations 150, 151, 153, and 154,
-- now that pil_agent_registry exists.
-- ----------------------------------------------------------------------------
ALTER TABLE pil_prospects
  ADD CONSTRAINT pil_prospects_created_by_agent_id_fkey
  FOREIGN KEY (created_by_agent_id) REFERENCES pil_agent_registry(agent_id);

ALTER TABLE pil_prospect_digital_twins
  ADD CONSTRAINT pil_prospect_digital_twins_last_updated_by_agent_id_fkey
  FOREIGN KEY (last_updated_by_agent_id) REFERENCES pil_agent_registry(agent_id);

ALTER TABLE pil_prospect_opportunities
  ADD CONSTRAINT pil_prospect_opportunities_qualified_by_agent_id_fkey
  FOREIGN KEY (qualified_by_agent_id) REFERENCES pil_agent_registry(agent_id);

ALTER TABLE pil_entity_resolution_candidates
  ADD CONSTRAINT pil_entity_resolution_candidates_resolved_by_agent_id_fkey
  FOREIGN KEY (resolved_by_agent_id) REFERENCES pil_agent_registry(agent_id);

ALTER TABLE pil_identity_resolution_log
  ADD CONSTRAINT pil_identity_resolution_log_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES pil_agent_registry(agent_id);

ALTER TABLE pil_evidence
  ADD CONSTRAINT pil_evidence_agent_id_fkey
  FOREIGN KEY (agent_id) REFERENCES pil_agent_registry(agent_id);

ALTER TABLE pil_contradictions
  ADD CONSTRAINT pil_contradictions_investigated_by_agent_id_fkey
  FOREIGN KEY (investigated_by_agent_id) REFERENCES pil_agent_registry(agent_id);

ALTER TABLE pil_research_goals
  ADD CONSTRAINT pil_research_goals_owner_agent_id_fkey
  FOREIGN KEY (owner_agent_id) REFERENCES pil_agent_registry(agent_id);

ALTER TABLE pil_research_runs
  ADD CONSTRAINT pil_research_runs_initiating_agent_id_fkey
  FOREIGN KEY (initiating_agent_id) REFERENCES pil_agent_registry(agent_id);
