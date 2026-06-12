import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { AgentError } from "@/lib/agents/base-agent";
import { approveAndSubmit } from "@/lib/agents/browser-automation";
import { AutomationSessionError } from "@/lib/automation/session-manager";

// Human approval + submission endpoint (AGENTS.md Agent 16,
// BEHAVIORAL_CONTRACTS §18). POST records the approval and runs the submission:
// resume the browser, replay the filled fields, click submit, capture the
// confirmation screenshot + number, advance the application to `submitted`, and
// store the confirmation in the application's notes.
//
// This is the ONLY automated path to a submission, and it requires an explicit
// owner/admin caller — applications may move to `submitted` only by owner/admin
// (BEHAVIORAL_CONTRACTS §6), and submission is never anonymous or automated
// (§18). organization_id is derived from the caller's profile, never the body.

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(
  _request: Request,
  { params }: { params: { sessionId: string } },
) {
  // Submitting requires an explicit owner/admin caller (Contracts §6, §18).
  const gate = await requireRole("admin");
  if ("error" in gate) {
    // Preserve the submission-specific message on the role denial.
    return gate.error;
  }
  const { supabase, userId, organizationId } = gate;

  try {
    const result = await approveAndSubmit({
      client: supabase,
      organizationId,
      sessionId: params.sessionId,
      approvedBy: userId,
    });
    return NextResponse.json({
      sessionId: result.sessionId,
      status: result.status,
      confirmationNumber: result.confirmationNumber,
      confirmationScreenshot: result.confirmationScreenshot,
      applicationStageUpdated: result.applicationStageUpdated,
    });
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    if (err instanceof AutomationSessionError) {
      // Illegal transition (e.g. not awaiting_approval) → 409 Conflict.
      return jsonError(err.message, err.code, 409);
    }
    return jsonError(
      "Submission failed. Please try again.",
      "submit_failed",
      500,
    );
  }
}
