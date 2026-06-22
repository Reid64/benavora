// GET    /api/drafts/queue/[id] — queue item detail with draft content if generated.
// PATCH  /api/drafts/queue/[id] — execute an action on a queue item.
// DELETE /api/drafts/queue/[id] — soft-delete (reject with reason "removed_from_queue").
// Derives organization_id from the authenticated session (never the request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { id } = params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Queue item not found." }, { status: 404 });
  }

  const { data: item, error } = await supabase
    .from("draft_queue")
    .select(
      "*, opportunity:opportunities(id, name, deadline, funder_id, funder:funders(id, name))",
    )
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !item) {
    return NextResponse.json({ error: "Queue item not found." }, { status: 404 });
  }

  const row = item as typeof item & { draft_id?: string | null };
  let draft: Record<string, unknown> | null = null;

  if (row.draft_id) {
    const { data: draftRow } = await supabase
      .from("draft_versions")
      .select(
        "id, content, confidence_score, version_number, humanization_status, knowledge_sources, created_at",
      )
      .eq("id", row.draft_id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    draft = (draftRow as Record<string, unknown> | null) ?? null;
  }

  return NextResponse.json({ item, draft });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { id } = params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Queue item not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const action = input.action;

  if (typeof action !== "string") {
    return NextResponse.json({ error: "action is required." }, { status: 400 });
  }

  // Fetch the queue item to verify ownership and get current state.
  const { data: item, error: fetchError } = await supabase
    .from("draft_queue")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchError || !item) {
    return NextResponse.json({ error: "Queue item not found." }, { status: 404 });
  }

  const now = new Date().toISOString();

  type QueueUpdate = Record<string, unknown>;

  if (action === "approve") {
    const update: QueueUpdate = {
      status: "approved",
      approved_at: now,
      updated_at: now,
    };

    const { error: updateError } = await supabase
      .from("draft_queue")
      .update(update)
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (updateError) {
      return NextResponse.json({ error: "Failed to approve queue item." }, { status: 500 });
    }

    // Check if auto-submit conditions are met.
    const { data: config } = await supabase
      .from("draft_automation_config")
      .select("auto_submit_above_confidence")
      .eq("organization_id", organizationId)
      .maybeSingle();

    const threshold = (config as { auto_submit_above_confidence?: number | null } | null)
      ?.auto_submit_above_confidence ?? null;
    const confidence = (item as { confidence_score?: number | null }).confidence_score ?? null;
    const opportunityId = (item as { opportunity_id: string }).opportunity_id;

    if (threshold !== null && confidence !== null && confidence >= threshold) {
      // Look up funder_id for AutoApply.
      const { data: opp } = await supabase
        .from("opportunities")
        .select("funder_id")
        .eq("id", opportunityId)
        .eq("organization_id", organizationId)
        .maybeSingle();

      const funderId = (opp as { funder_id?: string | null } | null)?.funder_id ?? null;
      if (funderId) {
        await supabase.from("submission_queue").insert({
          organization_id: organizationId,
          funder_id: funderId,
          priority: 100,
          status: "pending",
          automation_mode: "batch",
        });

        await supabase
          .from("draft_queue")
          .update({ submitted_to_autoapply_at: now, updated_at: now })
          .eq("id", id)
          .eq("organization_id", organizationId);
      }
    }

    const { data: updated } = await supabase
      .from("draft_queue")
      .select("*")
      .eq("id", id)
      .single();

    return NextResponse.json({ item: updated });
  }

  if (action === "reject") {
    const reason = typeof input.reason === "string" && input.reason.trim()
      ? input.reason.trim()
      : "Rejected by reviewer.";

    const update: QueueUpdate = {
      status: "rejected",
      rejected_reason: reason,
      updated_at: now,
    };

    const { error: updateError } = await supabase
      .from("draft_queue")
      .update(update)
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (updateError) {
      return NextResponse.json({ error: "Failed to reject queue item." }, { status: 500 });
    }

    const { data: updated } = await supabase.from("draft_queue").select("*").eq("id", id).single();
    return NextResponse.json({ item: updated });
  }

  if (action === "retry") {
    const currentRetry = (item as { retry_count?: number | null }).retry_count ?? 0;

    const update: QueueUpdate = {
      status: "pending",
      retry_count: currentRetry + 1,
      error_message: null,
      updated_at: now,
    };

    const { error: updateError } = await supabase
      .from("draft_queue")
      .update(update)
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (updateError) {
      return NextResponse.json({ error: "Failed to retry queue item." }, { status: 500 });
    }

    const { data: updated } = await supabase.from("draft_queue").select("*").eq("id", id).single();
    return NextResponse.json({ item: updated });
  }

  if (action === "prioritize") {
    const rawPriority = input.priority;
    if (typeof rawPriority !== "number") {
      return NextResponse.json({ error: "priority must be a number." }, { status: 400 });
    }
    const priority = Math.min(5, Math.max(1, Math.round(rawPriority)));

    const { error: updateError } = await supabase
      .from("draft_queue")
      .update({ priority, updated_at: now })
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (updateError) {
      return NextResponse.json({ error: "Failed to update priority." }, { status: 500 });
    }

    const { data: updated } = await supabase.from("draft_queue").select("*").eq("id", id).single();
    return NextResponse.json({ item: updated });
  }

  if (action === "submit") {
    const opportunityId = (item as { opportunity_id: string }).opportunity_id;

    const { data: opp } = await supabase
      .from("opportunities")
      .select("funder_id")
      .eq("id", opportunityId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    const funderId = (opp as { funder_id?: string | null } | null)?.funder_id ?? null;
    if (!funderId) {
      return NextResponse.json(
        { error: "Cannot submit: opportunity has no linked funder." },
        { status: 422 },
      );
    }

    const { error: queueError } = await supabase.from("submission_queue").insert({
      organization_id: organizationId,
      funder_id: funderId,
      priority: 100,
      status: "pending",
      automation_mode: "batch",
    });

    if (queueError) {
      return NextResponse.json({ error: "Failed to create AutoApply queue entry." }, { status: 500 });
    }

    const { error: updateError } = await supabase
      .from("draft_queue")
      .update({ status: "submitted", submitted_to_autoapply_at: now, updated_at: now })
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (updateError) {
      return NextResponse.json({ error: "Failed to update queue item status." }, { status: 500 });
    }

    const { data: updated } = await supabase.from("draft_queue").select("*").eq("id", id).single();
    return NextResponse.json({ item: updated });
  }

  return NextResponse.json(
    { error: `Unknown action: ${action}`, code: "unknown_action" },
    { status: 400 },
  );
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { id } = params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Queue item not found." }, { status: 404 });
  }

  // Verify ownership before soft-deleting.
  const { data: existing } = await supabase
    .from("draft_queue")
    .select("id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Queue item not found." }, { status: 404 });
  }

  const { error } = await supabase
    .from("draft_queue")
    .update({
      status: "rejected",
      rejected_reason: "removed_from_queue",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", organizationId);

  if (error) {
    return NextResponse.json({ error: "Failed to remove queue item." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
