-- ============================================================================
-- BENAVORA - Migration 198: AR-10.3 - budget periods + period-scoped
-- cost_overage dedup.
--
-- GAP (AR-5.2's own writeup, and this task's brief): cost_budgets has a
-- budget_period column ('daily'/'monthly'/'per_run') but nothing ever reads
-- it -- spent_usd only ever accumulates, forever, under whatever
-- budget_limit_usd is set. "budget_limit_usd" currently means "forever,"
-- which is not a budget. This migration:
--   1. Adds period_start, the anchor a period's window is measured from.
--   2. Adds cost_budget_period_end(period, start) -- a pure function with no
--      table access, so both the accrual trigger and the read path below
--      share one definition of when a period ends, and can't drift.
--      'per_run' has no time-based end: that scope's scope_id is already
--      unique per run, so a "new period" for it is a new row, not a
--      rollover.
--   3. Makes accrue_cost_budget_spend() (migration 187) period-aware: if the
--      period has already elapsed by the time a new cost lands, that spend
--      starts the new period at exactly its own amount instead of piling
--      onto a stale total.
--   4. Adds get_cost_budget_with_reset(), an RPC the app's checkBudget()/
--      checkBudgetMidRun() (src/lib/pil/cost.ts, AR-10.3) now call instead
--      of a plain SELECT: if the period has elapsed and nothing has been
--      spent yet to trigger #3's rollover, this lazily zeroes spent_usd and
--      rolls period_start forward on read -- so a stale "spent" total from
--      the prior window can never block the first run of a new one.
--   5. Rule 2 (alert_rule_cost_overage, migration 191) dedups on
--      (scope_type, scope_id) alone -- once resets exist, a genuine new
--      period's overage carries the identical dedup_key as the prior
--      period's already-resolved alert and is silently dropped by
--      uq_alerts_org_dedup (migration 013). period_start changes exactly
--      when (and only when) a period rolls over, and is otherwise stable
--      within a period (repeated overage UPDATEs in the same period keep
--      reusing it) -- so folding it into the key gives each period its own
--      dedup identity for free, with no new column and no crypto-random
--      component to defeat dedup's own purpose.
--
-- STEP 3 of the task brief - backfill or document: existing cost_overage
-- alerts (16 rows, live-checked against production) are NOT backfilled.
-- Their dedup_key is 3-segment ('orchestration:cost_overage:<scope_type>:
-- <scope_id>'); every alert raised from this migration forward is
-- 4-segment (period_start appended). Those two shapes can never collide in
-- uq_alerts_org_dedup (organization_id, dedup_key) regardless of content --
-- leaving the old rows alone is a strict no-op for dedup correctness. There
-- is also no historically-accurate period_start to backfill them with: they
-- predate the period concept existing at all, so any value written now
-- would be invented, not recovered.
-- ============================================================================

ALTER TABLE cost_budgets
  ADD COLUMN IF NOT EXISTS period_start timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN cost_budgets.period_start IS
  'AR-10.3: anchor timestamp the current budget_period window is measured '
  'from. Rolled forward lazily -- by accrue_cost_budget_spend() on the next '
  'cost landing after the period elapses, or by get_cost_budget_with_reset() '
  'on the next read if nothing has been spent yet in the new period. Never '
  'rolled for budget_period = ''per_run'' (cost_budget_period_end returns '
  'NULL for it -- that scope is one row per run, not a recurring window).';

CREATE OR REPLACE FUNCTION public.cost_budget_period_end(p_period text, p_start timestamptz)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_period
    WHEN 'daily' THEN p_start + interval '1 day'
    WHEN 'monthly' THEN p_start + interval '1 month'
    ELSE NULL
  END;
$$;

-- ----------------------------------------------------------------------------
-- Write path: period-aware accrual. Replaces migration 187's version (same
-- trigger, same wiring -- CREATE OR REPLACE only).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accrue_cost_budget_spend()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_end timestamptz;
  v_elapsed    boolean;
BEGIN
  IF NEW.cost_usd IS NOT NULL THEN
    SELECT public.cost_budget_period_end(budget_period, period_start) INTO v_period_end
      FROM cost_budgets
      WHERE organization_id = NEW.organization_id
        AND scope_type = 'org'
        AND scope_id = NEW.organization_id::text;

    v_elapsed := v_period_end IS NOT NULL AND now() >= v_period_end;

    UPDATE cost_budgets
    SET
      spent_usd = CASE WHEN v_elapsed THEN NEW.cost_usd ELSE spent_usd + NEW.cost_usd END,
      period_start = CASE WHEN v_elapsed THEN now() ELSE period_start END,
      updated_at = now()
    WHERE organization_id = NEW.organization_id
      AND scope_type = 'org'
      AND scope_id = NEW.organization_id::text;
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- Read path: lazy reset on read, for the case where nothing has been spent
-- yet in a new period (so the write-path branch above never ran) but a
-- caller is asking "is this scope allowed to spend" regardless. SECURITY
-- DEFINER + fixed search_path, same rationale as raise_orchestration_alert
-- (migration 191): the reset UPDATE must succeed regardless of the calling
-- role's own grants on cost_budgets.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cost_budget_with_reset(
  p_organization_id uuid,
  p_scope_type text,
  p_scope_id text
) RETURNS cost_budgets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_budget     cost_budgets;
  v_period_end timestamptz;
BEGIN
  SELECT * INTO v_budget FROM cost_budgets
    WHERE organization_id = p_organization_id
      AND scope_type = p_scope_type
      AND scope_id = p_scope_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_period_end := public.cost_budget_period_end(v_budget.budget_period, v_budget.period_start);
  IF v_period_end IS NOT NULL AND now() >= v_period_end THEN
    UPDATE cost_budgets
      SET spent_usd = 0, period_start = now(), updated_at = now()
      WHERE id = v_budget.id
      RETURNING * INTO v_budget;
  END IF;

  RETURN v_budget;
END;
$$;

-- Same access-control rationale as raise_orchestration_alert (migration
-- 191): Supabase grants EXECUTE on every new public-schema function to
-- anon/authenticated by default in addition to PUBLIC, and PostgREST exposes
-- every public-schema function as an RPC endpoint -- this is SECURITY
-- DEFINER with no per-caller organization_id check, so it must only be
-- reachable from the service-role app code that already knows the right org
-- (src/lib/pil/cost.ts).
REVOKE EXECUTE ON FUNCTION public.get_cost_budget_with_reset(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cost_budget_with_reset(uuid, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- Rule 2 dedup key: add the period component. CREATE OR REPLACE keeps the
-- same trigger (migration 191, cost_budgets_alert_cost_overage) wired to the
-- same AFTER INSERT OR UPDATE OF spent_usd, budget_limit_usd event.
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
      -- AR-10.3: period_start appended so a new period's overage is a new
      -- dedup_key, not a collision with the prior period's alert -- see this
      -- migration's header.
      'orchestration:cost_overage:' || NEW.scope_type || ':' || NEW.scope_id || ':' || NEW.period_start::text
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[alert_rule_cost_overage] swallowed: %', SQLERRM;
  RETURN NEW;
END;
$$;
