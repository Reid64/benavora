import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { checkRateLimit } from "@/lib/utils/rate-limit";

// POST /api/autonomous/trigger - manually enqueue an agent run
// (agent_queue, migration 080). organization_id is always derived
// server-side via requireRole, never from the request body (Contracts §2).
//
// Manual triggers get priority=9 (near-highest of the 1-10 range) so they
// jump ahead of autonomous/scheduled queue items without starving anything
// mid-run (BEHAVIORAL_CONTRACTS §23).

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  if (!checkRateLimit(`autonomous-trigger:${userId}`)) {
    return jsonError(
      "Too many manual agent triggers. Try again in a bit.",
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

  const { agentId } = (body ?? {}) as { agentId?: unknown };
  if (typeof agentId !== "string" || agentId.trim() === "") {
    return jsonError("agentId is required.", "invalid_input", 400);
  }

  const { data, error } = await supabase
    .from("agent_queue")
    .insert({
      org_id: organizationId,
      agent_id: agentId.trim(),
      priority: 9,
      status: "queued",
      trigger_source: "manual",
    })
    .select("id")
    .single();

  if (error || !data) {
    return jsonError("Could not queue the agent run.", "queue_failed", 500);
  }

  return NextResponse.json({ queueItemId: (data as { id: string }).id });
}
