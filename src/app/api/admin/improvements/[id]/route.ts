// PATCH /api/admin/improvements/[id] — approve or reject one AG-38
// improvement proposal. improvement_proposals is platform-wide with no RLS
// (migration 087_continuous_improvement.sql); gated at the app layer via
// requireRole, same precedent as /api/admin/orgs/[id]/suspend.
//
// This only ever sets status to "approved" or "rejected" — "implemented" is
// deliberately not reachable from this route. Per AUTONOMOUS_HARD_LIMITS and
// AG-38's own file header, this agent (and this review UI) never applies a
// change to production code/prompts itself; "implemented" reflects a human
// having actually made the change out-of-band, not a click here.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

const ALLOWED_STATUSES = ["approved", "rejected"];

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON.", code: "invalid_body" },
      { status: 400 },
    );
  }

  const { status } = (body ?? {}) as { status?: unknown };
  if (typeof status !== "string" || !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}.`, code: "invalid_input" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("improvement_proposals")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: gate.userId,
    })
    .eq("id", params.id)
    .select("id, status, reviewed_at, reviewed_by")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Proposal not found or update failed.", code: "update_failed" },
      { status: error ? 500 : 404 },
    );
  }

  return NextResponse.json({ proposal: data });
}
