import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// Custom API Connection — update and delete endpoints.
//
// PATCH  — toggle is_active, or update name / poll_schedule.
//           Re-activating a connection resets error_count to 0 so it gets
//           fresh retries (BEHAVIORAL_CONTRACTS §20).
// DELETE — permanently remove the connection. Discovered opportunities are kept.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof raw.is_active === "boolean") patch.is_active = raw.is_active;
  if (typeof raw.name === "string" && raw.name.trim())
    patch.name = raw.name.trim();
  if (
    typeof raw.poll_schedule === "string" &&
    ["hourly", "daily", "weekly", "monthly"].includes(raw.poll_schedule)
  ) {
    patch.poll_schedule = raw.poll_schedule;
  }

  // Only the timestamp was added — nothing meaningful changed.
  if (Object.keys(patch).length === 1) {
    return jsonError("No valid fields to update.", "no_op", 400);
  }

  // Re-activating: reset error_count so the connection gets fresh retries.
  if (raw.is_active === true) patch.error_count = 0;

  const { data, error } = await supabase
    .from("custom_api_connections")
    .update(patch)
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .select("id, name, is_active, error_count, updated_at")
    .single();

  if (error) {
    return jsonError("Failed to update the custom API connection.", "db_error", 500);
  }
  if (!data) {
    return jsonError("Connection not found.", "not_found", 404);
  }

  return NextResponse.json({ connection: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { error } = await supabase
    .from("custom_api_connections")
    .delete()
    .eq("id", params.id)
    .eq("organization_id", organizationId);

  if (error) {
    return jsonError("Failed to delete the custom API connection.", "db_error", 500);
  }

  return NextResponse.json({ deleted: true });
}
