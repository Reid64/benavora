import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// PATCH /api/autoapply/review-queue/[id]/reassign — AUTOAPPLY_ARCHITECTURE_V2.md
// §10C. Body: { assigneeUserId: string }. Reassignment routes the paused item
// to another team member — it does not resolve the pause (status stays
// 'paused_verification'), so the guarded reassign_paused_submission_queue_item()
// RPC (116_review_queue_rpc_functions.sql) only appends an audit-log entry to
// paused_history. Same WHERE-guard-returns-null-on-conflict pattern as
// /resume and /skip.
//
// Notification insert mirrors ManualQueue.tsx's handleReassign() exactly:
// same automation_notifications shape, same event_type family.

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const { assigneeUserId } = (body ?? {}) as { assigneeUserId?: unknown };
  if (typeof assigneeUserId !== "string" || !assigneeUserId) {
    return NextResponse.json(
      { error: "assigneeUserId is required." },
      { status: 400 },
    );
  }

  // Verify the assignee is a real member of this org (never trust the body's
  // id alone — Behavioral Contracts §2 pattern applied to a foreign-key body
  // param, not just organization_id).
  const { data: assignee, error: assigneeErr } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", assigneeUserId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (assigneeErr || !assignee) {
    return NextResponse.json(
      { error: "assigneeUserId must be a member of your organization." },
      { status: 400 },
    );
  }

  // Read the funder name for the notification message before the guarded
  // write — a plain read, not part of the concurrency-guarded mutation
  // itself (the RPC's own WHERE clause is the sole source of truth for
  // whether the reassignment actually applies).
  const { data: queueRow } = await supabase
    .from("submission_queue")
    .select("funders(name)")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle<{ funders: { name: string } | null }>();
  const funderName = queueRow?.funders?.name ?? "Unknown funder";

  const { data, error } = await supabase.rpc(
    "reassign_paused_submission_queue_item",
    {
      p_id: params.id,
      p_org_id: organizationId,
      p_assignee_id: assigneeUserId,
      p_reviewer_id: userId,
    },
  );

  if (error) {
    return NextResponse.json(
      { error: "Could not reassign this submission." },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        error: "Already handled by another reviewer.",
        code: "already_handled",
      },
      { status: 409 },
    );
  }

  // Real live automation_notifications columns are organization_id,
  // session_id, event_type, message, is_read, sent_via, created_at — no
  // title/related_entity_type/related_entity_id (ManualQueue.tsx's
  // handleReassign() includes those, but they don't exist on the live table
  // and that insert has always silently failed; not repeating that bug here
  // — funder context is folded into the message text instead).
  const { error: notifyError } = await supabase.from("automation_notifications").insert({
    organization_id: organizationId,
    event_type: "review_queue_reassigned",
    message: `Review Queue: paused submission for ${funderName} has been assigned to ${assignee.full_name ?? assignee.email ?? "a team member"} for review.`,
    is_read: false,
    sent_via: "in_app",
  });
  if (notifyError) {
    console.error("[review-queue/reassign] notification insert failed:", notifyError.message);
  }

  return NextResponse.json({ success: true, id: data });
}
