import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { MODEL_TOKEN_UNIT_COST_USD, recordRelationshipEvidence, tryModelTokens } from "@/lib/pil/agents/rel/shared";
import { getPilClient } from "@/lib/pil/db";
import { upsertEdge } from "@/lib/pil/graph";
import type { EvidenceItem, GraphEdge, GraphEdgeType, GraphNode, RelationshipStrength } from "@/lib/pil/types";

// BEN-REL-04 -- Organizational Overlap Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~672). Identifies shared
// organizational memberships among prospects and tenant-connected
// individuals: a deterministic set-intersection pass across every
// board/education/company/community-organization affiliation edge in the
// graph (spec planning behavior: "since this is fundamentally a graph query
// problem, not a research problem"), not pairwise search.
//
// The task spec that commissioned this batch numbered this mission
// BEN-REL-06 and put a "Foundation Relationship Mapping" agent at
// BEN-REL-04 instead. The registry's real BEN-REL-04 is this Organizational
// Overlap Agent (supabase/migrations/155_pil_agent_registry.sql line 102);
// built to the live spec per this codebase's established registry-wins
// pattern.
//
// Permitted tools per spec: T-GRAPH (read/write), T-EVIDENCE (read). This
// agent writes new overlap edges (its whole output, per spec), so it also
// writes T-EVIDENCE for each -- every other REL agent's evidence-write
// convention -- despite the spec listing only "(read)" for this one tool;
// treated as a spec omission rather than a reason to leave new edges
// uncited.

const AFFILIATION_EDGE_TYPES: GraphEdgeType[] = ["serves_on_board_of", "trustee_of", "employed_by"];
const ORG_NODE_TYPES = new Set(["company", "foundation", "board", "nonprofit"]);

// Spec observation behavior's own example: an 8-person board is substantive,
// a large public university decades apart is incidental. Board/trustee ties
// at a small org are 'strong'; anything at a large org is 'weak' by default,
// with the ambiguous middle band delegated to BEN-REL-06 rather than
// guessed.
const SMALL_ORG_MEMBER_CAP = 15;
const LARGE_ORG_MEMBER_FLOOR = 100;

function overlapTypeFor(edgeType: GraphEdgeType): string {
  if (edgeType === "serves_on_board_of" || edgeType === "trustee_of") return "board_colleague";
  if (edgeType === "employed_by") return "employment_colleague";
  return "organizational_overlap";
}

function strengthForGroupSize(memberCount: number): RelationshipStrength {
  if (memberCount <= SMALL_ORG_MEMBER_CAP) return "strong";
  if (memberCount >= LARGE_ORG_MEMBER_FLOOR) return "weak";
  return "moderate";
}

export class OrganizationalOverlapAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    const { data: orgNodeRows, error: orgNodeError } = await getPilClient()
      .from("pil_graph_nodes")
      .select("*")
      .eq("organization_id", context.orgId)
      .in("node_type", [...ORG_NODE_TYPES]);
    if (orgNodeError) throw orgNodeError;
    const orgNodes = (orgNodeRows ?? []) as GraphNode[];

    if (orgNodes.length === 0) {
      return this.completedEmpty("No organization-type graph nodes on file for this org");
    }

    const { data: affiliationEdgeRows, error: edgeError } = await getPilClient()
      .from("pil_graph_edges")
      .select("*")
      .eq("organization_id", context.orgId)
      .eq("is_current", true)
      .in("edge_type", AFFILIATION_EDGE_TYPES)
      .in("target_node_id", orgNodes.map((n) => n.id));
    if (edgeError) throw edgeError;
    const affiliationEdges = (affiliationEdgeRows ?? []) as GraphEdge[];

    const membersByOrgNodeId = new Map<string, GraphEdge[]>();
    for (const edge of affiliationEdges) {
      const list = membersByOrgNodeId.get(edge.target_node_id) ?? [];
      list.push(edge);
      membersByOrgNodeId.set(edge.target_node_id, list);
    }
    const orgNodeById = new Map(orgNodes.map((n) => [n.id, n]));

    const evidenceCreated: EvidenceItem[] = [];
    const overlapEdgeIds: string[] = [];
    const delegations: DelegationRequest[] = [];
    const ambiguousEdgeIdsForScoring: string[] = [];

    for (const [orgNodeId, memberEdges] of membersByOrgNodeId) {
      if (memberEdges.length < 2) continue; // set-intersection needs >= 2 members to overlap
      const orgNode = orgNodeById.get(orgNodeId);
      if (!orgNode) continue;

      const memberCount = memberEdges.length;
      const strength = strengthForGroupSize(memberCount);
      const isAmbiguous = memberCount > SMALL_ORG_MEMBER_CAP && memberCount < LARGE_ORG_MEMBER_FLOOR;
      const edgeType = (memberEdges[0] as GraphEdge).edge_type;
      const overlapType = overlapTypeFor(edgeType);

      for (let i = 0; i < memberEdges.length; i++) {
        for (let j = i + 1; j < memberEdges.length; j++) {
          const memberA = memberEdges[i] as GraphEdge;
          const memberB = memberEdges[j] as GraphEdge;
          if (memberA.source_node_id === memberB.source_node_id) continue;

          const confidence = Math.min(memberA.confidence ?? 1, memberB.confidence ?? 1);
          const overlapEdge = await upsertEdge({
            organization_id: context.orgId,
            source_node_id: memberA.source_node_id,
            target_node_id: memberB.source_node_id,
            edge_type: "related_to",
            relationship_strength: strength,
            confidence,
            temporal_validity_start: null,
            temporal_validity_end: null,
            is_current: true,
            superseded_by_edge_id: null,
            properties: {
              overlapType,
              sharedOrganizationNodeId: orgNode.id,
              sharedOrganizationLabel: orgNode.label,
              sharedOrganizationNodeType: orgNode.node_type,
              sharedOrganizationMemberCount: memberCount,
            },
          });
          overlapEdgeIds.push(overlapEdge.id);
          if (isAmbiguous) ambiguousEdgeIdsForScoring.push(overlapEdge.id);

          evidenceCreated.push(
            await recordRelationshipEvidence({
              orgId: context.orgId,
              entityTable: "pil_graph_edges",
              entityId: overlapEdge.id,
              claim: `Organizational overlap: both connected to ${orgNode.label} (${memberCount} known members) via ${edgeType}`,
              value: { sharedOrganizationNodeId: orgNode.id, memberCount, overlapType },
              claimType: "organizational_overlap",
              sourceUrl: null,
              sourceTitle: null,
              sourceType: "internal",
              publisher: null,
              evidenceExcerpt: null,
              agentCode: context.agentCode,
              researchRunId: context.runId,
              confidence,
              verificationStatus: "reasoned_inference",
            }),
          );
        }
      }
    }

    if (ambiguousEdgeIdsForScoring.length > 0) {
      delegations.push({
        childAgentCode: "BEN-REL-06",
        objective: `Score relationship strength for ${ambiguousEdgeIdsForScoring.length} overlap edge(s) at mid-sized shared organizations (${SMALL_ORG_MEMBER_CAP}-${LARGE_ORG_MEMBER_FLOOR} members) rather than defaulting to 'moderate'`,
        maxAutonomy: "A2",
        constraints: { edgeIds: ambiguousEdgeIdsForScoring },
      });
    }

    const tokensUsed = await tryModelTokens(context, runner, 300);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        organizationsScanned: membersByOrgNodeId.size,
        overlapEdgeIds,
        ambiguousEdgeCount: ambiguousEdgeIdsForScoring.length,
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

export default OrganizationalOverlapAgent;
