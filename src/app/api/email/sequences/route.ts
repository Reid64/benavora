import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { sequenceEngine } from "@/lib/email/sequence-engine";
import type { SequenceConfig } from "@/lib/email/sequence-engine";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// GET /api/email/sequences — list all sequences for the org.
export async function GET(_request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("email_campaign_sequences")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) return jsonError("Failed to load sequences.", "db_error", 500);

  return NextResponse.json({ sequences: data ?? [] });
}

// POST /api/email/sequences — create a new sequence with steps.
export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { name, description, steps } = (raw ?? {}) as {
    name?: unknown;
    description?: unknown;
    steps?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    return jsonError("name is required.", "invalid_input", 400);
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    return jsonError("steps must be a non-empty array.", "invalid_input", 400);
  }

  for (const [i, step] of steps.entries()) {
    const s = step as Record<string, unknown>;
    if (typeof s.delay_days !== "number") {
      return jsonError(`steps[${i}].delay_days must be a number.`, "invalid_input", 400);
    }
  }

  const config: SequenceConfig = {
    name: name.trim(),
    description: typeof description === "string" ? description.trim() : undefined,
    steps: (steps as Array<Record<string, unknown>>).map((s) => ({
      template_id: typeof s.template_id === "string" ? s.template_id : undefined,
      subject_override: typeof s.subject_override === "string" ? s.subject_override : undefined,
      body_override: typeof s.body_override === "string" ? s.body_override : undefined,
      delay_days: s.delay_days as number,
      delay_hours: typeof s.delay_hours === "number" ? s.delay_hours : undefined,
      condition_type: typeof s.condition_type === "string" ? s.condition_type : undefined,
    })),
  };

  try {
    const id = await sequenceEngine.createSequence(organizationId, config);
    return NextResponse.json({ id }, { status: 201 });
  } catch {
    // sequenceEngine can surface raw Postgres error text — never relay that
    // to the client (checklist: no raw exception/message/stack leakage).
    return jsonError("Failed to create sequence.", "create_failed", 500);
  }
}
