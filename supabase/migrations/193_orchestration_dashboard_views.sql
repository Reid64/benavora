-- ============================================================================
-- BENAVORA - Migration 193: AR-6.4 Part C - dashboard views for orchestration
-- health, cost, alerts and budget, scoped by organization_id.
--
-- SECURITY_INVOKER: a view does NOT inherit RLS from its base tables on
-- PG15+ unless created with security_invoker = true (this project is
-- PG17.6, verified via mcp Supabase list_projects on 2026-09-17). Without
-- it, a view defaults to security_definer semantics (runs as the view
-- owner, typically postgres, which bypasses RLS) -- every view below would
-- silently become a cross-tenant read path. All five are declared
-- security_invoker = true.
--
-- PREREQUISITE FIX: public.ai_usage_log (migration 056) has RLS ENABLED but
-- had ZERO policies and ZERO grants to `authenticated` (verified live,
-- 2026-09-17) -- default-deny, so no organization member could ever read
-- their own org's cost rows, through this view or directly. Without this
-- fix, v_orchestration_daily_cost is correctly safe (returns nothing to
-- everyone) but also permanently empty for real users, which defeats the
-- point of a cost dashboard. Fixed here with the same org_isolation
-- SELECT-only pattern as orchestration_logs (migration 190) -- writes stay
-- service-role only, nothing here adds an authenticated write path.
-- ============================================================================

GRANT SELECT ON public.ai_usage_log TO authenticated;
REVOKE ALL ON public.ai_usage_log FROM anon;

CREATE POLICY "ai_usage_log_org_isolation" ON public.ai_usage_log
  FOR SELECT
  USING (organization_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- 1. v_orchestration_run_summary -- one row per orchestration run: step
--    counts, evidence-validation state, and overall status.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_orchestration_run_summary
WITH (security_invoker = true) AS
SELECT
  organization_id,
  orchestration_id,
  min(started_at)                                              AS started_at,
  max(finished_at)                                             AS finished_at,
  count(*)                                                      AS step_count,
  count(*) FILTER (WHERE status = 'completed')                  AS completed_steps,
  count(*) FILTER (WHERE status = 'failed')                     AS failed_steps,
  bool_and(coalesce(schema_validation_passed, true))            AS all_schema_valid,
  bool_and(coalesce(reconciliation_passed, true))                AS all_reconciled,
  sum(duration_ms)                                               AS total_duration_ms,
  CASE
    WHEN count(*) FILTER (WHERE status = 'failed') > 0 THEN 'failed'
    WHEN count(*) FILTER (WHERE status = 'running') > 0 THEN 'running'
    ELSE 'completed'
  END                                                             AS run_status
FROM public.orchestration_logs
GROUP BY organization_id, orchestration_id;

-- ----------------------------------------------------------------------------
-- 2. v_orchestration_daily_cost -- per-day, per-model, per-agent spend, from
--    ai_usage_log (the single cost ledger, migration 185) -- NOT from
--    orchestration_logs, which carries no cost columns by design.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_orchestration_daily_cost
WITH (security_invoker = true) AS
SELECT
  organization_id,
  date_trunc('day', created_at)::date                            AS usage_date,
  model,
  agent_type,
  billing_path,
  sum(cost_usd)                                                  AS total_cost_usd,
  sum(input_tokens)                                              AS total_input_tokens,
  sum(output_tokens)                                             AS total_output_tokens,
  count(*)                                                        AS call_count
FROM public.ai_usage_log
GROUP BY organization_id, date_trunc('day', created_at)::date, model, agent_type, billing_path;

-- ----------------------------------------------------------------------------
-- 3. v_alert_activity_summary -- alert volume and delivery state by type and
--    severity. pending_delivery_count surfaces worker/alert-notifier.ts's
--    backlog (AR-6.4 Part A) directly in the dashboard.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_alert_activity_summary
WITH (security_invoker = true) AS
SELECT
  organization_id,
  type,
  severity,
  count(*)                                                        AS total_count,
  count(*) FILTER (WHERE NOT is_read)                             AS unread_count,
  count(*) FILTER (WHERE NOT is_dismissed)                        AS undismissed_count,
  count(*) FILTER (WHERE severity = 'critical' AND notified_at IS NULL) AS pending_delivery_count,
  max(created_at)                                                 AS latest_created_at
FROM public.alerts
GROUP BY organization_id, type, severity;

-- ----------------------------------------------------------------------------
-- 4. v_budget_utilization -- spend vs. limit per budget scope (AR-5.2).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_budget_utilization
WITH (security_invoker = true) AS
SELECT
  organization_id,
  scope_type,
  scope_id,
  budget_period,
  budget_limit_usd,
  spent_usd,
  greatest(budget_limit_usd - spent_usd, 0)                       AS remaining_usd,
  CASE WHEN budget_limit_usd > 0
    THEN round((spent_usd / budget_limit_usd) * 100, 1)
    ELSE NULL
  END                                                              AS pct_used,
  hard_stop,
  alert_threshold_pct
FROM public.cost_budgets;

-- ----------------------------------------------------------------------------
-- 5. v_agent_reliability -- per-agent-type success rate and timeout
--    incidence, from orchestration_logs execution facts.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_agent_reliability
WITH (security_invoker = true) AS
SELECT
  organization_id,
  agent_type,
  count(*)                                                        AS total_runs,
  count(*) FILTER (WHERE status = 'completed')                    AS completed_runs,
  count(*) FILTER (WHERE status = 'failed')                       AS failed_runs,
  count(*) FILTER (WHERE duration_ms > 60000)                     AS timeout_count,
  round(avg(duration_ms))                                         AS avg_duration_ms,
  CASE WHEN count(*) > 0
    THEN round((count(*) FILTER (WHERE status = 'completed')::numeric / count(*)) * 100, 1)
    ELSE NULL
  END                                                              AS success_rate_pct
FROM public.orchestration_logs
WHERE agent_type IS NOT NULL
GROUP BY organization_id, agent_type;

-- ----------------------------------------------------------------------------
-- Grants -- authenticated only, same as every org-scoped table this
-- migration set touches. No RLS policy needed on the views themselves
-- (security_invoker = true means the base tables' own policies apply); a
-- view cannot enable RLS directly in Postgres regardless.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'v_orchestration_run_summary',
    'v_orchestration_daily_cost',
    'v_alert_activity_summary',
    'v_budget_utilization',
    'v_agent_reliability'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v);
  END LOOP;
END $$;

-- ============================================================================
-- END Migration 193
-- ============================================================================
