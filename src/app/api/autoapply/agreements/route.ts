// GET  /api/autoapply/agreements — list grant agreements for the org.
// POST /api/autoapply/agreements — create a new agreement linked to a submission.
// Derives organization_id from the authenticated session (never from request body).

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const VALID_AWARD_TYPES = [
  "grant",
  "donation",
  "sponsorship",
  "in_kind",
  "land",
  "service",
  "volunteer",
  "partnership",
  "other",
] as const;

type AwardType = (typeof VALID_AWARD_TYPES)[number];

function isValidAwardType(v: unknown): v is AwardType {
  return (
    typeof v === "string" &&
    (VALID_AWARD_TYPES as readonly string[]).includes(v)
  );
}

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

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: agreements, error } = await supabase
    .from("grant_agreements")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load agreements." },
      { status: 500 },
    );
  }

  return NextResponse.json({ agreements: agreements ?? [] });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  const {
    submission_id,
    funder_id,
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

  if (typeof funder_id !== "string" || funder_id.trim().length === 0) {
    return NextResponse.json(
      { error: "funder_id is required." },
      { status: 400 },
    );
  }

  if (award_type != null && !isValidAwardType(award_type)) {
    return NextResponse.json(
      {
        error: `award_type must be one of: ${VALID_AWARD_TYPES.join(", ")}.`,
      },
      { status: 400 },
    );
  }

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

  const { data, error } = await supabase
    .from("grant_agreements")
    .insert({
      organization_id: organizationId,
      funder_id: funder_id.trim(),
      submission_id:
        typeof submission_id === "string" ? submission_id.trim() : null,
      amount_awarded:
        typeof amount_awarded === "number" ? amount_awarded : null,
      award_type: isValidAwardType(award_type) ? award_type : null,
      agreement_date:
        typeof agreement_date === "string" ? agreement_date : null,
      start_date: typeof start_date === "string" ? start_date : null,
      end_date: typeof end_date === "string" ? end_date : null,
      terms: typeof terms === "string" ? terms.trim() || null : null,
      reporting_requirements:
        reporting_requirements != null &&
        typeof reporting_requirements === "object"
          ? (reporting_requirements as Record<string, unknown>)
          : null,
      payment_schedule:
        payment_schedule != null && typeof payment_schedule === "object"
          ? (payment_schedule as Record<string, unknown>)
          : null,
      status: isValidStatus(status) ? status : "pending",
      notes: typeof notes === "string" ? notes.trim() || null : null,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create agreement." },
      { status: 500 },
    );
  }

  return NextResponse.json({ agreement: data }, { status: 201 });
}
