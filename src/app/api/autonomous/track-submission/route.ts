import { NextResponse } from "next/server";

import { RoiOptimizerAgent } from "@/lib/agents/roi-optimizer-agent";
import { requireRole } from "@/lib/auth/role-gate";

// POST /api/autonomous/track-submission - records AG-39 (ROI Optimizer)
// submission_variables for one application. organization_id is always
// derived server-side via requireRole, never from the request body
// (Contracts §2). Called best-effort off the "submitted" stage transition
// (see src/components/applications/pipeline.ts's executeTransition) - a
// failure here must never block the transition itself.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { applicationId } = (body ?? {}) as { applicationId?: unknown };
  if (typeof applicationId !== "string" || applicationId.trim() === "") {
    return jsonError("applicationId is required.", "invalid_input", 400);
  }

  const agent = new RoiOptimizerAgent(organizationId, supabase);

  try {
    await agent.trackSubmissionVariables(applicationId.trim());
  } catch {
    return jsonError("Could not track submission variables.", "tracking_failed", 500);
  }

  return NextResponse.json({ applicationId: applicationId.trim(), tracked: true });
}
