import { getPilClient } from "@/lib/pil/db";
import type { CostBudget, CostLedgerEntry } from "@/lib/pil/types";

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
export async function recordCost(entry: Omit<CostLedgerEntry, "id" | "created_at">): Promise<void> {
  const { error } = await getPilClient().from("ai_usage_log").insert(entry);
  if (error) throw error;
}

export async function checkBudget(
  orgId: string,
  costType: string,
): Promise<{ allowed: boolean; remaining_usd: number; hard_stop: boolean }> {
  // pil_cost_budgets has no cost_type column -- budgets are scoped by
  // scope_type/scope_id ('org'/'agent'/'research_run'), not by cost_type
  // (pil_cost_ledger.cost_type is the ledger row's own dimension, separate
  // from how budgets are scoped). This checks the org-level budget, the
  // scope that applies to every cost_type uniformly.
  const { data: budget, error } = await getPilClient()
    .from("pil_cost_budgets")
    .select("*")
    .eq("organization_id", orgId)
    .eq("scope_type", "org")
    .eq("scope_id", orgId)
    .maybeSingle();
  if (error) throw error;

  if (!budget) {
    // No budget row configured for this org -- nothing to enforce yet.
    return { allowed: true, remaining_usd: Infinity, hard_stop: false };
  }

  const row = budget as CostBudget;
  const remaining = row.budget_limit_usd - row.spent_usd;
  const allowed = remaining > 0 || !row.hard_stop;

  if (!allowed) {
    throw new BudgetExceededError(
      `Budget exceeded for org ${orgId} (${costType}): spent $${row.spent_usd} of $${row.budget_limit_usd} limit, hard_stop enabled`,
    );
  }

  return { allowed, remaining_usd: remaining, hard_stop: row.hard_stop };
}

export async function getBudgetSummary(orgId: string): Promise<CostBudget[]> {
  const { data, error } = await getPilClient()
    .from("pil_cost_budgets")
    .select("*")
    .eq("organization_id", orgId);
  if (error) throw error;
  return (data ?? []) as CostBudget[];
}
