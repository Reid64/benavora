-- ============================================================================
-- BENAVORA - Migration 191: AR-6.3 - deterministic alert rules 1-5.
--
-- Deterministic Postgres triggers instead of meta-agents in the hot path. A
-- monitoring agent that can itself fail is not monitoring. No LLM call, no
-- interpretive summary, anywhere in this file.
--
-- HARD CONSTRAINT verified 2026-09-17 against the live project: pg_net,
-- http and pg_cron are available but NOT installed. This migration installs
-- none of them and makes no net.http_post call. Slack delivery is prompt
-- 6.4's job and lives in the worker, not in SQL.
--
-- BLAST RADIUS: a trigger that throws blocks the INSERT/UPDATE that fired
-- it. An alerting layer must never fail the work it is observing. Every
-- rule function below is wrapped in EXCEPTION WHEN OTHERS -- an unexpected
-- condition is logged via RAISE WARNING (visible in Postgres logs) and
-- swallowed, never propagated. raise_orchestration_alert() (the shared
-- insert helper every rule calls) wraps its own INSERT the same way, so a
-- second failure mode -- the alerts insert itself erroring, e.g. an enum
-- value mismatch -- cannot escalate into a blocked write either.
--
-- DEDUP: every dedup_key below is built from stable identifiers already on
-- the row (orchestration_id, agent_type/task_id, scope_id) -- no
-- crypto-random component, so uq_alerts_org_dedup (migration 013) actually
-- dedups repeats of the same event via ON CONFLICT ... DO NOTHING. Key
-- shapes match src/lib/alerts/alerts-service.ts's `dedupKeys` object (the
-- TS-side contract for the same eight event types) except Rule 2, noted
-- below.
--
-- RULE 4 / STATE_DRIFT DEVIATION FROM SPEC SECTION 8 (documented per the
-- AR-6.3 prompt's explicit instruction):
-- Spec section 8 proposed snapshotting STATE_OF_THE_BUILD.md before and
-- after each task, diffing it, and raising a critical state_drift alert on
-- mismatch. STATE_OF_THE_BUILD.md is a governance document maintained BY
-- build agents as part of normal, legitimate work -- every real governance
-- update would register as "drift", and a critical alert that fires during
-- healthy operation trains the operator to ignore critical alerts. This
-- migration does not read, diff, or reference any file from SQL (SQL has no
-- filesystem access to a repo file in the first place). Instead Rule 4
-- reconciles a step that reports status='completed' against the actual
-- database: does the linked agent_runs/pil_agent_runs row show a terminal
-- status, and is items_processed coherent with items_expected -- NOT a
-- plain inequality check (see alert_rule_state_drift's own comment): a live
-- read of worker/autonomous-orchestrator.ts's real call sites shows
-- items_processed < items_expected on a routine, healthy completion
-- (candidates found vs. candidates actually acted on) -- a naive mismatch
-- check would itself have become a false-positive generator, exactly the
-- "critical alert during healthy operation trains the operator to ignore
-- critical alerts" failure mode this migration's header warns about for
-- spec section 8. Only a claimed success with items_processed never
-- recorded at all, or more items processed than were ever found, count as
-- incoherent. A caller with richer target-table-specific knowledge (e.g.
-- "did N rows really land in table X") may still pass
-- reconciliation_passed=false explicitly (AR-6.2's toOutcome() callback) --
-- that is honored as an additional contradiction
-- signal, not replaced by this generic check.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Shared insert helper -- one INSERT ... ON CONFLICT DO NOTHING path for all
-- five rules (and reused verbatim by the application-layer helper in
-- src/lib/alerts/raise-orchestration-alert.ts for the three types that are
-- not trigger-derivable: rate_limit, rollback, manual_review_required).
-- SECURITY DEFINER + fixed search_path: rule triggers fire under whatever
-- role performed the write (often just `authenticated` via normal app
-- traffic into orchestration_logs/cost_budgets), which does not itself have
-- INSERT on alerts.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raise_orchestration_alert(
  p_organization_id  uuid,
  p_orchestration_id uuid,
  p_type             public.alert_type,
  p_severity         public.alert_severity,
  p_message          text,
  p_dedup_key        text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.alerts (organization_id, orchestration_id, type, severity, message, dedup_key)
  VALUES (p_organization_id, p_orchestration_id, p_type, p_severity, p_message, p_dedup_key)
  ON CONFLICT (organization_id, dedup_key) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[raise_orchestration_alert] swallowed % for type=% org=% dedup_key=%',
    SQLERRM, p_type, p_organization_id, p_dedup_key;
END;
$$;

-- New functions in this project default to EXECUTE granted not just to
-- PUBLIC but explicitly to anon AND authenticated individually (verified
-- live via pg_proc.proacl -- Supabase applies its own default privileges to
-- every new public-schema function, so `REVOKE ... FROM PUBLIC` alone
-- leaves anon/authenticated's own grants intact and the function still
-- callable). PostgREST exposes every public-schema function as an RPC
-- endpoint by default, and this one is SECURITY DEFINER with no per-caller
-- organization_id check (the trigger callers already know the right org
-- from NEW; a direct RPC caller could pass any org's id and forge an
-- alert). It is only ever meant to be called from the trigger functions
-- below and from src/lib/alerts/raise-orchestration-alert.ts's
-- service-role write path -- neither needs an anon/authenticated grant,
-- since a SECURITY DEFINER function's own body executes as its owner
-- regardless of the calling role's grants, and trigger invocation is not
-- gated by EXECUTE grants at all. Live-verified closed: an anon-key RPC
-- call to this function now returns 401 / 42501 "permission denied",
-- where it previously returned 204 (success).
REVOKE EXECUTE ON FUNCTION public.raise_orchestration_alert(uuid, uuid, public.alert_type, public.alert_severity, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_orchestration_alert(uuid, uuid, public.alert_type, public.alert_severity, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- RULE 1 - task_failed. An orchestration_logs row reaching status='failed'
-- raises 'critical' when this was the last retry, 'warning' otherwise.
-- orchestration_logs has no retry_count/max_retries column of its own (that
-- state lives on agent_queue, migration 035) -- a caller with real retry
-- context passes it through state_delta as {"retry_count": <attempts so
-- far, before this one>, "max_retries": <n>} (see the runOrchestrationStep
-- ctx.retryCount/ctx.maxRetries plumbing added alongside this migration).
-- A step from a path with no retry mechanism at all (no max_retries in
-- state_delta) has no next attempt coming, so it defaults to "last retry" =
-- true, i.e. critical -- a single-attempt failure is already terminal.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alert_rule_task_failed() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retry_count   int;
  v_max_retries   int;
  v_is_last_retry boolean;
  v_severity      public.alert_severity;
  v_label         text;
BEGIN
  IF NEW.status = 'failed' THEN
    v_retry_count := NULLIF(NEW.state_delta ->> 'retry_count', '')::int;
    v_max_retries := NULLIF(NEW.state_delta ->> 'max_retries', '')::int;

    IF v_max_retries IS NOT NULL THEN
      v_is_last_retry := (COALESCE(v_retry_count, 0) + 1) >= v_max_retries;
    ELSE
      v_is_last_retry := true;
    END IF;

    v_severity := CASE WHEN v_is_last_retry THEN 'critical' ELSE 'warning' END;
    v_label := COALESCE(NEW.agent_type, NEW.task_id, 'unknown');

    PERFORM public.raise_orchestration_alert(
      NEW.organization_id,
      NEW.orchestration_id,
      'task_failed',
      v_severity,
      'Task failed: ' || v_label || ' -- ' || COALESCE(NEW.error_message, 'no error message recorded') ||
        CASE WHEN v_is_last_retry THEN ' (final attempt)' ELSE ' (will retry)' END,
      'orchestration:task_failed:' || NEW.orchestration_id::text || ':' || v_label
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[alert_rule_task_failed] swallowed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orchestration_logs_alert_task_failed ON public.orchestration_logs;
CREATE TRIGGER orchestration_logs_alert_task_failed
  AFTER INSERT OR UPDATE ON public.orchestration_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.alert_rule_task_failed();

-- ----------------------------------------------------------------------------
-- RULE 2 - cost_overage. Fires off cost_budgets, not orchestration_logs --
-- read through the accrual path built in AR-5.2 (migration 187's
-- accrue_cost_budget_spend trigger on ai_usage_log, which UPDATEs
-- cost_budgets.spent_usd; that UPDATE is what fires this trigger).
-- 'critical' when hard_stop, 'warning' otherwise.
--
-- DEDUP KEY DEVIATION: the TS dedupKeys.orchestrationCostOverage() helper
-- (migration 188/189 era) keys only on orchestrationId, because it was
-- written for the 'orchestration' cost_budgets scope. A cost_budgets row
-- can equally be scope_type='org' or 'agent' with no orchestration context
-- at all, so this rule keys on (scope_type, scope_id) instead -- both are
-- always present (scope_id is NOT NULL) and stable per budget row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alert_rule_cost_overage() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_severity         public.alert_severity;
  v_orchestration_id uuid;
BEGIN
  IF NEW.spent_usd >= NEW.budget_limit_usd THEN
    v_severity := CASE WHEN NEW.hard_stop THEN 'critical' ELSE 'warning' END;

    v_orchestration_id := NULL;
    IF NEW.scope_type = 'orchestration' THEN
      BEGIN
        v_orchestration_id := NEW.scope_id::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_orchestration_id := NULL;
      END;
    END IF;

    PERFORM public.raise_orchestration_alert(
      NEW.organization_id,
      v_orchestration_id,
      'cost_overage',
      v_severity,
      'Cost budget exceeded for ' || NEW.scope_type || ':' || NEW.scope_id ||
        ' -- spent $' || NEW.spent_usd || ' of $' || NEW.budget_limit_usd || ' limit' ||
        CASE WHEN NEW.hard_stop THEN ' (hard stop)' ELSE '' END || '.',
      'orchestration:cost_overage:' || NEW.scope_type || ':' || NEW.scope_id
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[alert_rule_cost_overage] swallowed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cost_budgets_alert_cost_overage ON public.cost_budgets;
CREATE TRIGGER cost_budgets_alert_cost_overage
  AFTER INSERT OR UPDATE OF spent_usd, budget_limit_usd ON public.cost_budgets
  FOR EACH ROW
  EXECUTE FUNCTION public.alert_rule_cost_overage();

-- ----------------------------------------------------------------------------
-- RULE 3 - schema_mismatch. schema_validation_passed = false raises
-- 'critical' -- a run that produced output nothing could validate is not a
-- success.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alert_rule_schema_mismatch() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
BEGIN
  IF NEW.schema_validation_passed = false THEN
    v_label := COALESCE(NEW.agent_type, NEW.task_id, 'unknown');
    PERFORM public.raise_orchestration_alert(
      NEW.organization_id,
      NEW.orchestration_id,
      'schema_mismatch',
      'critical',
      'Schema validation failed for ' || v_label || ' -- output could not be validated.',
      'orchestration:schema_mismatch:' || NEW.orchestration_id::text || ':' || v_label
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[alert_rule_schema_mismatch] swallowed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orchestration_logs_alert_schema_mismatch ON public.orchestration_logs;
CREATE TRIGGER orchestration_logs_alert_schema_mismatch
  AFTER INSERT OR UPDATE OF schema_validation_passed ON public.orchestration_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.alert_rule_schema_mismatch();

-- ----------------------------------------------------------------------------
-- RULE 4 - state_drift. See the migration header for the full deviation
-- rationale. Only a step that CLAIMS success (status='completed') can
-- "contradict" the database -- a claimed failure is already Rule 1's
-- concern, not this rule's.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alert_rule_state_drift() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_run_status text;
  v_pil_run_status   text;
  v_db_ok            boolean := true;
BEGIN
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  -- Check 1: the underlying agent_runs / pil_agent_runs row reached a
  -- terminal status (agent_run_status enum: pending/running/completed/
  -- failed -- migration 001; pil_agent_runs.status text CHECK includes
  -- blocked/escalated as valid terminal-for-this-purpose stops -- migration
  -- 155).
  IF NEW.agent_run_id IS NOT NULL THEN
    SELECT status::text INTO v_agent_run_status
    FROM public.agent_runs WHERE id = NEW.agent_run_id;
    IF v_agent_run_status IS NULL OR v_agent_run_status NOT IN ('completed', 'failed') THEN
      v_db_ok := false;
    END IF;
  END IF;

  IF NEW.pil_agent_run_id IS NOT NULL THEN
    SELECT status INTO v_pil_run_status
    FROM public.pil_agent_runs WHERE id = NEW.pil_agent_run_id;
    IF v_pil_run_status IS NULL OR v_pil_run_status NOT IN ('completed', 'failed', 'blocked', 'escalated') THEN
      v_db_ok := false;
    END IF;
  END IF;

  -- Check 3: items_processed is coherent with what was actually written.
  -- NOT a plain items_processed <> items_expected comparison -- across
  -- worker/autonomous-orchestrator.ts's real call sites, items_expected is
  -- routinely set to "items found" (a candidate count) while
  -- items_processed is "items actually acted on", and processing FEWER
  -- than were found is the normal, healthy outcome (items already handled,
  -- filtered by relevance, skipped for a legitimate reason -- e.g. the
  -- "12/50 opportunity(ies) scored" shape logged all over that file). A
  -- blanket mismatch check would have fired on the majority of healthy
  -- completions. Only two shapes are actually incoherent regardless of
  -- business logic: a claimed success with items_processed never recorded
  -- at all (the exact "reported success it had not earned" pattern this
  -- whole initiative exists for), and processing MORE items than were ever
  -- found (structurally impossible). (Check 2 in the prompt -- "do the
  -- expected rows exist in the target table" -- has no generic
  -- target-table column on this row; a caller that knows its own target
  -- table passes reconciliation_passed explicitly, honored below as an
  -- independent contradiction signal.)
  IF NEW.items_expected IS NOT NULL AND NEW.items_expected > 0 AND NEW.items_processed IS NULL THEN
    v_db_ok := false;
  ELSIF NEW.items_expected IS NOT NULL AND NEW.items_processed IS NOT NULL
        AND NEW.items_processed > NEW.items_expected THEN
    v_db_ok := false;
  END IF;

  IF NEW.reconciliation_passed IS FALSE THEN
    v_db_ok := false;
  END IF;

  IF NOT v_db_ok THEN
    PERFORM public.raise_orchestration_alert(
      NEW.organization_id,
      NEW.orchestration_id,
      'state_drift',
      'critical',
      'Step ' || COALESCE(NEW.agent_type, NEW.task_id, 'unknown') ||
        ' reported completed but the database does not corroborate it (items_expected=' ||
        COALESCE(NEW.items_expected::text, 'null') || ', items_processed=' ||
        COALESCE(NEW.items_processed::text, 'null') || ').',
      'orchestration:state_drift:' || NEW.orchestration_id::text
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[alert_rule_state_drift] swallowed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orchestration_logs_alert_state_drift ON public.orchestration_logs;
CREATE TRIGGER orchestration_logs_alert_state_drift
  AFTER INSERT OR UPDATE ON public.orchestration_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.alert_rule_state_drift();

-- ----------------------------------------------------------------------------
-- RULE 5 - timeout. A step whose duration_ms exceeds the applicable
-- timeout, or which has no finished_at past a threshold, raises 'warning'.
-- The threshold mirrors AGENT_TIMEOUT_MS in src/lib/agents/base-agent.ts
-- (60s) -- SQL has no access to that TS constant, so it is duplicated here
-- as a literal; if base-agent.ts's default ever changes, update this
-- literal too. The audit's finding was six agent types silently dying on
-- that 60s timeout with nothing recorded at all; this rule cannot detect a
-- row that was never written (that requires a periodic sweep, and pg_cron
-- is not installed per this migration's hard constraint) -- it catches the
-- two cases a trigger CAN see: a completed write that took too long, and a
-- still-open row (finished_at IS NULL) that gets touched again after the
-- threshold has already passed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alert_rule_timeout() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_timeout_ms int := 60000;
  v_overrun    boolean := false;
  v_label      text;
BEGIN
  IF NEW.duration_ms IS NOT NULL AND NEW.duration_ms > v_timeout_ms THEN
    v_overrun := true;
  ELSIF NEW.finished_at IS NULL AND NEW.started_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (now() - NEW.started_at)) * 1000 > v_timeout_ms THEN
    v_overrun := true;
  END IF;

  IF v_overrun THEN
    v_label := COALESCE(NEW.agent_type, NEW.task_id, 'unknown');
    PERFORM public.raise_orchestration_alert(
      NEW.organization_id,
      NEW.orchestration_id,
      'timeout',
      'warning',
      'Step ' || v_label || ' exceeded the ' || v_timeout_ms || 'ms timeout.',
      'orchestration:timeout:' || NEW.orchestration_id::text || ':' || v_label
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[alert_rule_timeout] swallowed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orchestration_logs_alert_timeout ON public.orchestration_logs;
CREATE TRIGGER orchestration_logs_alert_timeout
  AFTER INSERT OR UPDATE ON public.orchestration_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.alert_rule_timeout();

-- ============================================================================
-- END Migration 191
-- ============================================================================
