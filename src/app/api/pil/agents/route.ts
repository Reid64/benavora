import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { listAgents } from "@/lib/pil/agent-registry-service";
import { getPilClient } from "@/lib/pil/db";
import type { AgentRunStatus } from "@/lib/pil/types";

// GET /api/pil/agents — all agent definitions with status.
// pil_agent_registry has no per-agent "currently running" flag (it is the
// platform-level definition table, migration 155) — that state only exists
// on pil_agent_runs rows. Also returns runningAgentIds: the org's distinct
// agent_ids with an in-flight run right now, for the PIL hub's "agents
// currently running" stat and the Agent activity monitor's status column.

export const runtime = "nodejs";

const IN_FLIGHT_STATUSES: AgentRunStatus[] = ["planning", "running", "observing", "replanning"];

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const [agents, runningResult] = await Promise.all([
    listAgents(),
    getPilClient()
      .from("pil_agent_runs")
      .select("agent_id")
      .eq("organization_id", organizationId)
      .in("status", IN_FLIGHT_STATUSES),
  ]);

  const runningAgentIds = Array.from(
    new Set(((runningResult.data ?? []) as Array<{ agent_id: string }>).map((r) => r.agent_id)),
  );

  return NextResponse.json({ agents, runningAgentIds });
}
