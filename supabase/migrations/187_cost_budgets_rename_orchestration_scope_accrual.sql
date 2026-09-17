-- ============================================================================
-- BENAVORA - Migration 187: AR-5.2 - budget enforcement was decorative because
-- spent_usd never accrued. This migration:
--   1. Renames pil_cost_budgets -> cost_budgets (0 rows live, so the rename is
--      free). The v1.0 spec asked for a second table (orchestration_cost_budget);
--      that would duplicate checkBudget()'s enforcement logic and let it drift.
--      One table, one enforcement path, extended with a new scope instead.
--   2. Extends scope_type to admit 'orchestration' alongside the existing
--      'org' / 'agent' / 'research_run' values. scope_type is a plain text
--      CHECK constraint (not a Postgres enum), so this is a normal
--      DROP/ADD CONSTRAINT, not an ALTER TYPE ... ADD VALUE requiring its own
--      transaction.
--   3. Adds an AFTER INSERT trigger on ai_usage_log (the single cost ledger
--      as of migration 185/186) that increments the matching org-scope
--      budget's spent_usd by the inserted row's cost_usd. Pure SQL, no
--      network call (pg_net is not installed on this project) -- a failed
--      application process can no longer skip spend accrual by skipping a
--      second write.
--
-- The constraint is dropped by looking up its live name via pg_constraint
-- rather than assuming the auto-generated name survived the table rename
-- (Postgres does not rename constraints/indexes when a table is renamed).
-- ============================================================================

ALTER TABLE pil_cost_budgets RENAME TO cost_budgets;

DO $$
DECLARE
  cons record;
BEGIN
  FOR cons IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.cost_budgets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%scope_type%'
  LOOP
    EXECUTE format('ALTER TABLE cost_budgets DROP CONSTRAINT %I', cons.conname);
  END LOOP;
END $$;

ALTER TABLE cost_budgets
  ADD CONSTRAINT cost_budgets_scope_type_check
  CHECK (scope_type IN ('org', 'agent', 'research_run', 'orchestration'));

-- ----------------------------------------------------------------------------
-- Spend accrual: fires on every ai_usage_log insert, no-ops when no budget
-- row exists for that org's 'org' scope (matches checkBudget()'s existing
-- "no budget configured -- nothing to enforce yet" behaviour). SECURITY
-- DEFINER + fixed search_path so the update succeeds regardless of the
-- inserting role's own RLS grants on cost_budgets, and can't be hijacked via
-- a mutated search_path.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION accrue_cost_budget_spend()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cost_usd IS NOT NULL THEN
    UPDATE cost_budgets
    SET spent_usd = spent_usd + NEW.cost_usd,
        updated_at = now()
    WHERE organization_id = NEW.organization_id
      AND scope_type = 'org'
      AND scope_id = NEW.organization_id::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_usage_log_accrue_cost_budget ON ai_usage_log;
CREATE TRIGGER ai_usage_log_accrue_cost_budget
  AFTER INSERT ON ai_usage_log
  FOR EACH ROW
  EXECUTE FUNCTION accrue_cost_budget_spend();

COMMENT ON TABLE cost_budgets IS
  'Renamed from pil_cost_budgets (migration 187, AR-5.2). scope_type admits '
  '''orchestration'' in addition to ''org''/''agent''/''research_run''. '
  'spent_usd accrues automatically via the ai_usage_log_accrue_cost_budget '
  'trigger on ai_usage_log -- nothing in application code writes spent_usd.';
