import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// State Portal Research Agent trigger (AGENTS.md Agent 18).
// POST — queues a state portal scraping cycle for the caller's org.
// Full implementation lands in Tier 6 Phase A.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  // Verify at least one state portal is active before queuing.
  const { count } = await supabase
    .from("state_portals")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  if (!count || count === 0) {
    return jsonError(
      "No active state portals configured. An admin must enable portals in state_portals.",
      "no_portals",
      400,
    );
  }

  const { data: run, error } = await supabase
    .from("agent_runs")
    .insert({
      organization_id: organizationId,
      agent_type: "state_portal",
      status: "pending",
      triggered_by: userId,
      input_params: { source: "manual_trigger", integration: "state_portals" },
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return jsonError(error.message, "db_error", 500);
  }

  return NextResponse.json({ status: "queued", runId: run.id });
}
