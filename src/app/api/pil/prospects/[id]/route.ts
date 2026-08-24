import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { getPilClient } from "@/lib/pil/db";
import { getEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect } from "@/lib/pil/graph";
import type { GraphEdge } from "@/lib/pil/types";

// GET /api/pil/prospects/[id] — full dossier: prospect, evidence, graph
// nodes, graph edges between those nodes, and research runs.

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

  // getNodesByProspect only returns nodes anchored directly to this prospect
  // -- fetch the edges between them separately (pil_graph_edges is a distinct
  // table with no prospect_id of its own) so the Graph tab has something to
  // draw.
  let graphEdges: GraphEdge[] = [];
  if (graphNodes.length > 0) {
    const nodeIds = graphNodes.map((n) => n.id);
    const { data: edgeRows, error: edgeError } = await getPilClient()
      .from("pil_graph_edges")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("is_current", true)
      .in("source_node_id", nodeIds)
      .in("target_node_id", nodeIds);
    if (!edgeError) graphEdges = (edgeRows ?? []) as GraphEdge[];
  }

  return NextResponse.json({
    prospect,
    evidence,
    graphNodes,
    graphEdges,
    researchRuns: researchRunsResult.data ?? [],
  });
}
