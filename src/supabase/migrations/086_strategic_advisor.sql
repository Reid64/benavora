-- 086_strategic_advisor.sql
-- AG-40 Strategic Advisor Agent (AUTONOMOUS_PLATFORM_VISION.md Phase 5,
-- "AI Strategic Advisor" -- the capstone agent that reads every other
-- agent's output and synthesizes a single prioritized, proactive action
-- list: "Apply for these 12 grants next month," "Postpone this
-- application," etc).
--
-- Extends the agent_type enum so AG-40's agent_runs inserts succeed, per the
-- precedent set in 085_fundraising_simulator.sql for 'ag-37-simulation' and
-- documented as a systemic gap in AGENTS_v2.md section 1.2:
-- AutonomousAgent.startRun() inserts agent_type = this.agentId directly and
-- unconditionally, before any real work happens -- so a Generation-2 agent
-- whose constructor id isn't a valid agent_type enum member fails at the
-- very first agent_runs insert. This migration adds the value up front so
-- AG-40 does not become the 13th agent permanently stuck in that state.
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-40-strategic-advisor';

CREATE TABLE IF NOT EXISTS strategic_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recommendation_category text NOT NULL CHECK (recommendation_category IN ('apply_now','postpone','hire','expand','pivot','partnership','board','technology','compliance')),
  title text NOT NULL,
  recommendation text NOT NULL,
  reasoning text NOT NULL,
  urgency text DEFAULT 'normal' CHECK (urgency IN ('immediate','urgent','normal','low')),
  time_sensitivity text,
  expected_impact text,
  confidence_score integer,
  data_basis jsonb DEFAULT '{}',
  status text DEFAULT 'pending' CHECK (status IN ('pending','actioned','dismissed','snoozed')),
  generated_at timestamptz DEFAULT now(),
  actioned_at timestamptz
);
ALTER TABLE strategic_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "advisor_org" ON strategic_recommendations;
CREATE POLICY "advisor_org" ON strategic_recommendations USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_advisor_org ON strategic_recommendations(org_id, urgency, status, generated_at DESC);
