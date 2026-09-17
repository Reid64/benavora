import { getPilClient } from "@/lib/pil/db";
import type { CostBudget, CostBudgetScopeType, CostLedgerEntry } from "@/lib/pil/types";

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

// AR-5.1: ai_usage_log is now the single per-call cost ledger (migrations
// 185/186); pil_cost_ledger is superseded and read-only -- nothing may
// INSERT into it anymore. `id` and `created_at` are DB-generated (both
// defaulted), so those are what's omitted from the caller-supplied entry.
//
// AR-5.2: every insert here fires ai_usage_log_accrue_cost_budget (migration
// 187), which increments the matching org-scope cost_budgets.spent_usd row
// by entry.cost_usd. recordCost() itself does not touch cost_budgets --
// accrual is a DB trigger so it can't be skipped by a caller that forgets to.
export async function recordCost(entry: Omit<CostLedgerEntry, "id" | "created_at">): Promise<void> {
  const { error } = await getPilClient().from("ai_usage_log").insert(entry);
  if (error) throw error;
}

// AR-5.2: cost_budgets was renamed from its pre-migration-187 name (0 rows,
// free rename), and this check generalized from a hardcoded org-scope check
// to any (scopeType, scopeId)
// pair -- scope_type now also admits 'orchestration'. scopeType/scopeId
// default to the org scope so the pre-existing call site (checkBudget(orgId))
// keeps checking exactly what it checked before.
export async function checkBudget(
  orgId: string,
  scopeType: CostBudgetScopeType = "org",
  scopeId: string = orgId,
): Promise<{ allowed: boolean; remaining_usd: number; hard_stop: boolean }> {
  const { data: budget, error } = await getPilClient()
    .from("cost_budgets")
    .select("*")
    .eq("organization_id", orgId)
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId)
    .maybeSingle();
  if (error) throw error;

  if (!budget) {
    // No budget row configured for this scope -- nothing to enforce yet.
    return { allowed: true, remaining_usd: Infinity, hard_stop: false };
  }

  const row = budget as CostBudget;
  const remaining = row.budget_limit_usd - row.spent_usd;
  const allowed = remaining > 0 || !row.hard_stop;

  if (!allowed) {
    throw new BudgetExceededError(
      `Budget exceeded for org ${orgId} (${scopeType}:${scopeId}): spent $${row.spent_usd} of $${row.budget_limit_usd} limit, hard_stop enabled`,
    );
  }

  return { allowed, remaining_usd: remaining, hard_stop: row.hard_stop };
}

export async function getBudgetSummary(orgId: string): Promise<CostBudget[]> {
  const { data, error } = await getPilClient()
    .from("cost_budgets")
    .select("*")
    .eq("organization_id", orgId);
  if (error) throw error;
  return (data ?? []) as CostBudget[];
}
