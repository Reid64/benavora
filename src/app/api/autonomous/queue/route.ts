import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET/DELETE /api/autonomous/queue - this org's pending agent_queue items
// (migration 080). organization_id is always derived server-side via
// requireRole, never from the request body (Contracts §2).
//
// GET    - queued/processing items, priority DESC then queued_at ASC
//          (BEHAVIORAL_CONTRACTS §23 queue ordering).
// DELETE - cancels one queued item: { id }. Only status='queued' items can
//          be cancelled; an item already picked up by the worker
//          (status='processing') must run to completion.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("agent_queue")
    .select(
      "id, org_id, agent_id, priority, status, trigger_source, input_payload, " +
        "output_payload, error_message, queued_at, started_at, completed_at, " +
        "retry_count, max_retries",
    )
    .eq("org_id", organizationId)
    .in("status", ["queued", "processing"])
    .order("priority", { ascending: false })
    .order("queued_at", { ascending: true });

  if (error) {
    return jsonError("Could not load the agent queue.", "load_failed", 500);
  }

  return NextResponse.json({ queue: data ?? [] });
}

export async function DELETE(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { id } = (body ?? {}) as { id?: unknown };
  if (typeof id !== "string" || id.trim() === "") {
    return jsonError("id is required.", "invalid_input", 400);
  }

  const { data: existing, error: fetchError } = await supabase
    .from("agent_queue")
    .select("id, status")
    .eq("id", id)
    .eq("org_id", organizationId)
    .single();

  if (fetchError || !existing) {
    return jsonError("Queue item not found.", "not_found", 404);
  }
  if (existing.status !== "queued") {
    return jsonError(
      "Only queued items can be cancelled; this item is already processing or finished.",
      "not_cancellable",
      400,
    );
  }

  const { data, error } = await supabase
    .from("agent_queue")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("org_id", organizationId)
    .eq("status", "queued")
    .select("id, status")
    .single();

  if (error || !data) {
    return jsonError("Could not cancel the queue item.", "cancel_failed", 400);
  }

  return NextResponse.json({ queueItem: data });
}
