-- 080_autonomous_agent_infrastructure.sql
-- Autonomous agent infrastructure: triggers, queue, decision log, per-org config

CREATE TABLE IF NOT EXISTS autonomous_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('schedule','threshold','event','chain')),
  condition_field text,
  condition_operator text CHECK (condition_operator IN ('gte','lte','eq','neq','gt','lt')),
  condition_value numeric,
  event_type text,
  is_enabled boolean DEFAULT true,
  last_fired_at timestamptz,
  fire_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE autonomous_triggers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "triggers_org" ON autonomous_triggers;
CREATE POLICY "triggers_org" ON autonomous_triggers USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_auto_triggers_org ON autonomous_triggers(org_id, agent_id, is_enabled);

CREATE TABLE IF NOT EXISTS agent_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id text NOT NULL,
  priority integer DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  status text DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  trigger_source text NOT NULL CHECK (trigger_source IN ('autonomous','manual','chain','schedule')),
  input_payload jsonb DEFAULT '{}',
  output_payload jsonb DEFAULT '{}',
  decision_log jsonb DEFAULT '[]',
  error_message text,
  queued_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3
);
ALTER TABLE agent_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "queue_org" ON agent_queue;
CREATE POLICY "queue_org" ON agent_queue USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_agent_queue_status ON agent_queue(status, priority DESC, queued_at ASC);
CREATE INDEX IF NOT EXISTS idx_agent_queue_org ON agent_queue(org_id, agent_id, status);

CREATE TABLE IF NOT EXISTS agent_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_run_id uuid REFERENCES agent_runs(id),
  agent_id text NOT NULL,
  decision_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  reasoning text NOT NULL,
  confidence_score integer CHECK (confidence_score BETWEEN 0 AND 100),
  action_taken text NOT NULL,
  action_payload jsonb DEFAULT '{}',
  required_human_review boolean DEFAULT false,
  human_reviewed_at timestamptz,
  human_reviewer_id uuid REFERENCES profiles(id),
  human_verdict text CHECK (human_verdict IN ('approved','rejected','modified')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE agent_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "decisions_org" ON agent_decisions;
CREATE POLICY "decisions_org" ON agent_decisions USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_decisions_org ON agent_decisions(org_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_review ON agent_decisions(org_id, required_human_review, human_reviewed_at);

CREATE TABLE IF NOT EXISTS org_autonomous_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  auto_research_enabled boolean DEFAULT false,
  auto_score_enabled boolean DEFAULT false,
  auto_draft_enabled boolean DEFAULT false,
  auto_draft_threshold integer DEFAULT 70 CHECK (auto_draft_threshold BETWEEN 50 AND 95),
  auto_reputation_enabled boolean DEFAULT false,
  auto_relationship_enabled boolean DEFAULT false,
  auto_deadline_prediction_enabled boolean DEFAULT false,
  auto_followup_enabled boolean DEFAULT false,
  notify_on_auto_draft boolean DEFAULT true,
  notify_on_high_score boolean DEFAULT true,
  notify_digest_time text DEFAULT '07:00',
  max_auto_drafts_per_night integer DEFAULT 10,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE org_autonomous_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auto_config_org" ON org_autonomous_config;
CREATE POLICY "auto_config_org" ON org_autonomous_config USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

INSERT INTO org_autonomous_config (org_id) SELECT id FROM organizations ON CONFLICT (org_id) DO NOTHING;

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS trigger_source text DEFAULT 'manual' CHECK (trigger_source IN ('autonomous','manual','chain','schedule'));
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS next_action text;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS confidence_score integer CHECK (confidence_score BETWEEN 0 AND 100);
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS items_queued integer DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS chained_from_run_id uuid REFERENCES agent_runs(id);

ALTER TABLE applications ADD COLUMN IF NOT EXISTS auto_generated boolean DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS pending_review boolean DEFAULT false;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS draft_source text DEFAULT 'manual' CHECK (draft_source IN ('manual','autonomous','imported'));
ALTER TABLE applications ADD COLUMN IF NOT EXISTS budget_data jsonb DEFAULT '{}';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS compliance_check_result jsonb DEFAULT '{}';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS fit_analysis jsonb DEFAULT '{}';
