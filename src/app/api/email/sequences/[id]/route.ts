import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import type { TablesUpdate } from "@/types/database";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// GET /api/email/sequences/[id] — get sequence with steps and enrollment stats.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: sequence, error: seqErr } = await supabase
    .from("email_campaign_sequences")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (seqErr) return jsonError("Failed to load sequence.", "db_error", 500);
  if (!sequence) return jsonError("Sequence not found.", "not_found", 404);

  const { data: steps, error: stepsErr } = await supabase
    .from("email_sequence_steps")
    .select("*")
    .eq("sequence_id", params.id)
    .order("step_number", { ascending: true });

  if (stepsErr) return jsonError("Failed to load steps.", "db_error", 500);

  // Enrollment stats
  const { count: totalEnrolled } = await supabase
    .from("email_sequence_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", params.id)
    .eq("organization_id", organizationId);

  const { count: totalActive } = await supabase
    .from("email_sequence_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", params.id)
    .eq("organization_id", organizationId)
    .eq("status", "active");

  const { count: totalCompleted } = await supabase
    .from("email_sequence_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", params.id)
    .eq("organization_id", organizationId)
    .eq("status", "completed");

  const { count: totalReplied } = await supabase
    .from("email_sequence_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", params.id)
    .eq("organization_id", organizationId)
    .eq("reply_detected", true);

  return NextResponse.json({
    sequence,
    steps: steps ?? [],
    stats: {
      total_enrolled: totalEnrolled ?? 0,
      active: totalActive ?? 0,
      completed: totalCompleted ?? 0,
      replied: totalReplied ?? 0,
    },
  });
}

// PATCH /api/email/sequences/[id] — update sequence config.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("email_campaign_sequences")
    .select("id")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchErr) return jsonError("Failed to load sequence.", "db_error", 500);
  if (!existing) return jsonError("Sequence not found.", "not_found", 404);

  const { name, description, status } = (raw ?? {}) as {
    name?: unknown;
    description?: unknown;
    status?: unknown;
  };

  const updates: TablesUpdate<"email_campaign_sequences"> = { updated_at: new Date().toISOString() };
  if (typeof name === "string") updates.name = name.trim();
  if (typeof description === "string") updates.description = description.trim();
  if (typeof status === "string") updates.status = status;

  const { data, error } = await supabase
    .from("email_campaign_sequences")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return jsonError("Failed to update sequence.", "db_error", 500);

  return NextResponse.json({ sequence: data });
}

// DELETE /api/email/sequences/[id] — complete all active enrollments then delete.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: existing, error: fetchErr } = await supabase
    .from("email_campaign_sequences")
    .select("id")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchErr) return jsonError("Failed to load sequence.", "db_error", 500);
  if (!existing) return jsonError("Sequence not found.", "not_found", 404);

  // Complete all active enrollments before deletion
  await supabase
    .from("email_sequence_enrollments")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("sequence_id", params.id)
    .eq("status", "active");

  const { error: deleteErr } = await supabase
    .from("email_campaign_sequences")
    .delete()
    .eq("id", params.id);

  if (deleteErr) return jsonError("Failed to delete sequence.", "db_error", 500);

  return NextResponse.json({ deleted: params.id });
}
