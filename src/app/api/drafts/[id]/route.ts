// GET   /api/drafts/[id] — application draft detail: content + humanization
// metadata (applications.metadata.humanization_score /
// .humanization_breakdown, written by draft-generation-agent.ts and by
// POST /api/drafts/[id]/humanize). Backs the autonomous draft review page's
// quality panel (/draft-generator/autonomous).
// PATCH /api/drafts/[id] — updates draft_content. Only while
// pending_review=true — autonomous drafts are editable during human review;
// once a draft is dismissed/approved out of the review queue this route
// stops accepting edits.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

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
    return jsonError("Draft not found.", "not_found", 404);
  }

  const { data: application, error } = await supabase
    .from("applications")
    .select(
      "id, draft_content, draft_confidence_score, opportunity_id, pending_review, auto_generated, metadata, created_at, updated_at",
    )
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !application) {
    return jsonError("Draft not found.", "not_found", 404);
  }

  return NextResponse.json({ application });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { id } = params;
  if (!isUuid(id)) {
    return jsonError("Draft not found.", "not_found", 404);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { draft_content: draftContent } = (body ?? {}) as {
    draft_content?: unknown;
  };
  if (typeof draftContent !== "string" || draftContent.trim() === "") {
    return jsonError(
      "draft_content (non-empty string) is required.",
      "invalid_input",
      400,
    );
  }

  const { data: existing, error: fetchError } = await supabase
    .from("applications")
    .select("id, pending_review")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchError || !existing) {
    return jsonError("Draft not found.", "not_found", 404);
  }

  const row = existing as { id: string; pending_review: boolean | null };
  if (row.pending_review !== true) {
    return jsonError(
      "This draft is no longer pending review and can't be edited here.",
      "not_pending_review",
      409,
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("applications")
    .update({
      draft_content: draftContent,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select("id, draft_content, updated_at")
    .maybeSingle();

  if (updateError || !updated) {
    return jsonError("Could not update the draft.", "update_failed", 500);
  }

  return NextResponse.json({ application: updated });
}
