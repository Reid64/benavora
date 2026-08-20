// ONE-TIME LOCAL SCAFFOLDING PATCH for PT-09-003 batch 2 (AG-37/38/39/40/42/43).
//
// SAFETY RULE 5 precedent (same as batch 1's
// _fix-probability-scores-constraint.mjs for AG-15): the pt05-local-stack was
// widened ad hoc and never ran a full `supabase migration up` against
// src/supabase/migrations/ (the real migrations dir for these agents -- see
// project memory "Two parallel migrations directories"). Live-checked via a
// direct pg \d before writing this: simulation_scenarios, strategic_
// recommendations, submission_variables, improvement_proposals,
// agent_performance_metrics, corporate_monitoring_events, and
// funder_relationship_signals all genuinely do NOT exist on the local stack,
// even though every one of them is a real CREATE TABLE IF NOT EXISTS already
// committed on disk (085_fundraising_simulator.sql, 086_strategic_advisor.sql,
// 089_roi_optimizer.sql, 087_continuous_improvement.sql + 100's ALTER TABLE
// widening, 077_intelligence_graph.sql, and root supabase/migrations/
// 137_funder_signal_monitoring.sql respectively). roi_insights and
// impact_simulations already existed locally (seeded by an earlier session),
// so those two are left untouched.
//
// This is a genuine local-scaffolding gap, not an application bug -- applying
// the exact, already-committed DDL here (idempotent, IF NOT EXISTS
// throughout) lets this session get a REAL verdict for each agent's own
// code/business logic, rather than a false TRIGGER-BROKEN caused purely by
// the local stack missing a table production already has. agent_type is a
// plain `text` column on this local stack (not the strict Postgres enum
// migration headers assume -- confirmed via information_schema before writing
// this), so every `ALTER TYPE agent_type ADD VALUE ...` statement from the
// source migrations is deliberately omitted here (it would error against a
// text column with no such type).
//
// Usage: node --import tsx scripts/audit/pt09-003-trigger/_fix-missing-tables.mjs

import { setupLocalEnv, pgClient } from "../pt09-003-lib.mjs";

setupLocalEnv();

const DDL = `
-- From src/supabase/migrations/085_fundraising_simulator.sql (AG-37)
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

-- From src/supabase/migrations/086_strategic_advisor.sql (AG-40)
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
CREATE INDEX IF NOT EXISTS idx_advisor_org ON strategic_recommendations(org_id, urgency, status, generated_at DESC);

-- From src/supabase/migrations/089_roi_optimizer.sql (AG-39) -- roi_insights
-- already exists locally, IF NOT EXISTS below is a no-op for it.
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

-- From src/supabase/migrations/077_intelligence_graph.sql (AG-42) -- only the
-- corporate_monitoring_events table is needed (pig_nodes/pig_edges are not a
-- write target of any agent in this batch, so intentionally omitted).
CREATE TABLE IF NOT EXISTS corporate_monitoring_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id      uuid NOT NULL,
  event_type       text NOT NULL,
  description      text,
  change_detected  jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- From src/supabase/migrations/087_continuous_improvement.sql +
-- 100_self_improvement_hardening.sql (AG-38)
CREATE TABLE IF NOT EXISTS improvement_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_type text NOT NULL CHECK (proposal_type IN ('prompt_optimization','agent_threshold','workflow_change','ui_improvement','data_quality','performance_report')),
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
  implemented_at timestamptz,
  affected_agent_id text
);
CREATE INDEX IF NOT EXISTS idx_improvements_status ON improvement_proposals(status, proposed_at DESC);
CREATE INDEX IF NOT EXISTS idx_improvement_proposals_dedup ON improvement_proposals(proposal_type, affected_agent_id, proposed_at DESC);

CREATE TABLE IF NOT EXISTS agent_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL,
  metric_date date NOT NULL,
  runs_total integer DEFAULT 0,
  runs_successful integer DEFAULT 0,
  runs_failed integer NOT NULL DEFAULT 0,
  avg_confidence_score numeric,
  avg_items_processed numeric,
  decisions_requiring_review integer,
  decisions_auto_approved integer,
  created_at timestamptz DEFAULT now(),
  UNIQUE(agent_id, metric_date)
);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_date ON agent_performance_metrics(agent_id, metric_date DESC);

-- From src/supabase/migrations/088_self_improvement_agent.sql (AG-38) --
-- platform-level agent_runs rows have organization_id = null.
ALTER TABLE agent_runs ALTER COLUMN organization_id DROP NOT NULL;

-- From supabase/migrations/137_funder_signal_monitoring.sql (AG-43)
CREATE TABLE IF NOT EXISTS funder_relationship_signals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id             uuid NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  source                text NOT NULL CHECK (source IN ('news', '990_filing')),
  signal_type           text NOT NULL CHECK (signal_type IN (
                           'leadership_change',
                           'board_appointment',
                           'funding_priority_announcement',
                           'program_expansion',
                           'public_recognition',
                           '990_filing'
                         )),
  signal_summary        text NOT NULL,
  signal_url            text,
  signal_date           date,
  relationship_score    integer CHECK (relationship_score BETWEEN 0 AND 100),
  mission_alignment     integer CHECK (mission_alignment BETWEEN 0 AND 100),
  recommended_action    text,
  recommended_deadline  date,
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funder_rel_signals_org ON funder_relationship_signals(org_id, relationship_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_funder_rel_signals_funder ON funder_relationship_signals(funder_id, signal_type, created_at DESC);
`;

async function main() {
  const db = await pgClient();
  try {
    await db.query(DDL);
    console.log("Local scaffolding patch applied cleanly (idempotent).");
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
