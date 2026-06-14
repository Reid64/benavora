import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// Custom API Research Agent trigger endpoint (AGENTS.md Agent 19).
// POST { connectionId? } — queues a polling cycle for the caller's org.
// connectionId is optional: omit to poll all active connections, or pass a
// specific id to target one connection (e.g. "Run Now" in the settings UI).

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let connectionId: string | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      connectionId?: string;
    };
    if (typeof body.connectionId === "string") {
      connectionId = body.connectionId;
    }
  } catch {
    // Body is optional; run all active connections if omitted.
  }

  const { data: run, error } = await supabase
    .from("agent_runs")
    .insert({
      organization_id: organizationId,
      agent_type: "custom_api_research",
      status: "pending",
      triggered_by: userId,
      input_params: { connectionId: connectionId ?? null },
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return jsonError(error.message, "db_error", 500);
  }

  return NextResponse.json({ status: "queued", runId: run.id });
}
