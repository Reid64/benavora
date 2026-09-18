import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  getNodesForProspectIds,
  getTenantContactProspectIds,
  recordRelationshipEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/rel/shared";
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
//
// PIL_AGENT_COMPLETE_ROSTER.md / PIL_AGENT_DEPENDENCIES.yaml describe four
// additional delegation targets for this mission (BEN-INT-04, BEN-INT-05,
// BEN-KNW-03, BEN-REL-05), each authority/capability-gated (per those
// documents' own "$7 Delegation ... may call when its canonical reasoning
// boundary is required" framing) rather than fired unconditionally:
//   - BEN-INT-04 (alumni-overlap detail): fired per overlap pair when the
//     shared org node is flagged properties.institutionType === "education".
//     This platform's GraphNodeType enum (types.ts) has no dedicated
//     "school"/"education" node type -- education institutions are
//     represented generically (company/foundation/nonprofit) with this
//     properties flag other agents (a future BEN-INT-04 upgrade) are
//     expected to set. A real spec/schema gap, not a bug: when the flag is
//     absent this delegation cleanly does not fire, it is never guessed.
//   - BEN-INT-05 (board-governance depth): fired per overlap pair, in
//     addition to (not instead of) this agent's existing BEN-REL-06
//     ambiguous-band delegation, when the pair sits in the same
//     mid-size-org ambiguous band AND the affiliation edge is a board/
//     trustee tie -- BEN-INT-05 deepens committee/governance detail rather
//     than letting the group-size heuristic alone decide.
//   - BEN-KNW-03 (batch provenance): fired once after the full scan, when
//     this run wrote at least one new overlap edge, asking for provenance
//     verification across the whole batch.
//   - BEN-REL-05 (warm-introduction, PLATFORM-CONSTRAINT GUARDED): this
//     agent runs org-wide with no context.prospectId requirement (the
//     header note above -- "fundamentally a graph query problem"), but
//     BEN-REL-05 requires an existing prospectId and early-returns
//     otherwise. So this delegation is never gated on context.prospectId;
//     instead, when one overlap-pair endpoint is a tenant contact's own
//     graph node (getTenantContactProspectIds + getNodesForProspectIds,
//     both from shared.ts), the OTHER endpoint's owning prospect_id is
//     resolved from a real pil_graph_nodes read (GraphNode.prospect_id is
//     nullable) and only delegated when that lookup is non-null -- an
//     overlap partner who is not themselves a prospect-owned node yields no
//     delegation, never a guessed prospectId.
//
// The returned conclusions also carry a `decision` object mapping this
// agent's existing computed values onto the roster's 6 named output
// dimensions (Overlap Institution / Role Type / Simultaneity / Recurrence /
// Interaction Evidence / Overlap Confidence) -- see decideOverlap() below.
// Simultaneity and Recurrence are honestly reported as unimplemented
// (this agent's query already filters is_current=true only, with no
// interval-overlap check, and does not persist run-over-run history);
// Interaction Evidence is honestly reported as co-membership-only, matching
// this file's own header note above that it is a set-intersection pass, not
// a research pass.

