-- Migration 090: Community Need Prediction (AG-35)
-- Phase 3 per AUTONOMOUS_PLATFORM_VISION.md "Community Need Prediction" /
-- AGENTS_v2.md AG-35 (Community Need Predictor). Directly extends the Faith
-- Foundation pilot's rural Texas emergency/transitional housing use case
-- with a needs-forecasting signal table, matching the "surfaces, never
-- submits" pattern AGENTS_v2.md documents for this agent.

CREATE TABLE IF NOT EXISTS community_need_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  signal_source text NOT NULL CHECK (signal_source IN ('census','housing_prices','employment','eviction_data','weather','disaster','school_enrollment','migration','economic')),
  signal_category text NOT NULL,
  signal_description text NOT NULL,
  geographic_area text,
  trend_direction text CHECK (trend_direction IN ('increasing','decreasing','stable','spike')),
  severity text CHECK (severity IN ('critical','high','medium','low')),
  predicted_demand_increase integer,
  recommended_program_expansion text,
  data_date date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE community_need_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cnp_org ON community_need_signals;
CREATE POLICY cnp_org ON community_need_signals
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_community_need_signals_org ON community_need_signals(org_id, severity);

-- agent_runs.agent_type is a strict enum (migration 001) and AutonomousAgent's
-- startRun() inserts agent_type unconditionally before any real work happens
-- (see AGENTS_v2.md section 1.2) - every prior Generation-2 agent that skipped
-- this step has never successfully completed a run against the live schema.
-- Add this agent's value up front rather than repeating that gap.
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-35-community-need';
