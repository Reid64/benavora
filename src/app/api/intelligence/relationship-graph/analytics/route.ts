import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireRole } from "@/lib/auth/role-gate";

// GET /api/intelligence/relationship-graph/analytics — PIG Phase 2 graph
// analytics for AG-32 (src/lib/agents/relationship-graph-builder-agent.ts).
//
// Path deviation from the task spec, per established convention in this
// codebase (see relationship-graph/route.ts's own header): the task asked
// for /api/intelligence/graph/analytics, but there is no
// src/app/(dashboard)/intelligence/graph page or /api/intelligence/graph
// route anywhere in the repo — the real PIG feature lives at
// intelligence/relationship-graph and /api/intelligence/relationship-graph.
// This route is nested under that real path instead of inventing a
// sibling "graph" namespace.
//
// "The org's graph" is proven the same way relationship-graph/route.ts's
// loadConnections() proves edge ownership (pig_edges carries no
// organization_id) — by walking pig_edges -> pig_nodes(source) ->
// board_members.org_id — plus one addition: the org's own self-node
// (entity_table='organizations', entity_id=organizationId), which
// RelationshipGraphBuilderAgent's Phase 2 rules (giving-cycle/asset/
// geographic/board-network) attach edges to directly rather than through a
// board member. The existing GET route only reads board-member-sourced
// edges; this route also counts those Phase 2 edges so the analytics panel
// reflects the full graph the agent actually writes.

export const runtime = "nodejs";
export const maxDuration = 300;

interface PigEdgeRow {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: string;
  weight: number | null;
}

interface PigNodeRow {
  id: string;
  label: string;
  node_type: string;
}

interface TopConnectedNode {
  id: string;
  label: string;
  nodeType: string;
  edgeCount: number;
}

interface TopFoundation {
  id: string;
  label: string;
  edgeCount: number;
  avgWeight: number;
  topRelationshipType: string;
}

interface Cluster {
  relationshipTypes: string[];
  foundationCount: number;
  foundationNames: string[];
  description: string;
  strength: number;
}

const RELATIONSHIP_TYPE_LABELS: Record<string, string> = {
  board_overlap: "board overlap",
  shared_executive: "shared executive",
  alumni_network: "alumni network",
  family_foundation_tie: "family foundation tie",
  giving_cycle_aligned: "NTEE alignment",
  asset_compatible: "asset compatibility",
  geographic_giving_history: "geographic giving history",
  board_network_overlap: "board network overlap",
};

