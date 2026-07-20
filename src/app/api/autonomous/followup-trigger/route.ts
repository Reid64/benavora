import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { checkRateLimit } from "@/lib/utils/rate-limit";

// POST /api/autonomous/followup-trigger - enqueues AG-28 (Followup Generator
// Agent, src/lib/agents/followup-generator-agent.ts) off a pipeline stage
// transition. organization_id is always derived server-side via requireRole,
// never from the request body (Contracts §2).
//
// Only submitted/awarded/denied carry a follow-up action; every other stage
// transition is a no-op (400) rather than silently queueing dead work.
//
// trigger_source='event' - migration 081 widened agent_queue's trigger_source
// CHECK constraint (previously autonomous/manual/chain/schedule only) to add
// this value for genuinely event-driven agents.

export const runtime = "nodejs";

const FOLLOWUP_STAGES = new Set(["submitted", "awarded", "denied"]);

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  if (!checkRateLimit(`followup-trigger:${userId}`)) {
    return jsonError(
      "Too many follow-up triggers. Try again in a bit.",
      "rate_limited",
      429,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { applicationId, newStage, previousStage } = (body ?? {}) as {
    applicationId?: unknown;
    newStage?: unknown;
    previousStage?: unknown;
  };

  if (typeof applicationId !== "string" || applicationId.trim() === "") {
    return jsonError("applicationId is required.", "invalid_input", 400);
  }
  if (typeof newStage !== "string" || !FOLLOWUP_STAGES.has(newStage)) {
    return jsonError(
      "newStage must be one of: submitted, awarded, denied.",
      "invalid_input",
      400,
    );
  }
  if (typeof previousStage !== "string" || previousStage.trim() === "") {
    return jsonError("previousStage is required.", "invalid_input", 400);
  }

  const { data, error } = await supabase
    .from("agent_queue")
    .insert({
      org_id: organizationId,
      agent_id: "ag-28-followup",
      priority: 8,
      status: "queued",
      trigger_source: "event",
      input_payload: { applicationId, newStage, previousStage },
    })
    .select("id")
    .single();

  if (error || !data) {
    return jsonError("Could not queue the follow-up agent run.", "queue_failed", 500);
  }

  return NextResponse.json({ queueItemId: (data as { id: string }).id });
}
