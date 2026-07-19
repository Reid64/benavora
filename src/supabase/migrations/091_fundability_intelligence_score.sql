-- Migration 091: Fundability Intelligence Score (AG-29)
-- Phase 2 per AUTONOMOUS_PLATFORM_VISION.md section "Fundability Intelligence
-- Score" and AGENTS_v2.md's Phase 2-5 spec section. Extends the existing
-- (deterministic) Grant Probability Engine (computeGrantProbability(),
-- opportunity_probability_scores) into a diagnostic layer: for a below-
-- threshold opportunity, decomposes the score into specific deficiencies and
-- estimates the probability delta if they were fixed.
--
-- Numbering note: AGENTS_v2.md's own Section 5 roster already assigns AG-29 to
-- a different, also-unbuilt agent (Knowledge Engine Indexer) - see that
-- document's Phase 2-5 addendum, which flags this exact collision. This
-- agent's agentId ("ag-29-fundability") is deliberately suffixed so its
-- agent_type enum value can never collide with a future literal "ag-29" build.
--
-- agent_runs.agent_type is a strict enum (migration 001) and AutonomousAgent's
-- startRun() inserts agent_type unconditionally before any real work happens
-- (see AGENTS_v2.md section 1.2) - every prior Generation-2 agent that skipped
-- this step has never successfully completed a run against the live schema.
-- Add this agent's value up front rather than repeating that gap.

CREATE TABLE IF NOT EXISTS fundability_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  overall_score integer,
  probability_without_fixes integer,
  probability_with_fixes integer,
  confidence text,
  deficiencies jsonb DEFAULT '[]',
  recommendation text,
  generated_at timestamptz DEFAULT now()
);

ALTER TABLE fundability_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fundability_org ON fundability_scores;
CREATE POLICY fundability_org ON fundability_scores
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_fundability_scores_org ON fundability_scores(org_id, opportunity_id);
CREATE INDEX IF NOT EXISTS idx_fundability_scores_generated_at ON fundability_scores(opportunity_id, generated_at DESC);

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-29-fundability';
