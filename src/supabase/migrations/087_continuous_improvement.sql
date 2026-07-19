CREATE TABLE IF NOT EXISTS improvement_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_type text NOT NULL CHECK (proposal_type IN ('prompt_optimization','agent_threshold','workflow_change','ui_improvement','data_quality')),
  title text NOT NULL,
  description text NOT NULL,
  evidence text NOT NULL,
  expected_impact text NOT NULL,
  risk_level text CHECK (risk_level IN ('low','medium','high')),
  status text DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','implemented','rolled_back')),
  confidence_score integer,
  proposed_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES profiles(id),
  implemented_at timestamptz
);
COMMENT ON TABLE improvement_proposals IS 'Platform-wide improvement proposals from the self-improvement engine. No RLS -- platform owner only.';
CREATE INDEX IF NOT EXISTS idx_improvements_status ON improvement_proposals(status, proposed_at DESC);

CREATE TABLE IF NOT EXISTS agent_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL,
  metric_date date NOT NULL,
  runs_total integer DEFAULT 0,
  runs_successful integer DEFAULT 0,
  avg_confidence_score numeric,
  avg_items_processed numeric,
  decisions_requiring_review integer,
  decisions_auto_approved integer,
  created_at timestamptz DEFAULT now(),
  UNIQUE(agent_id, metric_date)
);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_date ON agent_performance_metrics(agent_id, metric_date DESC);
