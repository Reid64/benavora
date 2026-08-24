import { getPilClient } from "@/lib/pil/db";
import type { GraphEdge, GraphNode } from "@/lib/pil/types";

// Knowledge graph service. pil_graph_nodes/pil_graph_edges have no unique
// constraint documented for upsertNode/upsertEdge to target with a DB-level
// ON CONFLICT, so both upserts here do an explicit find-then-write instead of
// guessing a conflict target that may not match the applied schema.

function nodeIdentityMatch(a: Pick<GraphNode, "node_type" | "label" | "prospect_id">, b: GraphNode): boolean {
  return a.node_type === b.node_type && a.label === b.label && a.prospect_id === b.prospect_id;
}

export async function upsertNode(node: Omit<GraphNode, "id" | "created_at" | "updated_at">): Promise<GraphNode> {
  const client = getPilClient();
  const { data: existingRows, error: findError } = await client
    .from("pil_graph_nodes")
    .select("*")
    .eq("organization_id", node.organization_id)
    .eq("node_type", node.node_type)
    .eq("label", node.label);
  if (findError) throw findError;

  const existing = ((existingRows ?? []) as GraphNode[]).find((row) => nodeIdentityMatch(node, row));

  if (existing) {
    const { data, error } = await client
      .from("pil_graph_nodes")
      .update({ properties: node.properties, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as GraphNode;
  }

  const { data, error } = await client.from("pil_graph_nodes").insert(node).select("*").single();
  if (error) throw error;
  return data as GraphNode;
}

export async function upsertEdge(edge: Omit<GraphEdge, "id" | "created_at" | "updated_at">): Promise<GraphEdge> {
  const client = getPilClient();
  const { data: existing, error: findError } = await client
    .from("pil_graph_edges")
    .select("*")
    .eq("organization_id", edge.organization_id)
    .eq("source_node_id", edge.source_node_id)
    .eq("target_node_id", edge.target_node_id)
    .eq("edge_type", edge.edge_type)
    .eq("is_current", true)
    .maybeSingle();
  if (findError) throw findError;

  if (existing) {
    const { data, error } = await client
      .from("pil_graph_edges")
      .update({
        relationship_strength: edge.relationship_strength,
        confidence: edge.confidence,
        temporal_validity_start: edge.temporal_validity_start,
        temporal_validity_end: edge.temporal_validity_end,
        properties: edge.properties,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (existing as GraphEdge).id)
      .select("*")
      .single();
    if (error) throw error;
    return data as GraphEdge;
  }

  const { data, error } = await client.from("pil_graph_edges").insert(edge).select("*").single();
  if (error) throw error;
  return data as GraphEdge;
}

export async function getNodesByProspect(prospectId: string, orgId: string): Promise<GraphNode[]> {
  const { data, error } = await getPilClient()
    .from("pil_graph_nodes")
    .select("*")
    .eq("organization_id", orgId)
    .eq("prospect_id", prospectId);
  if (error) throw error;
  return (data ?? []) as GraphNode[];
}

// Edges are org-scoped internally (derived from the source node's own
// organization_id) even though the public signature only takes fromNodeId --
// pil_graph_edges is service-role-only (db.ts), so this prevents a caller
// from reading another org's edges just by guessing a UUID.
export async function getEdges(fromNodeId: string): Promise<GraphEdge[]> {
  const client = getPilClient();
  const { data: nodeRow, error: nodeError } = await client
    .from("pil_graph_nodes")
    .select("organization_id")
    .eq("id", fromNodeId)
    .maybeSingle();
  if (nodeError) throw nodeError;
  if (!nodeRow) return [];

  const { data, error } = await client
    .from("pil_graph_edges")
    .select("*")
    .eq("organization_id", (nodeRow as { organization_id: string }).organization_id)
    .eq("source_node_id", fromNodeId)
    .eq("is_current", true);
  if (error) throw error;
  return (data ?? []) as GraphEdge[];
}

export async function traverseGraph(
  startNodeId: string,
  maxHops: number,
  orgId: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const client = getPilClient();
  const visitedNodeIds = new Set<string>([startNodeId]);
  const visitedEdgeIds = new Set<string>();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const { data: startNode, error: startError } = await client
    .from("pil_graph_nodes")
    .select("*")
    .eq("id", startNodeId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (startError) throw startError;
  if (!startNode) return { nodes: [], edges: [] };
  nodes.push(startNode as GraphNode);

  let frontier = [startNodeId];
  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const { data: hopEdges, error: edgeError } = await client
      .from("pil_graph_edges")
      .select("*")
      .eq("organization_id", orgId)
      .eq("is_current", true)
      .in("source_node_id", frontier);
    if (edgeError) throw edgeError;

    const newEdges = ((hopEdges ?? []) as GraphEdge[]).filter((e) => !visitedEdgeIds.has(e.id));
    if (newEdges.length === 0) break;

    const nextFrontier: string[] = [];
    for (const e of newEdges) {
      visitedEdgeIds.add(e.id);
      edges.push(e);
      if (!visitedNodeIds.has(e.target_node_id)) {
        visitedNodeIds.add(e.target_node_id);
        nextFrontier.push(e.target_node_id);
      }
    }

    if (nextFrontier.length > 0) {
      const { data: nextNodes, error: nodeError } = await client
        .from("pil_graph_nodes")
        .select("*")
        .eq("organization_id", orgId)
        .in("id", nextFrontier);
      if (nodeError) throw nodeError;
      nodes.push(...((nextNodes ?? []) as GraphNode[]));
    }

    frontier = nextFrontier;
  }

  return { nodes, edges };
}