function labelRelationshipType(value: string): string {
  return RELATIONSHIP_TYPE_LABELS[value] ?? value.replace(/_/g, " ");
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function describeCluster(relationshipTypes: string[], foundationCount: number): string {
  const labels = relationshipTypes.map(labelRelationshipType);
  const strengthTag =
    relationshipTypes.length >= 3
      ? "strong opportunity cluster"
      : "opportunity cluster";
  return `${foundationCount} foundation${foundationCount === 1 ? "" : "s"} matched by ${joinWithAnd(
    labels,
  )} — ${strengthTag}.`;
}

async function loadOrgEdges(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ edges: PigEdgeRow[]; nodesById: Map<string, PigNodeRow> }> {
  const { data: boardMembers, error: boardError } = await supabase
    .from("board_members")
    .select("id")
    .eq("org_id", organizationId);
  if (boardError) {
    throw new Error(`Failed to load board members: ${boardError.message}`);
  }
  const boardMemberIds = (boardMembers ?? []).map((b) => b.id as string);

  const sourceNodeIds: string[] = [];

  if (boardMemberIds.length > 0) {
    const { data: boardSourceNodes, error: boardNodeError } = await supabase
      .from("pig_nodes")
      .select("id")
      .eq("entity_table", "board_members")
      .in("entity_id", boardMemberIds);
    if (boardNodeError) {
      throw new Error(
        `Failed to load relationship nodes: ${boardNodeError.message}`,
      );
    }
    for (const n of boardSourceNodes ?? []) sourceNodeIds.push(n.id as string);
  }

  const { data: orgNode, error: orgNodeError } = await supabase
    .from("pig_nodes")
    .select("id")
    .eq("entity_table", "organizations")
    .eq("entity_id", organizationId)
    .maybeSingle();
  if (orgNodeError) {
    throw new Error(`Failed to load organization node: ${orgNodeError.message}`);
  }
  if (orgNode) sourceNodeIds.push(orgNode.id as string);

  if (sourceNodeIds.length === 0) {
    return { edges: [], nodesById: new Map() };
  }

  const { data: edges, error: edgeError } = await supabase
    .from("pig_edges")
    .select("id, source_node_id, target_node_id, relationship_type, weight")
    .in("source_node_id", sourceNodeIds);
  if (edgeError) {
    throw new Error(`Failed to load relationship edges: ${edgeError.message}`);
  }
  const edgeRows = (edges ?? []) as PigEdgeRow[];
  if (edgeRows.length === 0) {
    return { edges: [], nodesById: new Map() };
  }

  const nodeIds = new Set<string>();
  for (const e of edgeRows) {
    nodeIds.add(e.source_node_id);
    nodeIds.add(e.target_node_id);
  }
  const { data: nodes, error: nodesError } = await supabase
    .from("pig_nodes")
    .select("id, label, node_type")
    .in("id", [...nodeIds]);
  if (nodesError) {
    throw new Error(`Failed to load relationship node labels: ${nodesError.message}`);
  }
  const nodesById = new Map(
    ((nodes ?? []) as PigNodeRow[]).map((n) => [n.id, n]),
  );

  return { edges: edgeRows, nodesById };
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  try {
    const { edges, nodesById } = await loadOrgEdges(supabase, organizationId);

    // Node counts by type — every node touched by the org's edges (sources
    // like board members / the org's own node, and targets like funders,
    // corporate prospects, and foundations).
    const involvedNodeIds = new Set<string>();
    for (const e of edges) {
      involvedNodeIds.add(e.source_node_id);
      involvedNodeIds.add(e.target_node_id);
    }
    const nodeCountsByType = new Map<string, number>();
    for (const id of involvedNodeIds) {
      const type = nodesById.get(id)?.node_type ?? "unknown";
      nodeCountsByType.set(type, (nodeCountsByType.get(type) ?? 0) + 1);
    }

    // Edge counts by relationship_type.
    const edgeCountsByType = new Map<string, number>();
    for (const e of edges) {
      edgeCountsByType.set(
        e.relationship_type,
        (edgeCountsByType.get(e.relationship_type) ?? 0) + 1,
      );
    }

    // Top 10 most connected nodes — total edges touching each node, either
    // as source or target.
    const edgeCountByNode = new Map<string, number>();
    for (const e of edges) {
      edgeCountByNode.set(
        e.source_node_id,
        (edgeCountByNode.get(e.source_node_id) ?? 0) + 1,
      );
      edgeCountByNode.set(
        e.target_node_id,
        (edgeCountByNode.get(e.target_node_id) ?? 0) + 1,
      );
    }
    const topConnectedNodes: TopConnectedNode[] = [...edgeCountByNode.entries()]
      .map(([id, edgeCount]) => {
        const node = nodesById.get(id);
        return {
          id,
          label: node?.label ?? "Unknown",
          nodeType: node?.node_type ?? "unknown",
          edgeCount,
        };
      })
      .sort((a, b) => b.edgeCount - a.edgeCount)
      .slice(0, 10);

    // Per-foundation stats: edges where the target is a foundation_directory
    // node (node_type = "foundation").
    const edgesByFoundationTarget = new Map<string, PigEdgeRow[]>();
    for (const e of edges) {
      const target = nodesById.get(e.target_node_id);
      if (target?.node_type !== "foundation") continue;
      const list = edgesByFoundationTarget.get(e.target_node_id) ?? [];
      list.push(e);
      edgesByFoundationTarget.set(e.target_node_id, list);
    }

    const topFoundations: TopFoundation[] = [...edgesByFoundationTarget.entries()]
      .map(([foundationId, foundationEdges]) => {
        const label = nodesById.get(foundationId)?.label ?? "Unknown";
        const weights = foundationEdges
          .map((e) => e.weight)
          .filter((w): w is number => typeof w === "number");
        const avgWeight =
          weights.length > 0
            ? weights.reduce((sum, w) => sum + w, 0) / weights.length
            : 0;

        const typeCounts = new Map<string, number>();
        for (const e of foundationEdges) {
          typeCounts.set(
            e.relationship_type,
            (typeCounts.get(e.relationship_type) ?? 0) + 1,
          );
        }
        const topRelationshipType = [...typeCounts.entries()].sort(
          (a, b) => b[1] - a[1],
        )[0]?.[0] ?? "unknown";

        return {
          id: foundationId,
          label,
          edgeCount: foundationEdges.length,
          avgWeight: Math.round(avgWeight * 100) / 100,
          topRelationshipType,
        };
      })
      .sort((a, b) => b.edgeCount - a.edgeCount)
      .slice(0, 10);

    const avgConnectionsPerFoundation =
      edgesByFoundationTarget.size > 0
        ? Math.round(
            ([...edgesByFoundationTarget.values()].reduce(
              (sum, list) => sum + list.length,
              0,
            ) /
              edgesByFoundationTarget.size) *
              100,
          ) / 100
        : 0;

    // Strongest path score — the highest total edge weight converging on a
    // single foundation, the closest real proxy in this schema for "how
    // strong is the best warm path to any one funder."
    let strongestPathScore = 0;
    for (const foundationEdges of edgesByFoundationTarget.values()) {
      const total = foundationEdges.reduce((sum, e) => sum + (e.weight ?? 0), 0);
      if (total > strongestPathScore) strongestPathScore = total;
    }
    strongestPathScore = Math.round(strongestPathScore * 100) / 100;

    // Pattern detection — group foundations by the distinct set of
    // relationship_types (rules) linking to them; two or more distinct
    // rule types matching the same foundation is a cross-rule pattern.
    const signatureGroups = new Map<
      string,
      { relationshipTypes: string[]; foundationIds: Set<string> }
    >();
    for (const [foundationId, foundationEdges] of edgesByFoundationTarget) {
      const types = [...new Set(foundationEdges.map((e) => e.relationship_type))].sort();
      if (types.length < 2) continue;
      const signature = types.join("|");
      const group =
        signatureGroups.get(signature) ??
        { relationshipTypes: types, foundationIds: new Set<string>() };
      group.foundationIds.add(foundationId);
      signatureGroups.set(signature, group);
    }

    const clusters: Cluster[] = [...signatureGroups.values()]
      .map((group) => {
        const foundationNames = [...group.foundationIds].map(
          (id) => nodesById.get(id)?.label ?? "Unknown",
        );
        return {
          relationshipTypes: group.relationshipTypes,
          foundationCount: group.foundationIds.size,
          foundationNames,
          description: describeCluster(group.relationshipTypes, group.foundationIds.size),
          strength: group.relationshipTypes.length * group.foundationIds.size,
        };
      })
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 10);

    return NextResponse.json({
      totalNodes: involvedNodeIds.size,
      totalEdges: edges.length,
      avgConnectionsPerFoundation,
      strongestPathScore,
      nodeCounts: [...nodeCountsByType.entries()].map(([nodeType, count]) => ({
        nodeType,
        count,
      })),
      edgeCounts: [...edgeCountsByType.entries()].map(([relationshipType, count]) => ({
        relationshipType,
        count,
      })),
      topConnectedNodes,
      topFoundations,
      clusters,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to compute relationship graph analytics.",
        code: "db_error",
      },
      { status: 500 },
    );
  }
}
