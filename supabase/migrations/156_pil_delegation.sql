-- ============================================================================
-- BENAVORA - Migration 156: Prospect Intelligence Layer, PIL-01 Group 7 -- Delegation
--
-- Third of 4 sequential migrations (154-157) applying PROSPECT_INTELLIGENCE_SCHEMA.md
-- groups 5-8. See migration 154's header for the batch context.
--
-- pil_agent_runs (migration 155) and pil_delegated_tasks (this migration) form a
-- deliberate two-table cycle documented in PROSPECT_INTELLIGENCE_SCHEMA.md's "Cross-group
-- foreign key summary": a delegated task spawns a run (pil_delegated_tasks.child_agent_
-- run_id -> pil_agent_runs(id)), and that run is recorded back onto the task
-- (pil_agent_runs.delegated_task_id -> pil_delegated_tasks(task_id)). Both tables are
-- created below without either cyclic FK, then both ALTER TABLE ... ADD CONSTRAINT
-- statements are added at the end of this file, once both tables exist.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 7.1 pil_delegated_tasks
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_delegated_tasks (
  task_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_agent_run_id     uuid REFERENCES pil_agent_runs(id),
  parent_agent_id         text NOT NULL REFERENCES pil_agent_registry(agent_id),
  child_agent_id          text NOT NULL REFERENCES pil_agent_registry(agent_id),
  objective               text NOT NULL,
  constraints             jsonb NOT NULL DEFAULT '{}',
  context_refs            jsonb NOT NULL DEFAULT '[]',
  allowed_tools           text[] NOT NULL DEFAULT '{}',
  allowed_data_classes    text[] NOT NULL DEFAULT '{}',
  prohibited_data_classes text[] NOT NULL DEFAULT '{}',
  evidence_budget         integer,
  tool_budget             integer,
  token_budget            integer,
  financial_budget        numeric,
  deadline                timestamptz,
  freshness_requirement   interval,
  minimum_confidence      numeric CHECK (minimum_confidence BETWEEN 0 AND 1),
  success_criteria        jsonb NOT NULL DEFAULT '{}',
  stop_conditions         jsonb NOT NULL DEFAULT '{}',
  escalation_conditions   jsonb NOT NULL DEFAULT '{}',
  max_autonomy            text NOT NULL CHECK (max_autonomy IN ('A0', 'A1', 'A2', 'A3', 'A4')),
  status                  text NOT NULL DEFAULT 'pending' CHECK (status IN (
                             'pending', 'accepted', 'running', 'completed', 'cancelled',
                             'failed', 'escalated'
                           )),
  child_agent_run_id      uuid, -- FK -> pil_agent_runs(id) added below, once both cyclic tables exist
  delegation_depth        integer NOT NULL DEFAULT 1 CHECK (delegation_depth >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  cancelled_at            timestamptz,
  CONSTRAINT pil_delegated_tasks_no_self_delegation CHECK (parent_agent_id <> child_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_pil_delegated_org_status ON pil_delegated_tasks(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_delegated_parent_run ON pil_delegated_tasks(parent_agent_run_id);
CREATE INDEX IF NOT EXISTS idx_pil_delegated_child_agent ON pil_delegated_tasks(child_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_delegated_depth ON pil_delegated_tasks(organization_id, delegation_depth);

ALTER TABLE pil_delegated_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_delegated_tasks FROM anon;
CREATE POLICY pil_delegated_org_select ON pil_delegated_tasks FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_delegated_org_insert ON pil_delegated_tasks FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_delegated_org_update ON pil_delegated_tasks FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 7.2 pil_delegation_budgets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_delegation_budgets (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  max_delegation_depth        integer NOT NULL DEFAULT 5,
  max_fanout_per_task         integer NOT NULL DEFAULT 8,
  default_token_budget        integer NOT NULL DEFAULT 50000,
  default_financial_budget    numeric NOT NULL DEFAULT 5.00,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pil_delegation_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_delegation_budgets FROM anon;
CREATE POLICY pil_delegation_budgets_org_select ON pil_delegation_budgets FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
-- INSERT/UPDATE intentionally has no authenticated policy here beyond org match; the API
-- route backing this table additionally requires requireRole('owner') before issuing a
-- write, per the RLS/role-split convention documented in PROSPECT_INTELLIGENCE_SCHEMA.md's
-- Conventions section.
CREATE POLICY pil_delegation_budgets_org_update ON pil_delegation_budgets FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_delegation_budgets_org_insert ON pil_delegation_budgets FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- Close the pil_agent_runs <-> pil_delegated_tasks two-table cycle: both tables now
-- exist, so both cyclic FKs are added here.
-- ----------------------------------------------------------------------------
ALTER TABLE pil_agent_runs
  ADD CONSTRAINT pil_agent_runs_delegated_task_id_fkey
  FOREIGN KEY (delegated_task_id) REFERENCES pil_delegated_tasks(task_id);

ALTER TABLE pil_delegated_tasks
  ADD CONSTRAINT pil_delegated_tasks_child_agent_run_id_fkey
  FOREIGN KEY (child_agent_run_id) REFERENCES pil_agent_runs(id);
