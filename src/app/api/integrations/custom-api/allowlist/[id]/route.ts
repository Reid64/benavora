import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// Custom Connector Domain Allowlist — delete endpoint. Admins and owners
// only. Removing a domain takes effect immediately: both agents re-check the
// allowlist at fetch time, not just at connector-creation time.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { error } = await supabase
    .from("custom_connector_allowlist")
    .delete()
    .eq("id", params.id)
    .eq("organization_id", organizationId);

  if (error) {
    return jsonError("Failed to remove the domain.", "db_error", 500);
  }

  return NextResponse.json({ deleted: true });
}
