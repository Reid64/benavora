-- Migration 089: ROI Optimizer schema
-- Phase 5 (AG-39 ROI Optimizer) per AUTONOMOUS_PLATFORM_VISION.md section 7
-- Tracks submission-affecting variables against outcomes and stores derived insights.

CREATE TABLE IF NOT EXISTS submission_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  submission_day_of_week integer CHECK (submission_day_of_week BETWEEN 0 AND 6),
  days_before_deadline integer,
  prompt_version text,
  word_count integer,
  attachment_count integer,
  has_budget boolean DEFAULT false,
  has_logic_model boolean DEFAULT false,
  has_board_list boolean DEFAULT false,
  narrative_readability_score numeric,
  executive_contact_name text,
  outcome_result text,
  outcome_amount numeric,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE submission_variables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sub_vars_org ON submission_variables;
CREATE POLICY sub_vars_org ON submission_variables
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_sub_vars_org ON submission_variables(org_id, outcome_result);

CREATE TABLE IF NOT EXISTS roi_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  insight_type text NOT NULL,
  insight_description text NOT NULL,
  winning_pattern text,
  losing_pattern text,
  sample_size integer,
  confidence numeric,
  recommended_action text,
  generated_at timestamptz DEFAULT now()
);

ALTER TABLE roi_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roi_insights_org ON roi_insights;
CREATE POLICY roi_insights_org ON roi_insights
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
