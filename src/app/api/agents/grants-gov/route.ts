import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// Grants.gov Research Agent trigger (AGENTS.md Agent 15).
// POST — queues a Grants.gov polling cycle for the caller's org.
// No API key required; Grants.gov search endpoint is public.
// Full implementation lands in Tier 6 Phase A. This endpoint records
// the run request and returns the run ID for polling.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  // Create a pending agent_run record so the worker can pick it up and the
  // caller gets a run ID to poll. Status stays 'pending' until the worker
  // processes it; completed_at will be set on finish.
  const { data: run, error } = await supabase
    .from("agent_runs")
    .insert({
      organization_id: organizationId,
      agent_type: "grants_gov_research",
      status: "pending",
      triggered_by: userId,
      input_params: { source: "manual_trigger", integration: "grants_gov" },
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return jsonError(error.message, "db_error", 500);
  }

  return NextResponse.json({ status: "queued", runId: run.id });
}
