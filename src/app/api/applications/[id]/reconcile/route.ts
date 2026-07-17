// GET /api/applications/[id]/reconcile — compute budget-vs-actual variance for
// an application and upsert the result into grant_reconciliation_reports.
// Derives organization_id from the authenticated session (never from request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

type ComplianceStatus = "under_budget" | "on_budget" | "over_budget" | "no_budget_set";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("id, organization_id, requested_amount, awarded_amount")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (appError) {
    return jsonError("Failed to load application.", "db_error", 500);
  }
  if (!application) {
    return jsonError("Application not found.", "not_found", 404);
  }

  const { data: budget, error: budgetError } = await supabase
    .from("grant_budgets")
    .select("total_budget, total_approved")
    .eq("organization_id", organizationId)
    .eq("application_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (budgetError) {
    return jsonError("Failed to load the grant budget.", "db_error", 500);
  }

  const { data: expenses, error: expensesError } = await supabase
    .from("grant_expenses")
    .select("amount")
    .eq("organization_id", organizationId)
    .eq("application_id", params.id);

  if (expensesError) {
    return jsonError("Failed to load grant expenses.", "db_error", 500);
  }

  const hasBudget = budget?.total_budget !== undefined && budget?.total_budget !== null;
  const totalBudget = hasBudget
    ? Number(budget!.total_budget)
    : application.awarded_amount ?? application.requested_amount ?? 0;
  const totalSpent = (expenses ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const variance = totalBudget - totalSpent;

  const complianceStatus: ComplianceStatus = !hasBudget
    ? "no_budget_set"
    : variance > 0
      ? "under_budget"
      : variance < 0
        ? "over_budget"
        : "on_budget";

  const { data: report, error: upsertError } = await supabase
    .from("grant_reconciliation_reports")
    .upsert(
      {
        organization_id: organizationId,
        application_id: params.id,
        total_budget: totalBudget,
        total_spent: totalSpent,
        variance,
        compliance_status: complianceStatus,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,application_id" },
    )
    .select()
    .single();

  if (upsertError) {
    return jsonError("Failed to save the reconciliation report.", "db_error", 500);
  }

  return NextResponse.json({ report });
}
