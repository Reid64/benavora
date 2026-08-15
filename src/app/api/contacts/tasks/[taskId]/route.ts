// PATCH /api/contacts/tasks/[taskId] — row #77 Multi-Channel Outreach.
// Lets a human mark a logged outreach task complete or cancelled once
// they've actually sent the LinkedIn message, made the call, or mailed the
// letter. RLS-scoped via the session client - a writer can only touch tasks
// inside their own organization.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

const VALID_STATUS = ["pending", "completed", "cancelled"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase } = gate;
  const { taskId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const { status } = (body ?? {}) as { status?: unknown };
  if (typeof status !== "string" || !VALID_STATUS.includes(status as (typeof VALID_STATUS)[number])) {
    return jsonError("status must be one of pending, completed, cancelled.", 400);
  }

  const { data, error } = await supabase
    .from("contact_tasks")
    .update({
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .select("*")
    .single();

  if (error || !data) return jsonError("Task not found.", 404);

  return NextResponse.json({ task: data });
}
