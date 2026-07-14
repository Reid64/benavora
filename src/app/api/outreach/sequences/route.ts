// GET  /api/outreach/sequences — list the org's follow-up sequences.
// POST /api/outreach/sequences — create a new follow-up sequence.
// Derives organization_id from the authenticated session (never from request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("followup_sequences")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError("Failed to load follow-up sequences.", "db_error", 500);
  }

  return NextResponse.json({ sequences: data ?? [] });
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

  const { name, trigger_stage, steps } = (raw ?? {}) as {
    name?: unknown;
    trigger_stage?: unknown;
    steps?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    return jsonError("name is required.", "invalid_input", 400);
  }
  if (typeof trigger_stage !== "string" || trigger_stage.trim() === "") {
    return jsonError("trigger_stage is required.", "invalid_input", 400);
  }
  if (steps !== undefined && !Array.isArray(steps)) {
    return jsonError("steps must be an array.", "invalid_input", 400);
  }

  const { data, error } = await supabase
    .from("followup_sequences")
    .insert({
      organization_id: organizationId,
      name: name.trim(),
      trigger_stage: trigger_stage.trim(),
      steps: steps ?? [],
    })
    .select()
    .single();

  if (error) {
    return jsonError("Failed to create follow-up sequence.", "db_error", 500);
  }

  return NextResponse.json({ sequence: data }, { status: 201 });
}
