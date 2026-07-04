import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { sendSingleFollowUp } from "@/lib/autoapply/follow-up-scheduler";

// PATCH /api/autoapply/follow-ups/[id] — { action: "send_now" | "reschedule" | "cancel" }
// send_now calls Claude (content generation) + Resend (send), same as the
// scheduled batch path — give it the same time budget as the other AI routes.
export const runtime = "nodejs";
export const maxDuration = 300;

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

  const { action, scheduled_at, cancel_reason } = (body ?? {}) as {
    action?: unknown;
    scheduled_at?: unknown;
    cancel_reason?: unknown;
  };

  if (action !== "send_now" && action !== "reschedule" && action !== "cancel") {
    return jsonError(
      'action must be one of: "send_now", "reschedule", "cancel".',
      "invalid_input",
      400,
    );
  }

  const { data: item, error: fetchError } = await supabase
    .from("autoapply_follow_ups")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchError || !item) {
    return jsonError("Follow-up not found.", "not_found", 404);
  }

  if (action === "send_now") {
    const outcome = await sendSingleFollowUp(item, supabase);
    if (!outcome.sent) {
      const reason = outcome.skipped ? outcome.reason : outcome.error;
      return jsonError(`Could not send follow-up: ${reason}`, "send_failed", 422);
    }
    return NextResponse.json({ success: true });
  }

  if (item.status !== "pending") {
    return jsonError(
      `Only pending follow-ups can be ${action === "reschedule" ? "rescheduled" : "cancelled"}.`,
      "invalid_status",
      409,
    );
  }

  if (action === "reschedule") {
    if (typeof scheduled_at !== "string" || !scheduled_at) {
      return jsonError("scheduled_at is required to reschedule.", "missing_scheduled_at", 400);
    }
    const parsed = new Date(scheduled_at);
    if (Number.isNaN(parsed.getTime())) {
      return jsonError("scheduled_at must be a valid date.", "invalid_scheduled_at", 400);
    }
    const { error } = await supabase
      .from("autoapply_follow_ups")
      .update({ scheduled_at: parsed.toISOString() })
      .eq("id", params.id)
      .eq("organization_id", organizationId);
    if (error) return jsonError("Failed to reschedule.", "update_failed", 500);
    return NextResponse.json({ success: true });
  }

  // action === "cancel"
  const { error } = await supabase
    .from("autoapply_follow_ups")
    .update({
      status: "cancelled",
      cancel_reason:
        typeof cancel_reason === "string" && cancel_reason ? cancel_reason : "User cancelled",
    })
    .eq("id", params.id)
    .eq("organization_id", organizationId);
  if (error) return jsonError("Failed to cancel.", "update_failed", 500);
  return NextResponse.json({ success: true });
}
