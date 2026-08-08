// FEATURE_REGISTRY_v2.md row #82 "Path Finder" — shortest/strongest path
// between any two real pig_nodes over the org's real pig_edges graph, the
// same graph src/app/api/intelligence/relationship-graph/route.ts's
// loadRelationshipGraph() already loads and
// src/components/intelligence/RelationshipGraphViz.tsx already renders.
// This is a pure function (no Supabase, no fetch) so it operates on
// whatever node/edge arrays the caller already has org-scoped — there is
// no second data-fetching path here, matching the existing "no synthetic
// nodes/edges" convention documented on that route and component.

export interface PathfinderNode {
  id: string;
}

export interface PathfinderEdge {
  id: string;
  sourceId: string;
  targetId: string;
  weight: number | null;
}

export interface GraphPathResult {
  found: boolean;
  /** Ordered node ids from start to end, inclusive. Empty if not found. */
  nodeIds: string[];
  /** Ordered edge ids traversed between consecutive nodeIds. length === nodeIds.length - 1. */
  edgeIds: string[];
  hops: number;
  totalCost: number;
}

const NOT_FOUND: GraphPathResult = {
  found: false,
  nodeIds: [],
  edgeIds: [],
  hops: 0,
  totalCost: 0,
};

// pig_edges.weight is NOT NULL DEFAULT 1.0 and every real write path in
// relationship-graph-builder-agent.ts passes an explicit positive value
// (0.5/0.6/0.7/0.8/0.95/1.0 depending on which discovery rule produced the
// edge) — but this is a floor against a malformed/zero value reaching here,
// not a value expected to be hit in practice.
const MIN_WEIGHT = 0.01;

/**
 * Finds the lowest-cost path between two pig_nodes, treating the graph as
 * UNDIRECTED. `pig_edges` is stored directed (source_node_id/target_node_id
 * FKs), but the relationship_type vocabulary this agent produces
 * (board_overlap, shared_executive, alumni_network, family_foundation_tie,
 * giving_cycle_aligned, asset_compatible, geographic_giving_history,
 * board_network_overlap) describes mutual associations between two
 * entities, not a one-way flow — and the existing force-directed viz
 * (RelationshipGraphViz.tsx) already renders every edge as a plain
 * undirected line with no arrowhead. A warm-introduction path should be
 * able to traverse either direction of a real edge.
 *
 * Weight interpretation, stated explicitly since "weight" is ambiguous
 * here (checked live before choosing): pig_edges.weight is a
 * relationship-STRENGTH score, not a graph-theoretic edge cost — higher is
 * better (see relationship-graph-builder-agent.ts's own weight assignments,
 * and the existing UI's STRENGTH_COLOR/introduction_strength convention,
 * which already frames a stronger connection as more desirable, e.g.
 * thicker edge lines for higher weight in RelationshipGraphViz). Dijkstra
 * needs a cost to MINIMIZE, the opposite framing, so
 * cost(edge) = 1 / clamp(weight, MIN_WEIGHT) — the algorithm favors
 * traversing strong relationships over weak ones, matching "the best real
 * warm-introduction path," not a literal shortest-hop-count path that
 * could route through a single weak/thin connection in preference to two
 * strong ones.
 *
 * Confirmed live (2026-08-07) before writing this: every one of this
 * project's 20 real pig_edges rows currently has an identical weight (0.6,
 * all `asset_compatible`) — with a uniform per-edge cost, this is
 * mathematically identical to plain unweighted BFS shortest-hop-count
 * today. That is the correct, honest behavior for today's data (a weighted
 * algorithm dressed up as meaningful when the input doesn't vary yet would
 * be misleading) — but unlike a hardcoded BFS, this will start genuinely
 * favoring stronger relationships the moment real, varying weights land,
 * which is expected soon: the agent's own discovery rules already write
 * six distinct weight values (0.5/0.6/0.7/0.8/0.95/1.0) when more than one
 * rule fires for an org.
 */
export function findShortestPath(
  nodes: PathfinderNode[],
  edges: PathfinderEdge[],
  startNodeId: string,
  endNodeId: string,
): GraphPathResult {
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(startNodeId) || !nodeIds.has(endNodeId)) return NOT_FOUND;

  if (startNodeId === endNodeId) {
    return { found: true, nodeIds: [startNodeId], edgeIds: [], hops: 0, totalCost: 0 };
  }

  const adjacency = new Map<
    string,
    { neighborId: string; edgeId: string; cost: number }[]
  >();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const e of edges) {
    if (!nodeIds.has(e.sourceId) || !nodeIds.has(e.targetId)) continue;
    if (e.sourceId === e.targetId) continue; // defensive: no self-loops expected
    const weight =
      typeof e.weight === "number" && e.weight > 0 ? e.weight : MIN_WEIGHT;
    const cost = 1 / Math.max(weight, MIN_WEIGHT);
    adjacency.get(e.sourceId)!.push({ neighborId: e.targetId, edgeId: e.id, cost });
    adjacency.get(e.targetId)!.push({ neighborId: e.sourceId, edgeId: e.id, cost });
  }

  // Plain selection-based Dijkstra — this feature's real graph is tens of
  // nodes (~20-25 edges confirmed live), so an O(V^2) scan per iteration is
  // trivial; no priority-queue dependency needed, matching
  // RelationshipGraphViz.tsx's own "small graph, don't over-engineer" call
  // on its Fruchterman-Reingold layout.
  const dist = new Map<string, number>();
  const prevNode = new Map<string, string>();
  const prevEdge = new Map<string, string>();
  const visited = new Set<string>();
  for (const id of nodeIds) dist.set(id, Infinity);
  dist.set(startNodeId, 0);

  while (visited.size < nodeIds.size) {
    let currentId: string | null = null;
    let currentDist = Infinity;
    for (const id of nodeIds) {
      if (visited.has(id)) continue;
      const d = dist.get(id)!;
      if (d < currentDist) {
        currentDist = d;
        currentId = id;
      }
    }
    if (currentId === null || currentDist === Infinity) break; // remaining nodes unreachable
    visited.add(currentId);
    if (currentId === endNodeId) break;

    for (const { neighborId, edgeId, cost } of adjacency.get(currentId) ?? []) {
      if (visited.has(neighborId)) continue;
      const alt = currentDist + cost;
      if (alt < (dist.get(neighborId) ?? Infinity)) {
        dist.set(neighborId, alt);
        prevNode.set(neighborId, currentId);
        prevEdge.set(neighborId, edgeId);
      }
    }
  }

  const finalDist = dist.get(endNodeId);
  if (finalDist === undefined || finalDist === Infinity) return NOT_FOUND;

  const pathNodeIds: string[] = [endNodeId];
  const pathEdgeIds: string[] = [];
  let cursor = endNodeId;
  while (cursor !== startNodeId) {
    const pe = prevEdge.get(cursor);
    const pn = prevNode.get(cursor);
    if (!pe || !pn) return NOT_FOUND; // defensive — should be unreachable given the finalDist check above
    pathEdgeIds.push(pe);
    pathNodeIds.push(pn);
    cursor = pn;
  }
  pathNodeIds.reverse();
  pathEdgeIds.reverse();

  return {
    found: true,
    nodeIds: pathNodeIds,
    edgeIds: pathEdgeIds,
    hops: pathEdgeIds.length,
    totalCost: finalDist,
  };
}
