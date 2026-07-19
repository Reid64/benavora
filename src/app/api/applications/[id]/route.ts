// PATCH /api/applications/[id]
// Minimal update endpoint backing the autonomous draft review queue's
// "Dismiss" action (/draft-generator/autonomous) — flips pending_review off
// without deleting the application or its draft. Scoped to pending_review
// only; this isn't a general application-mutation endpoint.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { pending_review: pendingReview } = (body ?? {}) as {
    pending_review?: unknown;
  };
  if (typeof pendingReview !== "boolean") {
    return jsonError(
      "pending_review (boolean) is required.",
      "invalid_input",
      400,
    );
  }

  const { data: updated, error } = await supabase
    .from("applications")
    .update({ pending_review: pendingReview })
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .select("id")
    .maybeSingle();

  if (error) {
    return jsonError("Could not update the application.", "update_failed", 500);
  }
  if (!updated) {
    return jsonError("Application not found.", "not_found", 404);
  }

  return NextResponse.json({ id: updated.id as string, pending_review: pendingReview });
}
