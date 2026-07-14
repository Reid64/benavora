// GET  /api/financials/budgets — list the org's grant budgets, optionally filtered by application.
// POST /api/financials/budgets — create a new grant budget.
// Derives organization_id from the authenticated session (never from request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function toNumberOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const applicationId = searchParams.get("application_id");

  const base = supabase
    .from("grant_budgets")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  const { data, error } = await (applicationId
    ? base.eq("application_id", applicationId)
    : base);

  if (error) {
    return jsonError("Failed to load grant budgets.", "db_error", 500);
  }

  return NextResponse.json({ budgets: data ?? [] });
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
    application_id: applicationId,
    total_budget: totalBudget,
    personnel,
    supplies,
    equipment,
    other,
    period_start: periodStart,
    period_end: periodEnd,
  } = (raw ?? {}) as {
    application_id?: unknown;
    total_budget?: unknown;
    personnel?: unknown;
    supplies?: unknown;
    equipment?: unknown;
    other?: unknown;
    period_start?: unknown;
    period_end?: unknown;
  };

  if (applicationId !== undefined && applicationId !== null && typeof applicationId !== "string") {
    return jsonError("application_id must be a string.", "invalid_input", 400);
  }

  const { data, error } = await supabase
    .from("grant_budgets")
    .insert({
      organization_id: organizationId,
      application_id: typeof applicationId === "string" ? applicationId : null,
      total_budget: toNumberOrZero(totalBudget),
      personnel: toNumberOrZero(personnel),
      supplies: toNumberOrZero(supplies),
      equipment: toNumberOrZero(equipment),
      other: toNumberOrZero(other),
      period_start: typeof periodStart === "string" && periodStart.trim() !== "" ? periodStart : null,
      period_end: typeof periodEnd === "string" && periodEnd.trim() !== "" ? periodEnd : null,
    })
    .select()
    .single();

  if (error) {
    return jsonError("Failed to create grant budget.", "db_error", 500);
  }

  return NextResponse.json({ budget: data }, { status: 201 });
}
