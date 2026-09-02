import { getPilClient } from "@/lib/pil/db";
import { getNodesByProspect } from "@/lib/pil/graph";
import type { GraphEdge } from "@/lib/pil/types";

// Shared plumbing for the Strategy & Next-Best-Action family
// (BEN-STR-01..04). BEN-STR-02's own header flagged that a third call site
// needing this exact pil_graph_edges relationship-strength read would be the
// signal to extract a shared module (mirroring src/lib/pil/agents/rel/
// shared.ts's real precedent) instead of leaving a second inline copy of the
// query sitting in BEN-STR-01/BEN-STR-02 -- BEN-STR-03 is that third call
// site. BEN-STR-01/02 already call BEN-QLF-04's own exported
// scoreRelationshipStrength() for a bare numeric score; BEN-STR-03 needs the
// actual edge (not just its score) to describe *how* a warm introduction
// would happen, so this module wraps the identical source/target
// pil_graph_edges query and returns the strongest current warm edge itself.

const WARM_RELATIONSHIP_STRENGTHS = new Set(["strong", "very_strong"]);
const STRENGTH_RANK: Record<string, number> = { very_strong: 2, strong: 1 };

/** The strongest current warm (strong/very_strong) edge touching any of the prospect's graph nodes, or null if none exists. Same source+target pil_graph_edges query as BEN-QLF-04's scoreRelationshipStrength(), returning the edge itself instead of a score. */
export async function findWarmEdge(orgId: string, prospectId: string): Promise<GraphEdge | null> {
  const nodes = await getNodesByProspect(prospectId, orgId);
  if (nodes.length === 0) return null;
  const nodeIds = nodes.map((n) => n.id);
  const client = getPilClient();
  const [{ data: asSource, error: sourceError }, { data: asTarget, error: targetError }] = await Promise.all([
    client.from("pil_graph_edges").select("*").eq("organization_id", orgId).eq("is_current", true).in("source_node_id", nodeIds),
    client.from("pil_graph_edges").select("*").eq("organization_id", orgId).eq("is_current", true).in("target_node_id", nodeIds),
  ]);
  if (sourceError) throw sourceError;
  if (targetError) throw targetError;
  const edges = [...((asSource ?? []) as GraphEdge[]), ...((asTarget ?? []) as GraphEdge[])];
  const warmEdges = edges.filter((e) => e.relationship_strength && WARM_RELATIONSHIP_STRENGTHS.has(e.relationship_strength));
  if (warmEdges.length === 0) return null;
  return warmEdges.slice().sort((a, b) => (STRENGTH_RANK[b.relationship_strength ?? ""] ?? 0) - (STRENGTH_RANK[a.relationship_strength ?? ""] ?? 0))[0]!;
}

/** "warm_introduction_via_[edge properties]" per the roster's Relationship-Building Actions dimension -- edge.properties is freeform JSONB (see rel/*.ts's own varied property shapes per edge_type), so this reads whichever descriptive key a REL-family writer actually populated, falling back to the edge_type itself. */
export function describeWarmIntroduction(edge: GraphEdge): string {
  const props = edge.properties ?? {};
  const descriptor =
    (typeof props.relationshipType === "string" && props.relationshipType) ||
    (typeof props.viaOrganization === "string" && props.viaOrganization) ||
    (typeof props.discoveredVia === "string" && props.discoveredVia) ||
    edge.edge_type;
  return `warm_introduction_via_${descriptor}`;
}
