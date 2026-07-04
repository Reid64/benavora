import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// PATCH /api/autoapply/follow-ups/cancel-all/[funderId] — cancel every pending
// follow-up in the sequence for a given funder (org-scoped).

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: { funderId: string } },
) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { cancel_reason } = (body ?? {}) as { cancel_reason?: unknown };

  const { error } = await supabase
    .from("autoapply_follow_ups")
    .update({
      status: "cancelled",
      cancel_reason:
        typeof cancel_reason === "string" && cancel_reason ? cancel_reason : "User cancelled",
    })
    .eq("organization_id", organizationId)
    .eq("funder_id", params.funderId)
    .eq("status", "pending");

  if (error) {
    return jsonError("Failed to cancel follow-ups.", "update_failed", 500);
  }

  return NextResponse.json({ success: true });
}
