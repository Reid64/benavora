import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { checkRateLimit } from "@/lib/utils/rate-limit";

// POST /api/autonomous/grant-dna-trigger - enqueues AG-10 (Grant DNA
// Analysis Agent, src/lib/agents/grant-dna-agent.ts) off a new `outcomes`
// insert, per AGENTS_v2.md's AG-10 spec ("Event-chained (primary) - fired
// via agent_queue whenever a new outcomes row is inserted for an
// application whose opportunity has a non-null funder_id"). Called
// best-effort from src/components/outcomes/OutcomeForm.tsx, the same call
// site that already fires the AG-07 (learning) and AG-23
// (funder-relationship) triggers after an outcome is recorded.
//
// organization_id is always derived server-side via requireRole, never from
// the request body (Contracts §2). trigger_source='event' - migration 081
// widened agent_queue's trigger_source CHECK constraint (previously
// autonomous/manual/chain/schedule only) to add this value for genuinely
// event-driven agents; the same value FollowupGeneratorAgent (AG-28) uses.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  if (!checkRateLimit(`grant-dna-trigger:${userId}`)) {
    return jsonError(
      "Too many grant DNA triggers. Try again in a bit.",
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

  const { funderId } = (body ?? {}) as { funderId?: unknown };

  if (typeof funderId !== "string" || funderId.trim() === "") {
    return jsonError("funderId is required.", "invalid_input", 400);
  }

  const { data, error } = await supabase
    .from("agent_queue")
    .insert({
      org_id: organizationId,
      agent_id: "ag-10-grant-dna",
      priority: 6,
      status: "queued",
      trigger_source: "event",
      input_payload: { funderId },
    })
    .select("id")
    .single();

  if (error || !data) {
    return jsonError(
      "Could not queue the grant DNA analysis run.",
      "queue_failed",
      500,
    );
  }

  return NextResponse.json({ queueItemId: (data as { id: string }).id });
}
