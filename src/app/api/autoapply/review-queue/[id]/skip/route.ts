import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// PATCH /api/autoapply/review-queue/[id]/skip — AUTOAPPLY_ARCHITECTURE_V2.md
// §10C. Body: { reason: "not_worth_it" | "portal_broken" | "duplicate" | "other" }
// — mirrors §8B's Skip reason set exactly (ManualQueue.tsx's SKIP_REASONS).
//
// Same conditional UPDATE ... WHERE ... RETURNING guard as /resume, via
// skip_paused_submission_queue_item() (116_review_queue_rpc_functions.sql).

export const runtime = "nodejs";

const SKIP_REASONS = ["not_worth_it", "portal_broken", "duplicate", "other"] as const;

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

  const { reason } = (body ?? {}) as { reason?: unknown };
  if (typeof reason !== "string" || !SKIP_REASONS.includes(reason as (typeof SKIP_REASONS)[number])) {
    return NextResponse.json(
      { error: `reason must be one of: ${SKIP_REASONS.join(", ")}.` },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc(
    "skip_paused_submission_queue_item",
    {
      p_id: params.id,
      p_org_id: organizationId,
      p_reason: reason,
      p_reviewer_id: userId,
    },
  );

  if (error) {
    return NextResponse.json(
      { error: "Could not skip this submission." },
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

  return NextResponse.json({ success: true, id: data });
}
