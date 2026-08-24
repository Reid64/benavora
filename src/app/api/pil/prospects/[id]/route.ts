import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect } from "@/lib/pil/graph";

// GET /api/pil/prospects/[id] — full dossier: prospect, evidence, graph
// nodes, and research runs.

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, { params }: RouteContext) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const { data: prospect, error } = await getPilClient()
    .from("pil_prospects")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  }

  const [evidence, graphNodes, researchRunsResult] = await Promise.all([
    getEvidence(params.id, organizationId),
    getNodesByProspect(params.id, organizationId),
    getPilClient()
      .from("pil_research_runs")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("prospect_id", params.id),
  ]);

  return NextResponse.json({
    prospect,
    evidence,
    graphNodes,
    researchRuns: researchRunsResult.data ?? [],
  });
}
