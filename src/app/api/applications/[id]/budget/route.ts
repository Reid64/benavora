// GET  /api/applications/[id]/budget — return the application's grant budget (or null).
// POST /api/applications/[id]/budget — upsert the application's grant budget line items.
// Derives organization_id from the authenticated session (never from request body).

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

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

interface LineItem {
  category: string;
  label?: string;
  amount: number;
}

function parseLineItems(value: unknown): LineItem[] {
  if (!Array.isArray(value)) return [];
  const items: LineItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const category = typeof item.category === "string" ? item.category.trim() : "";
    if (!category) continue;
    items.push({
      category,
      label: typeof item.label === "string" ? item.label.trim() : undefined,
      amount: toNumberOrZero(item.amount),
    });
  }
  return items;
}

async function loadApplication(
  supabase: SupabaseClient,
  organizationId: string,
  applicationId: string,
) {
  return supabase
    .from("applications")
    .select("id, organization_id, awarded_amount, requested_amount")
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
    .from("grant_budgets")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("application_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return jsonError("Failed to load grant budget.", "db_error", 500);
  }

  return NextResponse.json({ budget: data ?? null });
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

  const body = (raw ?? {}) as {
    line_items?: unknown;
    total_requested?: unknown;
    total_approved?: unknown;
    period_start?: unknown;
    period_end?: unknown;
  };

  const lineItems = parseLineItems(body.line_items);
  const lineItemTotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const totalRequested =
    body.total_requested !== undefined ? toNumberOrZero(body.total_requested) : lineItemTotal;
  const totalApproved =
    body.total_approved !== undefined && body.total_approved !== null
      ? toNumberOrZero(body.total_approved)
      : null;
  const periodStart =
    typeof body.period_start === "string" && body.period_start.trim() !== ""
      ? body.period_start
      : null;
  const periodEnd =
    typeof body.period_end === "string" && body.period_end.trim() !== ""
      ? body.period_end
      : null;

  const { data: existing, error: existingError } = await supabase
    .from("grant_budgets")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("application_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return jsonError("Failed to check for an existing grant budget.", "db_error", 500);
  }

  const payload = {
    organization_id: organizationId,
    application_id: params.id,
    total_budget: totalRequested,
    total_approved: totalApproved,
    line_items: lineItems,
    period_start: periodStart,
    period_end: periodEnd,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = existing
    ? await supabase
        .from("grant_budgets")
        .update(payload)
        .eq("id", existing.id)
        .select()
        .single()
    : await supabase.from("grant_budgets").insert(payload).select().single();

  if (error) {
    return jsonError("Failed to save the grant budget.", "db_error", 500);
  }

  return NextResponse.json({ budget: data }, { status: existing ? 200 : 201 });
}
