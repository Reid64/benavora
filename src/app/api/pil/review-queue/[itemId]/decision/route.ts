import { NextResponse } from "next/server";

import { requirePilRole } from "@/lib/feature-flags/pil";
import { HumanReviewError, submitReviewDecision } from "@/lib/pil/human-review";

// POST /api/pil/review-queue/[itemId]/decision — submit a human review
// decision. requireRole("admin") — the architecture doc's Human Review
// Lifecycle is "the one lifecycle where a human, not an agent, drives every
// transition" (Section 1.5); admin matches the review/approval bar used
// elsewhere in this codebase for consequential decisions.

export const runtime = "nodejs";

type RouteContext = { params: { itemId: string } };

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request, { params }: RouteContext) {
  const gate = await requirePilRole("admin");
  if ("error" in gate) return gate.error;
  const { userId } = gate;

  let body: { approved?: boolean; notes?: string; outcome?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  if (typeof body.approved !== "boolean") {
    return jsonError("approved (boolean) is required.", "missing_approved", 400);
  }

  try {
    await submitReviewDecision(
      params.itemId,
      { approved: body.approved, notes: body.notes ?? "", outcome: body.outcome ?? null },
      userId,
    );
  } catch (err) {
    if (err instanceof HumanReviewError) {
      return jsonError(err.message, "invalid_transition", 409);
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
