-- BEN-STR-03 (Cultivation Strategy Agent) persistence.
--
-- Neither existing table fits a structured multi-step cultivation plan:
-- pil_prospect_opportunities only has engagement_strategy:text (a single
-- string, BEN-STR-01's column) and timing_status:enum -- no column for a
-- staged plan with milestones/content needs/reassessment gates.
-- pil_agent_run_events.event_type is a fixed 7-value CHECK constraint
-- (tool_call/delegation_issued/evidence_collected/replan/escalation/
-- budget_warning/stop_condition_met, migration 155 lines 167-176) with no
-- slot for a cultivation-plan payload either. pil_cultivation_plans is a new
-- table for this agent's own output.

CREATE TABLE IF NOT EXISTS pil_cultivation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES pil_prospect_opportunities(id) ON DELETE CASCADE,
  stages jsonb NOT NULL DEFAULT '[]',
  milestones jsonb NOT NULL DEFAULT '[]',
  content_evidence_needs jsonb NOT NULL DEFAULT '[]',
  reassessment_gates jsonb NOT NULL DEFAULT '[]',
  next_reassessment_at timestamptz,
  created_by_agent_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_cultivation_plans_org_prospect ON pil_cultivation_plans(organization_id, prospect_id);

ALTER TABLE pil_cultivation_plans ENABLE ROW LEVEL SECURITY;

-- Public schema default ACLs auto-grant anon/authenticated full CRUD on any
-- new table lacking an explicit REVOKE (see
-- benavora-public-schema-default-acl-anon-exposure precedent) -- revoke anon
-- outright rather than relying on RLS policies alone to keep it out.
REVOKE ALL ON pil_cultivation_plans FROM anon;

-- Mirrors pil_agent_runs' exact RLS policy shape (migration 155 lines
-- 155-162): org-scoped select/insert/update for authenticated users only.
CREATE POLICY pil_cultivation_plans_org_select ON pil_cultivation_plans
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY pil_cultivation_plans_org_insert ON pil_cultivation_plans
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY pil_cultivation_plans_org_update ON pil_cultivation_plans
  FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
