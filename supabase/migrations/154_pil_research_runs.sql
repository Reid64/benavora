-- ============================================================================
-- BENAVORA - Migration 154: Prospect Intelligence Layer, PIL-01 Group 5 -- Research Runs
--
-- First of 4 sequential migrations (154-157) applying PROSPECT_INTELLIGENCE_SCHEMA.md
-- groups 5-8. Continues the PIL-01 batch started in migrations 150-153 (groups 1-4). See
-- migration 150's header for the full PIL-01 context and the deferred-FK convention.
--
-- Deferred foreign keys in this file (pil_agent_registry, Group 6, is not part of this
-- batch until migration 155):
--   - pil_research_goals.owner_agent_id -> pil_agent_registry(agent_id)
--   - pil_research_runs.initiating_agent_id -> pil_agent_registry(agent_id) (kept NOT NULL)
--   - pil_research_run_steps.agent_run_id -> pil_agent_runs(id) (pil_agent_runs is also
--     Group 6, migration 155)
-- All three are added via ALTER TABLE ... ADD CONSTRAINT in migration 155, once
-- pil_agent_registry/pil_agent_runs exist.
--
-- Backfilling two FKs deferred from the earlier PIL-01 batch, now that pil_research_runs
-- exists (both migrations 150 and 153 explicitly named "pil-01-005" as the deferral point
-- for these):
--   - pil_evidence.research_run_id -> pil_research_runs(id) (deferred by migration 153)
--   - pil_prospect_classifications.evidence_id -> pil_evidence(id) (deferred a second time
--     by migration 150, specifically until pil_research_runs also exists)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 5.1 pil_research_goals
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_research_goals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id      uuid REFERENCES pil_prospects(id) ON DELETE CASCADE,
  goal_type        text NOT NULL CHECK (goal_type IN (
                      'portfolio_discovery', 'prospect_research', 'qualification', 'strategy',
                      'monitoring', 'recovery'
                    )),
  objective        text NOT NULL,
  state            text NOT NULL DEFAULT 'proposed' CHECK (state IN (
                      'proposed', 'validated', 'active', 'planning', 'researching', 'executing',
                      'observing', 'replanning', 'qualified', 'disqualified', 'engagement_ready',
                      'cultivation', 'awaiting_response', 'monitoring', 'research_stale',
                      'blocked_policy', 'blocked_human', 'failed_recoverable', 'failed_terminal',
                      'satisfied', 'paused', 'reopened'
                    )),
  owner_agent_id   text, -- FK -> pil_agent_registry(agent_id) added once that table exists (migration 155)
  priority         integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  satisfied_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pil_goals_org_state ON pil_research_goals(organization_id, state);
CREATE INDEX IF NOT EXISTS idx_pil_goals_prospect ON pil_research_goals(prospect_id);
CREATE INDEX IF NOT EXISTS idx_pil_goals_priority ON pil_research_goals(organization_id, priority DESC) WHERE state NOT IN ('satisfied', 'failed_terminal');

ALTER TABLE pil_research_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_research_goals FROM anon;
CREATE POLICY pil_goals_org_select ON pil_research_goals FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_goals_org_insert ON pil_research_goals FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_goals_org_update ON pil_research_goals FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 5.2 pil_research_runs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_research_runs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  goal_id                   uuid REFERENCES pil_research_goals(id) ON DELETE CASCADE,
  prospect_id               uuid REFERENCES pil_prospects(id),
  initiating_agent_id       text NOT NULL, -- FK -> pil_agent_registry(agent_id) added once that table exists (migration 155)
  natural_language_query    text,
  structured_plan           jsonb NOT NULL DEFAULT '{}',
  status                    text NOT NULL DEFAULT 'planning' CHECK (status IN (
                               'planning', 'running', 'completed', 'failed', 'cancelled'
                             )),
  token_budget              integer,
  tokens_consumed           integer NOT NULL DEFAULT 0,
  financial_budget          numeric,
  financial_spent           numeric NOT NULL DEFAULT 0,
  started_at                timestamptz,
  completed_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_runs_org_status ON pil_research_runs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_runs_goal ON pil_research_runs(goal_id);
CREATE INDEX IF NOT EXISTS idx_pil_runs_prospect ON pil_research_runs(prospect_id);

ALTER TABLE pil_research_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_research_runs FROM anon;
CREATE POLICY pil_runs_org_select ON pil_research_runs FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_runs_org_insert ON pil_research_runs FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_runs_org_update ON pil_research_runs FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 5.3 pil_research_run_steps
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_research_run_steps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_run_id    uuid NOT NULL REFERENCES pil_research_runs(id) ON DELETE CASCADE,
  agent_run_id       uuid, -- FK -> pil_agent_runs(id) added once that table exists (migration 155)
  step_number        integer NOT NULL,
  loop_phase         text NOT NULL CHECK (loop_phase IN (
                        'goal', 'observe_state', 'plan', 'select_tools_or_delegate', 'execute',
                        'collect_evidence', 'evaluate', 'observe_result', 'revise_plan',
                        'continue', 'escalate', 'stop'
                      )),
  state_snapshot     jsonb NOT NULL DEFAULT '{}',
  decision           text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (research_run_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_pil_run_steps_run ON pil_research_run_steps(research_run_id, step_number);
CREATE INDEX IF NOT EXISTS idx_pil_run_steps_agent_run ON pil_research_run_steps(agent_run_id);

ALTER TABLE pil_research_run_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_research_run_steps FROM anon;
CREATE POLICY pil_run_steps_select ON pil_research_run_steps FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pil_research_runs r WHERE r.id = research_run_id
      AND r.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));
CREATE POLICY pil_run_steps_insert ON pil_research_run_steps FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM pil_research_runs r WHERE r.id = research_run_id
      AND r.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));

-- ----------------------------------------------------------------------------
-- Backfill: pil_evidence.research_run_id -> pil_research_runs(id)
-- Deferred by migration 153 ("PIL-01 Group 4 -- Evidence / Provenance") specifically to
-- this point, now that pil_research_runs exists.
-- ----------------------------------------------------------------------------
ALTER TABLE pil_evidence
  ADD CONSTRAINT pil_evidence_research_run_id_fkey
  FOREIGN KEY (research_run_id) REFERENCES pil_research_runs(id);

-- ----------------------------------------------------------------------------
-- Backfill: pil_prospect_classifications.evidence_id -> pil_evidence(id)
-- Deferred a second time by migration 150 ("PIL-01 Group 1 -- Prospects") specifically
-- until pil_research_runs also exists, per that migration's own header comment.
-- ----------------------------------------------------------------------------
ALTER TABLE pil_prospect_classifications
  ADD CONSTRAINT pil_prospect_classifications_evidence_id_fkey
  FOREIGN KEY (evidence_id) REFERENCES pil_evidence(id);