const AFFILIATION_EDGE_TYPES: GraphEdgeType[] = ["serves_on_board_of", "trustee_of", "employed_by"];
const ORG_NODE_TYPES = new Set(["company", "foundation", "board", "nonprofit"]);
const BOARD_LIKE_EDGE_TYPES = new Set<GraphEdgeType>(["serves_on_board_of", "trustee_of"]);

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
    // Platform-constraint guard for the BEN-REL-05 delegation below: loaded
    // up front, before the main query, so the tenant's own contact node ids
    // are already in hand by the time the overlap loop needs them -- see
    // this file's header comment for why this cannot simply reuse
    // context.prospectId (this agent runs org-wide, BEN-REL-05 does not).
    const tenantContactProspectIds = await getTenantContactProspectIds(context.orgId);
    const tenantContactNodes = await getNodesForProspectIds(context.orgId, tenantContactProspectIds);
    const tenantContactNodeIds = new Set(tenantContactNodes.map((n) => n.id));

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

    // Batched once up front (rather than per-pair) so resolving the "other
    // endpoint" prospect_id for the BEN-REL-05 guard below is a single read,
    // not an N+1 -- these are exactly the source nodes the overlap loop will
    // pair up.
    const memberSourceNodeIds = [...new Set(affiliationEdges.map((e) => e.source_node_id))];
    let memberNodeById = new Map<string, GraphNode>();
    if (memberSourceNodeIds.length > 0) {
      const { data: memberNodeRows, error: memberNodeError } = await getPilClient()
        .from("pil_graph_nodes")
        .select("*")
        .eq("organization_id", context.orgId)
        .in("id", memberSourceNodeIds);
      if (memberNodeError) throw memberNodeError;
      memberNodeById = new Map(((memberNodeRows ?? []) as GraphNode[]).map((n) => [n.id, n]));
    }

    const evidenceCreated: EvidenceItem[] = [];
    const overlapEdgeIds: string[] = [];
    const delegations: DelegationRequest[] = [];
    const ambiguousEdgeIdsForScoring: string[] = [];
    const overlapTypesSeen = new Set<string>();
    const overlapConfidenceByEdgeId: Array<{ edgeId: string; confidence: number }> = [];

    for (const [orgNodeId, memberEdges] of membersByOrgNodeId) {
      if (memberEdges.length < 2) continue; // set-intersection needs >= 2 members to overlap
      const orgNode = orgNodeById.get(orgNodeId);
      if (!orgNode) continue;

      const memberCount = memberEdges.length;
      const strength = strengthForGroupSize(memberCount);
      const isAmbiguous = memberCount > SMALL_ORG_MEMBER_CAP && memberCount < LARGE_ORG_MEMBER_FLOOR;
      const edgeType = (memberEdges[0] as GraphEdge).edge_type;
      const overlapType = overlapTypeFor(edgeType);
      overlapTypesSeen.add(overlapType);

      const isEducationInstitution = orgNode.properties?.institutionType === "education";

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
          overlapConfidenceByEdgeId.push({ edgeId: overlapEdge.id, confidence });
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

          // Alumni-overlap delegation to BEN-INT-04: confirm the class-year/
          // attendance-interval detail behind this specific overlap before it
          // is scored as a strong relationship (see header comment -- gated
          // on the properties.institutionType schema-gap flag).
          if (isEducationInstitution) {
            delegations.push({
              childAgentCode: "BEN-INT-04",
              objective: `Confirm class-year/attendance-interval detail behind the alumni overlap at ${orgNode.label} between nodes ${memberA.source_node_id} and ${memberB.source_node_id} before it is scored as a strong relationship`,
              maxAutonomy: "A2",
              constraints: { organizationNodeId: orgNode.id, memberNodeIds: [memberA.source_node_id, memberB.source_node_id] },
            });
          }

          // Board-governance-depth delegation to BEN-INT-05: in addition to
          // (not instead of) the existing BEN-REL-06 ambiguous-band
          // delegation below, ask for committee/governance detail on this
          // specific ambiguous-sized board/trustee pair rather than
          // defaulting to the group-size heuristic alone.
          if (isAmbiguous && BOARD_LIKE_EDGE_TYPES.has(edgeType)) {
            delegations.push({
              childAgentCode: "BEN-INT-05",
              objective: `Deepen governance/committee detail for the ambiguous-sized board overlap at ${orgNode.label} (${memberCount} members) between edges ${memberA.id} and ${memberB.id}`,
              maxAutonomy: "A2",
              constraints: { organizationNodeId: orgNode.id, edgeIds: [memberA.id, memberB.id] },
            });
          }

          // Tenant-overlap warm-introduction delegation to BEN-REL-05
          // (platform-constraint guarded, see header comment): only when one
          // endpoint is the tenant's own contact and the other endpoint
          // resolves to a real, non-null owning prospect_id.
          if (tenantContactNodeIds.has(memberA.source_node_id) || tenantContactNodeIds.has(memberB.source_node_id)) {
            const otherNodeId = tenantContactNodeIds.has(memberA.source_node_id)
              ? memberB.source_node_id
              : memberA.source_node_id;
            const otherProspectId = memberNodeById.get(otherNodeId)?.prospect_id ?? null;
            if (otherProspectId) {
              delegations.push({
                childAgentCode: "BEN-REL-05",
                objective: `Compute a full warm-introduction path for prospect ${otherProspectId} through the shared overlap at ${orgNode.label}`,
                maxAutonomy: "A2",
                constraints: { prospectId: otherProspectId, sharedOrganizationNodeId: orgNode.id },
              });
            }
            // otherProspectId null: the other endpoint is not itself a
            // prospect-owned node -- skip cleanly, never guess a prospectId.
          }
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

    // Batch provenance delegation to BEN-KNW-03: one entry for the whole
    // run's newly-written overlap edges, not one per edge.
    if (overlapEdgeIds.length > 0) {
      delegations.push({
        childAgentCode: "BEN-KNW-03",
        objective: `${overlapEdgeIds.length} newly written organizational-overlap edge(s) need provenance verification`,
        maxAutonomy: "A2",
        constraints: { edgeIds: overlapEdgeIds },
      });
    }

    const tokensUsed = await tryModelTokens(context, runner, 300);

    const decision = {
      overlapInstitution: orgNodes
        .filter((n) => (membersByOrgNodeId.get(n.id)?.length ?? 0) >= 2)
        .map((n) => ({ nodeId: n.id, label: n.label, nodeType: n.node_type })),
      roleType: [...overlapTypesSeen],
      simultaneity: "unbounded_no_temporal_validity_on_affiliation_edges",
      recurrence: "single_snapshot_not_tracked_over_time",
      interactionEvidence: "co-membership_only_no_direct_interaction_evidence",
      overlapConfidence: overlapConfidenceByEdgeId,
    };

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        organizationsScanned: membersByOrgNodeId.size,
        overlapEdgeIds,
        ambiguousEdgeCount: ambiguousEdgeIdsForScoring.length,
        decision,
      },
      delegations,
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts (called inside tryModelTokens); recording it again here would double-count the same tokens.
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
