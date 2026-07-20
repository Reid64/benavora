-- Migration 093: AI Donor Intent Engine (AG-30)
-- Phase 2 per AUTONOMOUS_PLATFORM_VISION.md section "AI Donor Intent Engine"
-- and AGENTS_v2.md's Phase 2-5 spec section ("AG-30: Donor Intent Monitor").
--
-- Numbering note: AUTONOMOUS_PLATFORM_VISION.md itself numbers this feature
-- AG-31, while AGENTS_v2.md's Phase 2-5 addendum (task-assigned sequential
-- numbering) calls it AG-30 - the two governance docs disagree, and
-- AGENTS_v2.md section 1.4/the Phase 2-5 addendum both flag this as a known,
-- unresolved cross-doc mismatch rather than an accident. This migration uses
-- the AG-30 numbering from AGENTS_v2.md's per-agent spec (the doc that names
-- this exact table shape) and suffixes the agent_type value with a
-- descriptive name ("ag-30-donor-intent") so it can never collide with a
-- future literal "ag-30"/"ag-31" build either way.
--
-- Purpose: continuously monitors press releases, ESG/CSR reports, SEC
-- filings, hiring trends, facility expansions, and disaster declarations for
-- corporate prospects and scores the probability that each announces a
-- giving initiative in the next 30-90 days - moving Reputation Intelligence
-- (AG-18) and the Relationship Builder concept (AG-19) from reactive to
-- predictive, per AUTONOMOUS_PLATFORM_VISION.md Phase 2.
--
-- agent_runs.agent_type is a strict enum (migration 001) and AutonomousAgent's
-- startRun() inserts agent_type unconditionally before any real work happens
-- (see AGENTS_v2.md section 1.2) - every prior Generation-2 agent that skipped
-- this step has never successfully completed a run against the live schema.
-- Add this agent's value up front rather than repeating that gap.

CREATE TABLE IF NOT EXISTS corporate_intent_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  signal_type text NOT NULL CHECK (signal_type IN ('press_release','esg_report','sec_filing','hiring_trend','facility_expansion','disaster_declaration','foundation_appointment','csr_announcement','executive_interview')),
  signal_summary text NOT NULL,
  signal_url text,
  signal_date date,
  intent_score integer CHECK (intent_score BETWEEN 0 AND 100),
  geographic_relevance integer CHECK (geographic_relevance BETWEEN 0 AND 100),
  mission_alignment integer CHECK (mission_alignment BETWEEN 0 AND 100),
  recommended_action text,
  recommended_deadline date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE corporate_intent_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intent_signals_org ON corporate_intent_signals;
CREATE POLICY intent_signals_org ON corporate_intent_signals
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_intent_signals_org ON corporate_intent_signals(org_id, intent_score DESC, created_at DESC);

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-30-donor-intent';
