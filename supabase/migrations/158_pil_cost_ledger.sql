-- ============================================================================
-- BENAVORA - Migration 158: Prospect Intelligence Layer, PIL-01 Group 9 -- Cost Ledger
--
-- First of 4 sequential migrations (158-161) applying PROSPECT_INTELLIGENCE_SCHEMA.md
-- groups 9-12, closing out the PIL-01 batch (150-161, all 12 schema groups / 31 tables).
-- See migration 150's header for the full PIL-01 context and the deferred-FK convention
-- used earlier in this batch.
--
-- No deferred foreign keys in this file. Every table pil_cost_ledger references
-- (organizations, pil_agent_runs, pil_research_runs, pil_delegated_tasks) already exists
-- from migrations 150-156, so pil_cost_ledger.agent_run_id/research_run_id/
-- delegated_task_id are created below with their REFERENCES clauses directly, with no
-- ALTER TABLE ... ADD CONSTRAINT backfill step required.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 9.1 pil_cost_ledger
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_cost_ledger (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_run_id       uuid REFERENCES pil_agent_runs(id),
  research_run_id    uuid REFERENCES pil_research_runs(id),
  delegated_task_id  uuid REFERENCES pil_delegated_tasks(task_id),
  cost_type          text NOT NULL CHECK (cost_type IN (
                        'model_tokens', 'api_call', 'licensed_data', 'browser_automation', 'storage'
                      )),
  provider           text,
  units              numeric NOT NULL,
  unit_cost          numeric NOT NULL,
  total_cost_usd     numeric NOT NULL,
  model_name         text,
  token_count        integer,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_cost_ledger_org ON pil_cost_ledger(organization_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_pil_cost_ledger_agent_run ON pil_cost_ledger(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_pil_cost_ledger_research_run ON pil_cost_ledger(research_run_id);
CREATE INDEX IF NOT EXISTS idx_pil_cost_ledger_type ON pil_cost_ledger(organization_id, cost_type);

ALTER TABLE pil_cost_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_cost_ledger FROM anon;
CREATE POLICY pil_cost_ledger_org_select ON pil_cost_ledger FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_cost_ledger_org_insert ON pil_cost_ledger FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
-- No UPDATE/DELETE policy: a cost ledger is append-only, corrected via offsetting entries,
-- not edits.

-- ----------------------------------------------------------------------------
-- 9.2 pil_cost_budgets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_cost_budgets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope_type          text NOT NULL CHECK (scope_type IN ('org', 'agent', 'research_run')),
  scope_id            text NOT NULL,
  budget_period       text NOT NULL CHECK (budget_period IN ('daily', 'monthly', 'per_run')),
  budget_limit_usd    numeric NOT NULL,
  spent_usd           numeric NOT NULL DEFAULT 0,
  alert_threshold_pct numeric NOT NULL DEFAULT 0.8 CHECK (alert_threshold_pct BETWEEN 0 AND 1),
  hard_stop           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, scope_type, scope_id, budget_period)
);

CREATE INDEX IF NOT EXISTS idx_pil_cost_budgets_org ON pil_cost_budgets(organization_id, scope_type);

ALTER TABLE pil_cost_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_cost_budgets FROM anon;
CREATE POLICY pil_cost_budgets_org_select ON pil_cost_budgets FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_cost_budgets_org_insert ON pil_cost_budgets FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_cost_budgets_org_update ON pil_cost_budgets FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
-- Write access is additionally gated to requireRole('owner') at the API layer (budget
-- changes are consequential, per PROSPECT_INTELLIGENCE_SCHEMA.md's Conventions section).
