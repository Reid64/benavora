import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireRole } from "@/lib/auth/role-gate";
import { RelationshipGraphBuilderAgent } from "@/lib/agents/relationship-graph-builder-agent";

// GET/POST /api/intelligence/relationship-graph — AG-32 Relationship Graph
// Builder (AUTONOMOUS_PLATFORM_VISION.md §7 "Corporate Relationship Graph";
// src/lib/agents/relationship-graph-builder-agent.ts).
//
// Schema deviation, verified against real migrations before writing this
// route (see the agent file's own header for the full account): no
// `corporate_relationships` table exists anywhere in src/supabase/migrations/
// or supabase/migrations/, despite SCHEMA_REGISTRY_v2.md table 37 describing
// it as applied. The agent writes board-member -> funder/prospect
// connections as new `relationship_type` values on the real, applied
// `pig_edges` table instead (migration 077_intelligence_graph.sql), keyed
// through `pig_nodes` (entity_table/entity_id). This route reads that real
// structure and reshapes it into the connection objects the UI needs —
// introduction strength, warm-introduction path, source/target labels — all
// of which live in `pig_edges.metadata` (jsonb) rather than as dedicated
// columns, exactly as the agent file documents. `pig_edges` carries no
// organization_id of its own, so "for org" is proven by walking
// pig_edges -> pig_nodes(source) -> board_members.organization_id.
//
// Fixed 2026-08-07: this file previously queried board_members with
// `.eq("org_id", organizationId)`. board_members is the original table from
// supabase/migrations/001_initial_schema.sql and its real live column is
// organization_id, not org_id — org_id only exists on the newer
// board_meetings/board_meeting_packets tables (migration 078), a different
// table in the same "board" feature area with a genuinely different
// column-naming convention. This bug silently zeroed every org-scoped read
// in loadRelationshipGraph()/the DELETE-ownership check below (board_members
// query always returned 0 rows, so every connection list came back empty
// and every edge ownership check 404'd) — same class of bug already found
// and fixed in the AG-32 agent file itself (AGENT_VERIFICATION_LOG.md).
//
// GET  — the caller's org's discovered connections, direct introductions
//        first (introduction_strength ASC), then most recently discovered
//        (discovered_at DESC), plus `nodes`/`edges` — the same pig_nodes/
//        pig_edges rows reshaped for the force-directed graph view
//        (FEATURE_REGISTRY_v2.md row #81, "Relationship Explorer UI").
// POST — with no body: runs RelationshipGraphBuilderAgent synchronously
//        ("manual" trigger) and returns the refreshed connection list.
//        agent_type 'ag-32-relationship-graph' is not yet a valid
//        agent_runs.agent_type enum value (AGENTS_v2.md §1.2/§1.4) — this
//        agent's startRun() throws before doing any work until a future
//        migration adds it, matching every other unwired Generation-2 agent
//        in this codebase. That failure is caught here and surfaced as a
//        real error rather than silently swallowed.
//        with { action: "request_introduction", edgeId }: marks that edge as
//        introduction-requested and raises an alerts row for a human to
//        follow up on — there is no dedicated "outreach task" table, so this
//        reuses the existing alerts system (SCHEMA_REGISTRY_v2.md §4.2 Core
//        Data Principle #1: one source of truth per entity).

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

type IntroductionStrength = "direct" | "one_hop" | "two_hop";

interface ConnectionOut {
  id: string;
  sourceLabel: string;
  sourceType: string;
  targetLabel: string;
  targetNodeType: string;
  relationshipType: string;
  introductionStrength: IntroductionStrength;
  warmIntroductionPath: string | null;
  confidence: number | null;
  weight: number | null;
  verified: boolean;
  introductionRequested: boolean;
  discoveredAt: string;
}

// Row #81 "Relationship Explorer UI" (FEATURE_REGISTRY_v2.md) — a real
// force-directed visualization of the same pig_nodes/pig_edges this route
// already reads, added to the existing card-list view rather than a new
// page. GraphNodeOut/GraphEdgeOut are a second, structural view of the
// exact same rows loadRelationshipGraph() below already fetches for
// `connections` — no second data-fetching path, no synthetic nodes/edges.
interface GraphNodeOut {
  id: string;
  label: string;
  nodeType: string;
}

interface GraphEdgeOut {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: string;
  weight: number | null;
  verified: boolean;
}

interface RelationshipGraphOut {
  connections: ConnectionOut[];
  nodes: GraphNodeOut[];
  edges: GraphEdgeOut[];
}

