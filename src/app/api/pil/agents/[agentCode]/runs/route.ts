import { NextResponse } from "next/server";

import { requirePilRole } from "@/lib/feature-flags/pil";
import { getPilClient } from "@/lib/pil/db";

// GET /api/pil/agents/[agentCode]/runs — run history for one agent.

export const runtime = "nodejs";

type RouteContext = { params: { agentCode: string } };

export async function GET(_req: Request, { params }: RouteContext) {
  const gate = await requirePilRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const { data, error } = await getPilClient()
    .from("pil_agent_runs")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("agent_id", params.agentCode)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to load agent runs." }, { status: 500 });
  }

  return NextResponse.json({ runs: data ?? [] });
}
