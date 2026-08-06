import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// PATCH /api/autoapply/review-queue/[id]/resume — AUTOAPPLY_ARCHITECTURE_V2.md
// §10C. Resuming means retry from the top on the next queue pass (a fresh
// page navigation), not continuing inside the paused browser session — the
// original Playwright page/context is never kept alive across the pause
// (§10B). This route only flips submission_queue.status back to 'queued';
// worker/queue-processor.ts's normal poll picks it up from there.
//
// Implemented as a single conditional UPDATE ... WHERE ... RETURNING via the
// resume_paused_submission_queue_item() Postgres function
// (116_review_queue_rpc_functions.sql) — never a read-then-write — so two
// reviewers acting on the same row concurrently resolve to exactly one
// winner. A NULL return means the WHERE guard (id + org + status =
// 'paused_verification') matched zero rows: another reviewer already
// resumed/skipped/reassigned it, or it belongs to a different org.

export const runtime = "nodejs";

export async function PATCH(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  const { data, error } = await supabase.rpc(
    "resume_paused_submission_queue_item",
    {
      p_id: params.id,
      p_org_id: organizationId,
      p_reviewer_id: userId,
    },
  );

  if (error) {
    return NextResponse.json(
      { error: "Could not resume this submission." },
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