const STRENGTH_RANK: Record<string, number> = {
  direct: 0,
  one_hop: 1,
  two_hop: 2,
};

function sortConnections(rows: ConnectionOut[]): ConnectionOut[] {
  return [...rows].sort((a, b) => {
    const rankDiff =
      (STRENGTH_RANK[a.introductionStrength] ?? 9) -
      (STRENGTH_RANK[b.introductionStrength] ?? 9);
    if (rankDiff !== 0) return rankDiff;
    return (
      new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime()
    );
  });
}

function resolveStrength(value: unknown): IntroductionStrength {
  if (value === "one_hop") return "one_hop";
  if (value === "two_hop") return "two_hop";
  return "direct";
}

const EMPTY_GRAPH: RelationshipGraphOut = { connections: [], nodes: [], edges: [] };

/** Loads the org's connections by joining pig_edges back to pig_nodes and
 * board_members, since pig_edges carries no organization_id of its own —
 * and, from that same single set of queries, the node/edge structure the
 * force-directed graph view renders. There is no second query path for the
 * graph: `nodes`/`edges` below are the exact same pig_nodes/pig_edges rows
 * `connections` is built from, just reshaped. */
async function loadRelationshipGraph(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<RelationshipGraphOut> {
  const { data: boardMembers, error: boardError } = await supabase
    .from("board_members")
    .select("id")
    .eq("organization_id", organizationId);
  if (boardError) {
    throw new Error(`Failed to load board members: ${boardError.message}`);
  }
  const boardMemberIds = (boardMembers ?? []).map((b) => b.id as string);
  if (boardMemberIds.length === 0) return EMPTY_GRAPH;

  const { data: sourceNodes, error: sourceError } = await supabase
    .from("pig_nodes")
    .select("id")
    .eq("entity_table", "board_members")
    .in("entity_id", boardMemberIds);
  if (sourceError) {
    throw new Error(
      `Failed to load relationship nodes: ${sourceError.message}`,
    );
  }
  const sourceNodeIds = (sourceNodes ?? []).map((n) => n.id as string);
  if (sourceNodeIds.length === 0) return EMPTY_GRAPH;

  const { data: edges, error: edgeError } = await supabase
    .from("pig_edges")
    .select(
      "id, source_node_id, target_node_id, relationship_type, weight, verified, metadata, discovered_at",
    )
    .in("source_node_id", sourceNodeIds)
    .order("discovered_at", { ascending: false });
  if (edgeError) {
    throw new Error(`Failed to load relationship edges: ${edgeError.message}`);
  }
  const edgeRows = edges ?? [];
  if (edgeRows.length === 0) return EMPTY_GRAPH;

  const nodeIds = new Set<string>();
  for (const e of edgeRows) {
    nodeIds.add(e.source_node_id as string);
    nodeIds.add(e.target_node_id as string);
  }
  const { data: nodes, error: nodesError } = await supabase
    .from("pig_nodes")
    .select("id, label, node_type")
    .in("id", [...nodeIds]);
  if (nodesError) {
    throw new Error(
      `Failed to load relationship node labels: ${nodesError.message}`,
    );
  }
  const nodeById = new Map(
    (nodes ?? []).map((n) => [
      n.id as string,
      n as { id: string; label: string; node_type: string },
    ]),
  );

  const connections: ConnectionOut[] = edgeRows.map((e) => {
    const metadata = (e.metadata ?? {}) as Record<string, unknown>;
    const source = nodeById.get(e.source_node_id as string);
    const target = nodeById.get(e.target_node_id as string);

    return {
      id: e.id as string,
      sourceLabel:
        source?.label ?? (metadata.source_entity_name as string) ?? "Unknown",
      sourceType: (metadata.source_type as string) ?? "board_member",
      targetLabel:
        target?.label ?? (metadata.target_entity_name as string) ?? "Unknown",
      targetNodeType: target?.node_type ?? "business",
      relationshipType: e.relationship_type as string,
      introductionStrength: resolveStrength(metadata.introduction_strength),
      warmIntroductionPath:
        (metadata.warm_introduction_path as string) ?? null,
      confidence:
        typeof metadata.confidence === "number" ? metadata.confidence : null,
      weight: typeof e.weight === "number" ? e.weight : null,
      verified: Boolean(e.verified),
      introductionRequested: Boolean(metadata.introduction_requested),
      discoveredAt: e.discovered_at as string,
    };
  });

  const graphNodes: GraphNodeOut[] = [...nodeById.values()].map((n) => ({
    id: n.id,
    label: n.label,
    nodeType: n.node_type,
  }));
  const graphEdges: GraphEdgeOut[] = edgeRows.map((e) => ({
    id: e.id as string,
    sourceId: e.source_node_id as string,
    targetId: e.target_node_id as string,
    relationshipType: e.relationship_type as string,
    weight: typeof e.weight === "number" ? e.weight : null,
    verified: Boolean(e.verified),
  }));

  return {
    connections: sortConnections(connections),
    nodes: graphNodes,
    edges: graphEdges,
  };
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  try {
    const graph = await loadRelationshipGraph(supabase, organizationId);
    return NextResponse.json(graph);
  } catch {
    return jsonError(
      "Failed to load relationship graph.",
      "db_error",
      500,
    );
  }
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : null;

  if (action === "request_introduction") {
    const edgeId = typeof body.edgeId === "string" ? body.edgeId : null;
    if (!edgeId) {
      return jsonError("edgeId is required.", "missing_edge_id", 400);
    }

    const { data: edge, error: edgeError } = await supabase
      .from("pig_edges")
      .select("id, source_node_id, target_node_id, metadata")
      .eq("id", edgeId)
      .single();
    if (edgeError || !edge) {
      return jsonError("Connection not found.", "not_found", 404);
    }

    // Prove the edge belongs to this org before touching it — pig_edges has
    // no organization_id, so ownership runs through pig_nodes ->
    // board_members.organization_id (see loadRelationshipGraph above).
    const { data: sourceNode } = await supabase
      .from("pig_nodes")
      .select("entity_table, entity_id, label")
      .eq("id", edge.source_node_id as string)
      .single();
    if (!sourceNode || sourceNode.entity_table !== "board_members") {
      return jsonError("Connection not found.", "not_found", 404);
    }
    const { data: boardMember } = await supabase
      .from("board_members")
      .select("id")
      .eq("id", sourceNode.entity_id as string)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!boardMember) {
      return jsonError("Connection not found.", "not_found", 404);
    }

    const { data: targetNode } = await supabase
      .from("pig_nodes")
      .select("label")
      .eq("id", edge.target_node_id as string)
      .single();

    const metadata = (edge.metadata ?? {}) as Record<string, unknown>;
    const { error: updateError } = await supabase
      .from("pig_edges")
      .update({
        metadata: {
          ...metadata,
          introduction_requested: true,
          introduction_requested_at: new Date().toISOString(),
          introduction_requested_by: userId,
        },
      })
      .eq("id", edgeId);
    if (updateError) {
      return jsonError(
        "Failed to record the introduction request.",
        "db_error",
        500,
      );
    }

    await supabase.from("alerts").upsert(
      {
        organization_id: organizationId,
        type: "system",
        severity: "info",
        message: `Introduction requested: ${sourceNode.label} -> ${
          (targetNode as { label?: string } | null)?.label ?? "connection"
        }`,
        link: "/intelligence/relationship-graph",
        dedup_key: `intro-request:${edgeId}`,
      },
      { onConflict: "organization_id,dedup_key" },
    );

    try {
      const graph = await loadRelationshipGraph(supabase, organizationId);
      return NextResponse.json(graph);
    } catch {
      return jsonError(
        "Failed to reload relationship graph.",
        "db_error",
        500,
      );
    }
  }

  try {
    const agent = new RelationshipGraphBuilderAgent(organizationId, supabase);
    const result = await agent.run("manual");

    if (!result.success) {
      return jsonError(
        result.errors[0] ?? "Relationship graph discovery run failed.",
        "agent_run_failed",
        500,
      );
    }

    const graph = await loadRelationshipGraph(supabase, organizationId);
    return NextResponse.json({
      ...graph,
      itemsFound: result.itemsFound,
      itemsProcessed: result.itemsProcessed,
      errors: result.errors,
    });
  } catch {
    // RelationshipGraphBuilderAgent.startRun() writes
    // agent_type = 'ag-32-relationship-graph', which is not yet in the
    // agent_runs enum (AGENTS_v2.md §1.2) — that insert throws before
    // startRun() returns, outside the agent's own try/catch, so it
    // surfaces here rather than inside result.errors.
    return jsonError(
      "Relationship graph discovery run failed.",
      "agent_run_failed",
      500,
    );
  }
}
