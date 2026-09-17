-- ============================================================================
-- BENAVORA - Migration 190: AR-6.2 - orchestration_logs, execution facts for
-- one step of one orchestration run.
--
-- TENANCY: this platform's live schema has 146 columns named organization_id
-- and zero named after the other product suite's tenant-id convention
-- (verified 2026-09-17; see STATE_OF_THE_BUILD.md's AR-6.2 section for the
-- exact spec wording this corrects). That other wording is correct for
-- DialStars/Cordial, not here. Every column and policy below uses
-- organization_id, matching every other table in this schema.
--
-- NO COST COLUMNS. Cost lives in ai_usage_log as the single ledger
-- (migration 185/186); cost_log_id is the join, not a duplicate total.
--
-- schema_validation_passed / reconciliation_passed are the two columns this
-- design exists for. The 2026-09-16 agent audit's headline defect was
-- AutoApply writing status='submitted' with no confirmation number and no
-- screenshot -- an evidence-validation failure nothing recorded. These two
-- booleans make a step's success claim falsifiable instead of trusting
-- status alone.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.orchestration_logs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  orchestration_id          uuid NOT NULL,
  task_id                   text,
  agent_type                text,
  agent_run_id              uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  pil_agent_run_id          uuid REFERENCES public.pil_agent_runs(id) ON DELETE SET NULL,
  status                    text NOT NULL,
  started_at                timestamptz NOT NULL DEFAULT now(),
  finished_at               timestamptz,
  duration_ms               integer,
  items_expected            integer,
  items_processed           integer,
  error_code                text,
  error_message             text,
  schema_validation_passed  boolean,
  reconciliation_passed     boolean,
  state_delta               jsonb,
  cost_log_id               uuid REFERENCES public.ai_usage_log(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orchestration_logs_org_created
  ON public.orchestration_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_logs_orchestration_id
  ON public.orchestration_logs (orchestration_id);

CREATE INDEX IF NOT EXISTS idx_orchestration_logs_status_incomplete
  ON public.orchestration_logs (status) WHERE status <> 'completed';

CREATE INDEX IF NOT EXISTS idx_orchestration_logs_agent_run_id
  ON public.orchestration_logs (agent_run_id);

-- ----------------------------------------------------------------------------
-- RLS: matches the live public.current_org_id() master pattern (migration
-- 001, e.g. agent_runs_org_isolation) rather than the src/supabase/migrations
-- lockdown-only convention, which is for orphaned tables with no real
-- authenticated reader. This table IS meant to be read by org members
-- (recovery tooling, dashboards) -- service role (which bypasses RLS
-- entirely) does all the writing from worker/autonomous-orchestrator.ts, so
-- only a SELECT policy is added. No INSERT/UPDATE/DELETE policy for
-- `authenticated` -- there is no authenticated write path to bypass.
-- ----------------------------------------------------------------------------
ALTER TABLE public.orchestration_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orchestration_logs FROM anon;

CREATE POLICY "orchestration_logs_org_isolation" ON public.orchestration_logs
  FOR SELECT
  USING (organization_id = public.current_org_id());

-- ============================================================================
-- END Migration 190
-- ============================================================================
