// GET  /api/applications/[id]/expenses — list expenses recorded against an application.
// POST /api/applications/[id]/expenses — add a new expense line item.
// Derives organization_id from the authenticated session (never from request body).

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

async function loadApplication(
  supabase: SupabaseClient,
  organizationId: string,
  applicationId: string,
) {
  return supabase
    .from("applications")
    .select("id, organization_id")
    .eq("id", applicationId)
    .eq("organization_id", organizationId)
    .maybeSingle();
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: application, error: appError } = await loadApplication(
    supabase,
    organizationId,
    params.id,
  );
  if (appError) {
    return jsonError("Failed to load application.", "db_error", 500);
  }
  if (!application) {
    return jsonError("Application not found.", "not_found", 404);
  }

  const { data, error } = await supabase
    .from("grant_expenses")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("application_id", params.id)
    .order("expense_date", { ascending: false });

  if (error) {
    return jsonError("Failed to load grant expenses.", "db_error", 500);
  }

  return NextResponse.json({ expenses: data ?? [] });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: application, error: appError } = await loadApplication(
    supabase,
    organizationId,
    params.id,
  );
  if (appError) {
    return jsonError("Failed to load application.", "db_error", 500);
  }
  if (!application) {
    return jsonError("Application not found.", "not_found", 404);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const {
    category,
    description,
    amount,
    expense_date: expenseDate,
    receipt_url: receiptUrl,
  } = (raw ?? {}) as {
    category?: unknown;
    description?: unknown;
    amount?: unknown;
    expense_date?: unknown;
    receipt_url?: unknown;
  };

  if (typeof category !== "string" || category.trim() === "") {
    return jsonError("category is required.", "invalid_input", 400);
  }
  if (typeof description !== "string" || description.trim() === "") {
    return jsonError("description is required.", "invalid_input", 400);
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
      application_id: params.id,
      category: category.trim(),
      description: description.trim(),
      amount: parsedAmount,
      expense_date:
        typeof expenseDate === "string" && expenseDate.trim() !== "" ? expenseDate : null,
      receipt_url:
        typeof receiptUrl === "string" && receiptUrl.trim() !== "" ? receiptUrl.trim() : null,
    })
    .select()
    .single();

  if (error) {
    return jsonError("Failed to create the grant expense.", "db_error", 500);
  }

  return NextResponse.json({ expense: data }, { status: 201 });
}
