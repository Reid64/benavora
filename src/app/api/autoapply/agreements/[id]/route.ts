// GET /api/autoapply/agreements/[id] — retrieve a single grant agreement.
// PUT /api/autoapply/agreements/[id] — update agreement status or details.
// Derives organization_id from the authenticated session (never from request body).

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const VALID_STATUSES = [
  "pending",
  "active",
  "completed",
  "cancelled",
  "on_hold",
] as const;

function isValidStatus(v: unknown): v is (typeof VALID_STATUSES)[number] {
  return (
    typeof v === "string" &&
    (VALID_STATUSES as readonly string[]).includes(v)
  );
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: agreement, error } = await supabase
    .from("grant_agreements")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to load agreement." },
      { status: 500 },
    );
  }

  if (!agreement) {
    return NextResponse.json(
      { error: "Agreement not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ agreement });
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  // Verify ownership before update
  const { data: existing, error: fetchError } = await supabase
    .from("grant_agreements")
    .select("id")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json(
      { error: "Failed to verify agreement." },
      { status: 500 },
    );
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Agreement not found." },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  const {
    amount_awarded,
    award_type,
    agreement_date,
    start_date,
    end_date,
    terms,
    reporting_requirements,
    payment_schedule,
    status,
    notes,
  } = raw;

  if (status != null && !isValidStatus(status)) {
    return NextResponse.json(
      {
        error: `status must be one of: ${VALID_STATUSES.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  if (amount_awarded != null && typeof amount_awarded !== "number") {
    return NextResponse.json(
      { error: "amount_awarded must be a number." },
      { status: 400 },
    );
  }

  // Build update payload — only include fields present in the request body
  const update: Record<string, unknown> = {};

  if ("amount_awarded" in raw) {
    update["amount_awarded"] =
      typeof amount_awarded === "number" ? amount_awarded : null;
  }
  if ("award_type" in raw) {
    update["award_type"] =
      typeof award_type === "string" ? award_type : null;
  }
  if ("agreement_date" in raw) {
    update["agreement_date"] =
      typeof agreement_date === "string" ? agreement_date : null;
  }
  if ("start_date" in raw) {
    update["start_date"] =
      typeof start_date === "string" ? start_date : null;
  }
  if ("end_date" in raw) {
    update["end_date"] = typeof end_date === "string" ? end_date : null;
  }
  if ("terms" in raw) {
    update["terms"] =
      typeof terms === "string" ? terms.trim() || null : null;
  }
  if ("reporting_requirements" in raw) {
    update["reporting_requirements"] =
      reporting_requirements != null &&
      typeof reporting_requirements === "object"
        ? (reporting_requirements as Record<string, unknown>)
        : null;
  }
  if ("payment_schedule" in raw) {
    update["payment_schedule"] =
      payment_schedule != null && typeof payment_schedule === "object"
        ? (payment_schedule as Record<string, unknown>)
        : null;
  }
  if ("status" in raw && isValidStatus(status)) {
    update["status"] = status;
  }
  if ("notes" in raw) {
    update["notes"] =
      typeof notes === "string" ? notes.trim() || null : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("grant_agreements")
    .update(update)
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to update agreement." },
      { status: 500 },
    );
  }

  return NextResponse.json({ agreement: data });
}
