// GET  /api/financials/expenses — list the org's grant expenses, optionally filtered by budget.
// POST /api/financials/expenses — create a new grant expense line item.
// Derives organization_id from the authenticated session (never from request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const budgetId = searchParams.get("budget_id");

  const base = supabase
    .from("grant_expenses")
    .select("*")
    .eq("organization_id", organizationId)
    .order("expense_date", { ascending: false });

  const { data, error } = await (budgetId ? base.eq("budget_id", budgetId) : base);

  if (error) {
    return jsonError("Failed to load grant expenses.", "db_error", 500);
  }

  return NextResponse.json({ expenses: data ?? [] });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const {
    budget_id: budgetId,
    category,
    description,
    amount,
    expense_date: expenseDate,
  } = (raw ?? {}) as {
    budget_id?: unknown;
    category?: unknown;
    description?: unknown;
    amount?: unknown;
    expense_date?: unknown;
  };

  if (typeof budgetId !== "string" || budgetId.trim() === "") {
    return jsonError("budget_id is required.", "invalid_input", 400);
  }

  const parsedAmount =
    typeof amount === "number"
      ? amount
      : typeof amount === "string" && amount.trim() !== ""
        ? Number(amount)
        : NaN;

  if (!Number.isFinite(parsedAmount)) {
    return jsonError("amount is required and must be a number.", "invalid_input", 400);
  }

  const { data, error } = await supabase
    .from("grant_expenses")
    .insert({
      organization_id: organizationId,
      budget_id: budgetId,
      category: typeof category === "string" && category.trim() !== "" ? category.trim() : null,
      description:
        typeof description === "string" && description.trim() !== "" ? description.trim() : null,
      amount: parsedAmount,
      expense_date:
        typeof expenseDate === "string" && expenseDate.trim() !== "" ? expenseDate : null,
    })
    .select()
    .single();

  if (error) {
    return jsonError("Failed to create grant expense.", "db_error", 500);
  }

  return NextResponse.json({ expense: data }, { status: 201 });
}
