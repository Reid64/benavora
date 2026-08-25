import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  callTool,
  extractLeadName,
  getPrimaryProspectNode,
  getProspectById,
  hostnameOf,
  MODEL_TOKEN_UNIT_COST_USD,
  recordRelationshipEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/rel/shared";
import { traverseGraph, upsertEdge, upsertNode } from "@/lib/pil/graph";
import type { EvidenceItem, GraphNode, GraphNodeType } from "@/lib/pil/types";

// BEN-REL-01 -- Relationship Discovery Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~609). Discovers documented
// relationships between a prospect and relevant people or organizations,
// starting from the prospect's existing Family 3 edges (employment/board/
// education/business) and searching outward exactly one hop further, per
// spec's planning behavior: "Starts from the prospect's existing edges and
// searches outward one hop at a time, rather than an unbounded open-ended
// relationship search."
//
// The task spec that commissioned this batch described this code as a
// two-prospect, 4-hop shared-node pathfinder. That mission belongs to
// BEN-REL-02 (bounded multi-hop traversal, spec explicitly "default max 4
// hops") -- the registry's real BEN-REL-01 is this one-hop-outward discovery
// agent (supabase/migrations/155_pil_agent_registry.sql line 99). Built to
// the live registry/spec per this codebase's established pattern (see
// BEN-DIS-*.ts / BEN-INT-09.ts headers); see MEMORY.md
// benavora-pil-int-01-08-mislabel-2026-08-24 and its linked memories for
// the recurring collision this batch continues.
//
// Permitted tools per spec: T-GRAPH (read/write), T-WEB, T-EVIDENCE (write).

const BOARD_LIKE_TYPES: GraphNodeType[] = ["foundation", "nonprofit", "board"];
const CORPORATE_LIKE_TYPES: GraphNodeType[] = ["company"];

function relationshipTypeFor(neighborType: GraphNodeType): string {
  if (neighborType === "foundation") return "foundation";
  if (neighborType === "board") return "board";
  if (neighborType === "nonprofit") return "nonprofit";
  if (neighborType === "company") return "employment_or_business";
  if (neighborType === "cause") return "community-organization";
  return "professional-association";
}

export class RelationshipDiscoveryAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-REL-01 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const primaryNode = await getPrimaryProspectNode(context.orgId, prospect.id);
    if (!primaryNode) {
      return this.completedEmpty(`No graph node on file yet for prospect ${prospect.id} -- nothing to search outward from`);
    }

    // "Prospect's existing edges" -- the one-hop Family 3 neighborhood
    // already on file, not a fresh search from scratch.
    const { nodes: oneHopNodes, edges: existingEdges } = await traverseGraph(primaryNode.id, 1, context.orgId);
    const existingNeighbors = oneHopNodes.filter((n) => n.id !== primaryNode.id);

    const evidenceCreated: EvidenceItem[] = [];
    const newEdgeIds: string[] = [];
    const newNodeIds: string[] = [];
    let boardLikeHits = 0;
    let corporateLikeHits = 0;

    for (const neighbor of existingNeighbors) {
      const relationshipType = relationshipTypeFor(neighbor.node_type);

      const searchResult = await callTool(context, runner, "web_search", {
        query: `"${prospect.display_name}" "${neighbor.label}" board OR trustee OR colleague OR "co-founder" OR alumni`,
        limit: 3,
      });
      if (!searchResult.success) continue;
      const results = (searchResult.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? [];
      const top = results[0];
      if (!top) continue;

      const candidateName = extractLeadName(top.title);
      if (!candidateName || candidateName === prospect.display_name || candidateName === neighbor.label) continue;

      // Replanning trigger (spec): the discovered entity doesn't yet exist
      // as a pil_graph_nodes row -- create the node first, then the edge.
      // upsertNode's own find-then-write dedups by (node_type, label,
      // prospect_id) so a repeat discovery updates rather than duplicates.
      const candidateNode: GraphNode = await upsertNode({
        organization_id: context.orgId,
        node_type: "person",
        prospect_id: null,
        label: candidateName,
        properties: { discoveredVia: neighbor.label, relationshipType },
      });
      newNodeIds.push(candidateNode.id);

      // upsertEdge's own find-then-write (by source/target/edge_type/
      // is_current) is this agent's duplicate-edge guard (spec observation
      // behavior: "Checks whether a discovered relationship already exists
      // as an edge") -- a repeat discovery reconciles confidence on the
      // existing row instead of creating a conflicting duplicate.
      const edge = await upsertEdge({
        organization_id: context.orgId,
        source_node_id: primaryNode.id,
        target_node_id: candidateNode.id,
        edge_type: "related_to",
        relationship_strength: "speculative",
        confidence: 0.3,
        temporal_validity_start: null,
        temporal_validity_end: null,
        is_current: true,
        superseded_by_edge_id: null,
        properties: { relationshipType, viaOrganization: neighbor.label, viaOrganizationNodeType: neighbor.node_type },
      });
      newEdgeIds.push(edge.id);

      if (BOARD_LIKE_TYPES.includes(neighbor.node_type)) boardLikeHits += 1;
      if (CORPORATE_LIKE_TYPES.includes(neighbor.node_type)) corporateLikeHits += 1;

      evidenceCreated.push(
        await recordRelationshipEvidence({
          orgId: context.orgId,
          entityTable: "pil_graph_edges",
          entityId: edge.id,
          claim: `Possible relationship discovered one hop beyond ${prospect.display_name}'s known ${relationshipType} tie to ${neighbor.label}: ${candidateName} (${top.title})`,
          value: { candidateName, viaOrganization: neighbor.label, title: top.title, url: top.url },
          claimType: "relationship_discovery",
          sourceUrl: top.url,
          sourceTitle: top.title,
          sourceType: "open_web",
          publisher: hostnameOf(top.url),
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence: 0.3,
          verificationStatus: "unverified",
        }),
      );
    }

    const delegations: DelegationRequest[] = [];
    if (boardLikeHits > 0) {
      delegations.push({
        childAgentCode: "BEN-REL-02",
        objective: `Deep board-network analysis for prospect ${prospect.id} (${boardLikeHits} board/foundation/nonprofit ties found)`,
        maxAutonomy: "A2",
        constraints: { prospectId: prospect.id },
      });
    }
    if (corporateLikeHits > 0) {
      delegations.push({
        childAgentCode: "BEN-REL-03",
        objective: `Corporate-network analysis for prospect ${prospect.id} (${corporateLikeHits} company ties found)`,
        maxAutonomy: "A2",
        constraints: { prospectId: prospect.id },
      });
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        prospectId: prospect.id,
        existingNeighborsScanned: existingNeighbors.length,
        existingEdgesOnFile: existingEdges.length,
        newEdgeIds,
        newNodeIds,
      },
      delegations,
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  private completedEmpty(reason: string): AgentResult {
    return {
      status: "completed",
      evidence: [],
      conclusions: { skipped: true, reason },
      delegations: [],
      tokensUsed: 0,
      costUsd: 0,
      error: null,
    };
  }
}

export default RelationshipDiscoveryAgent;
