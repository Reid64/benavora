-- 085_fundraising_simulator.sql
-- AG-37 Simulation Agent substrate (AUTONOMOUS_PLATFORM_VISION.md Phase 4,
-- "Predictive Fundraising Simulator"; AGENTS_v2.md AG-37 spec).
--
-- Migration number: real on-disk migrations in this repo stop at 084
-- (085_fundraising_simulator.sql is genuinely the next free file) even
-- though SCHEMA_REGISTRY_v2.md's index claims numbers into the high 090s
-- for older Pillar work. Per project convention, verify next-free-number
-- against real files on disk before applying, not against the doc's index.
--
-- KNOWN CONFLICT, not resolved here: this table is a near-duplicate of the
-- already-live `impact_simulations` table (migration 078_forecast_board.sql
-- -- org_id, scenario_type, scenario_params, simulation_result, confidence,
-- generated_at). Three governance documents describe the "Predictive
-- Fundraising Simulator" / AG-37 concept as an EXTENSION of impact_simulations
-- (add a `scenario_comparison_id` column) rather than a new table:
--   - BLUEPRINT_v2.md Phase 4 Architecture: "extends `impact_simulations`
--     with `scenario_comparison_id`... extends AG-28"
--   - AGENTS_v2.md AG-37 spec, Dependencies: "this feature has no new agent
--     number - it is explicitly 'Extends AG-28,' not a distinct agent"
--   - AUTONOMOUS_PLATFORM_VISION.md §7 Phase 4 FORGE blueprint table,
--     "Predictive Fundraising Simulator" row
-- This also runs against Core Data Principle #1 (SCHEMA_REGISTRY_v2.md §4.2):
-- "Every entity has one source of truth table. Never duplicate across
-- tables." The task that produced this migration specified the
-- `simulation_scenarios` schema below verbatim, so it is applied as
-- instructed - flagged here per the same disclose-don't-silently-comply
-- convention already used in this codebase (see the numbering-collision
-- header in src/lib/agents/learning-network-aggregator-agent.ts). Anyone
-- consolidating Phase 4 simulation work later should treat
-- `impact_simulations` as the source of truth and consider migrating
-- `simulation_scenarios` rows into it rather than running both forward.

-- Extends the agent_type enum so AG-37's agent_runs inserts succeed. Without
-- this, SimulationAgent.startRun() would hit the same enum-gap failure mode
-- documented in AGENTS_v2.md §1.2 for the other 12 unreachable Generation-2
-- agents (ag-02, ag-03-deadline-extraction, ag-04-fit-analysis, ag-05-draft,
-- ag-06-budget-builder, ag-07-compliance-check, ag-15-probability,
-- ag-17-discovery, ag-19-relationship, ag-25-deadline-prediction,
-- ag-28-followup, ag-digest, plus ag-36-learning-network). Using the
-- disambiguated literal "ag-37-simulation" rather than a bare "ag-37" for
-- the same reason ag-36-learning-network avoided a bare "ag-36" - see
-- AGENTS_v2.md §1.4/Phase 2-5 numbering note: the vision doc's own AG-37
-- names a completely different agent (Autonomous Multi-Agent Negotiation,
-- extending AG-12/AutoApply), not this one.
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-37-simulation';

CREATE TABLE IF NOT EXISTS simulation_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scenario_name text NOT NULL,
  scenario_type text NOT NULL CHECK (scenario_type IN ('board_expansion','staff_hire','geographic_expansion','new_program','budget_increase','partnership')),
  variables jsonb NOT NULL DEFAULT '{}',
  projected_revenue numeric,
  projected_grants integer,
  probability_improvement numeric,
  cost_estimate numeric,
  roi_multiple numeric,
  payback_months integer,
  risk_factors jsonb DEFAULT '[]',
  confidence text CHECK (confidence IN ('high','medium','low')),
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_simulation_scenarios_org ON simulation_scenarios(org_id, generated_at DESC);

ALTER TABLE simulation_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sim_org ON simulation_scenarios;
CREATE POLICY sim_org ON simulation_scenarios
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
