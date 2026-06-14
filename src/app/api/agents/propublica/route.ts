import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// ProPublica 990 Mining Agent trigger (AGENTS.md Agent 17).
// POST — queues a ProPublica mining cycle for the caller's org.
// No API key required; ProPublica Nonprofit Explorer is public.
// Full implementation lands in Tier 6 Phase A.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  const { data: run, error } = await supabase
    .from("agent_runs")
    .insert({
      organization_id: organizationId,
      agent_type: "propublica_mining",
      status: "pending",
      triggered_by: userId,
      input_params: { source: "manual_trigger", integration: "propublica" },
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return jsonError(error.message, "db_error", 500);
  }

  return NextResponse.json({ status: "queued", runId: run.id });
}
