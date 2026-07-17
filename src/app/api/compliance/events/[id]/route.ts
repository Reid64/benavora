import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// PATCH  /api/compliance/events/[id] - mark a compliance event complete.
// DELETE /api/compliance/events/[id] - remove a compliance event.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("compliance_events")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .select()
    .single();

  if (error) {
    return jsonError("Failed to mark the compliance event complete.", "db_error", 500);
  }

  return NextResponse.json({ event: data });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { error } = await supabase
    .from("compliance_events")
    .delete()
    .eq("id", params.id)
    .eq("organization_id", organizationId);

  if (error) {
    return jsonError("Failed to delete the compliance event.", "db_error", 500);
  }

  return NextResponse.json({ success: true });
}
