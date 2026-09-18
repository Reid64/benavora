import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  frictionEstimateForHops,
  getNodesForProspectIds,
  getPrimaryProspectNode,
  getProspectById,
  getTenantContactProspectIds,
  pathConfidence,
  reconstructShortestPaths,
  recordRelationshipEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/rel/shared";
import { traverseGraph } from "@/lib/pil/graph";
import type { EvidenceItem, GraphEdge } from "@/lib/pil/types";

// BEN-REL-02 -- Board Relationship Mapping Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~630). Analyzes board and trustee
// networks for introduction opportunities: bounded multi-hop traversal
// (default max 4 hops, spec's own number) from the prospect toward any node
// connected to the tenant's own organization, ranking candidate paths by
// edge-confidence product rather than hop count alone.
//
// "Any node connected to the tenant's own organization" has no dedicated
// CRM-roster table in the PIL schema -- this agent uses the same signal
// BEN-DIS-08 established for "the tenant's own contact roster":
// pil_prospects.source_of_record='crm_import' (see rel/shared.ts's
// getTenantContactProspectIds).
//
// Permitted tools per spec: T-GRAPH (read), T-EVIDENCE (read), T-MODEL.
// Note the spec's own inputs mention T-MODEL but not T-EVIDENCE (write) --
// this agent's output is a reported traversal, not new claims, so it reads
// evidence context only and writes a summary evidence row on the prospect
// (matching every other REL agent's evidence-write convention) rather than
// leaving the traversal unrecorded.
//
// Upgrade (PIL_AGENT_COMPLETE_ROSTER.md/PIL_AGENT_DEPENDENCIES.yaml, paper
// specs with no implementation evidence -- design input only): adds three
// conditional delegations alongside the existing per-ranked-path BEN-REL-06
// delegation, per depends_on's BEN-INT-05/BEN-KNW-03/BEN-REL-05 entries,
// each gated on a concrete signal -- BEN-INT-05 (governance-depth
// intelligence) once per run when the top-ranked path's edges include a
// board/trustee edge type, BEN-KNW-03 (provenance verification) whenever
// any path was found, and BEN-REL-05 (broader warm-introduction search)
// when no board/trustee path was found even after the widen-to-5-hops
// fallback. conclusions.decision also now carries the roster's six named
// output dimensions (sharedOrganization/boardType/overlapInterval/
// roleCompatibility/pathLength/relationshipLimitations), populated from
// data this method already computes -- there is no dedicated
// pil_rel_02_decisions table, the same "no such table, use conclusions"
// resolution BEN-REL-05's header already documents.

const DEFAULT_MAX_HOPS = 4;
const WIDENED_MAX_HOPS = 5;
const TOP_PATHS_LIMIT = 5;

// Edge types this agent's own traversal confirms exist but does not itself
// characterize in governance detail (committee/officer-role/interval) --
// the BEN-INT-05 delegation trigger below.
const BOARD_GOVERNANCE_EDGE_TYPES = new Set(["serves_on_board_of", "trustee_of"]);

interface RankedPath {
  targetNodeId: string;
  targetLabel: string;
  hopCount: number;
  confidenceProduct: number;
  edgeIds: string[];
  edgeTypes: string[];
  frictionEstimate: string;
}

function rankPaths(paths: Map<string, GraphEdge[]>, labelByNodeId: Map<string, string>): RankedPath[] {
  const ranked: RankedPath[] = [];
  for (const [targetNodeId, path] of paths) {
    ranked.push({
      targetNodeId,
      targetLabel: labelByNodeId.get(targetNodeId) ?? targetNodeId,
      hopCount: path.length,
      confidenceProduct: pathConfidence(path),
      edgeIds: path.map((e) => e.id),
      edgeTypes: path.map((e) => e.edge_type),
      frictionEstimate: frictionEstimateForHops(path.length),
    });
  }
  // Spec observation behavior: rank by edge-confidence product first, hop
  // count only as a tiebreaker -- a short but weak path is not preferred
  // over a longer but well-evidenced one.
  ranked.sort((a, b) => b.confidenceProduct - a.confidenceProduct || a.hopCount - b.hopCount);
  return ranked;
}

export class BoardRelationshipMappingAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-REL-02 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const primaryNode = await getPrimaryProspectNode(context.orgId, prospect.id);
    if (!primaryNode) {
      return this.completedEmpty(`No graph node on file yet for prospect ${prospect.id} -- nothing to traverse from`);
    }

    const tenantContactProspectIds = await getTenantContactProspectIds(context.orgId);
    const tenantContactNodes = await getNodesForProspectIds(context.orgId, tenantContactProspectIds);
    const tenantContactNodeIds = new Set(tenantContactNodes.map((n) => n.id));

    let { nodes, edges } = await traverseGraph(primaryNode.id, DEFAULT_MAX_HOPS, context.orgId);
    let widened = false;

    let paths = reconstructShortestPaths(primaryNode.id, edges);
    let reachableTargets = [...paths.keys()].filter((id) => tenantContactNodeIds.has(id));

    if (reachableTargets.length === 0) {
      // Replanning trigger (spec): no path within the hop bound -- widen by
      // one hop before giving up, then report "no path found" rather than
      // fabricating a weak connection.
      const widenedResult = await traverseGraph(primaryNode.id, WIDENED_MAX_HOPS, context.orgId);
      nodes = widenedResult.nodes;
      edges = widenedResult.edges;
      widened = true;
      paths = reconstructShortestPaths(primaryNode.id, edges);
      reachableTargets = [...paths.keys()].filter((id) => tenantContactNodeIds.has(id));
    }

    const labelByNodeId = new Map(nodes.map((n) => [n.id, n.label]));
    const boardPaths = new Map<string, GraphEdge[]>();
    for (const targetId of reachableTargets) {
      const path = paths.get(targetId);
      if (path) boardPaths.set(targetId, path);
    }
    const ranked = rankPaths(boardPaths, labelByNodeId).slice(0, TOP_PATHS_LIMIT);

    const evidenceCreated: EvidenceItem[] = [];
    const delegations: DelegationRequest[] = [];

    if (ranked.length === 0) {
      evidenceCreated.push(
        await recordRelationshipEvidence({
          orgId: context.orgId,
          entityTable: "pil_prospects",
          entityId: prospect.id,
          claim: `No board/trustee-network path found from ${prospect.display_name} to an existing tenant contact within ${WIDENED_MAX_HOPS} hops`,
          value: { maxHopsSearched: WIDENED_MAX_HOPS, widened },
          claimType: "board_network_path",
          sourceUrl: null,
          sourceTitle: null,
          sourceType: "internal",
          publisher: null,
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence: 1,
          verificationStatus: "verified_fact",
        }),
      );
    } else {
      const topPath = ranked[0] as RankedPath;
      evidenceCreated.push(
        await recordRelationshipEvidence({
          orgId: context.orgId,
          entityTable: "pil_prospects",
          entityId: prospect.id,
          claim: `Board-network path found from ${prospect.display_name} to ${topPath.targetLabel} in ${topPath.hopCount} hop(s) via ${topPath.edgeTypes.join(" -> ")}`,
          value: topPath,
          claimType: "board_network_path",
          sourceUrl: null,
          sourceTitle: null,
          sourceType: "internal",
          publisher: null,
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence: topPath.confidenceProduct,
          verificationStatus: "reasoned_inference",
        }),
      );

      // Spec delegation permission: path-strength scoring delegated to
      // BEN-REL-06, one delegation per ranked path's edges.
      for (const path of ranked) {
        delegations.push({
          childAgentCode: "BEN-REL-06",
          objective: `Score relationship strength for board-network path edges [${path.edgeIds.join(", ")}] toward ${path.targetLabel}`,
          maxAutonomy: "A2",
          constraints: { prospectId: prospect.id, edgeIds: path.edgeIds },
        });
      }
    }

    const topPath: RankedPath | null = ranked.length > 0 ? (ranked[0] as RankedPath) : null;

    // BEN-INT-05: the top-ranked path's edges include a board/trustee edge
    // type -- this agent's own traversal only confirms the edge exists, not
    // its committee/officer-role/interval detail. Fires once per run for the
    // top path only, never once per ranked path.
    let governanceDelegated = false;
    if (topPath && topPath.edgeTypes.some((t) => BOARD_GOVERNANCE_EDGE_TYPES.has(t))) {
      delegations.push({
        childAgentCode: "BEN-INT-05",
        objective: `Deepen board-governance intelligence (committee/officer-role/interval detail) for the organization anchoring the board-network path to ${topPath.targetLabel} for prospect ${prospect.id} -- BEN-REL-02's traversal only confirmed the edge exists, not its governance detail.`,
        maxAutonomy: "A2",
        constraints: { prospectId: prospect.id, edgeIds: topPath.edgeIds, targetNodeId: topPath.targetNodeId },
      });
      governanceDelegated = true;
    }

    // BEN-KNW-03: every edge across the ranked paths needs provenance/
    // freshness verification before it informs introduction planning --
    // dedupe edge ids since the same edge can appear in multiple candidate
    // paths.
    if (ranked.length > 0) {
      const allPathEdgeIds = [...new Set(ranked.flatMap((p) => p.edgeIds))];
      delegations.push({
        childAgentCode: "BEN-KNW-03",
        objective: `Board-network path edges for prospect ${prospect.id} need provenance/freshness verification before they inform introduction planning.`,
        maxAutonomy: "A2",
        constraints: { prospectId: prospect.id, edgeIds: allPathEdgeIds },
      });
    }

    // BEN-REL-05: no board/trustee-network path was found even after the
    // widen-to-5-hops fallback -- ask for a broader warm-introduction search
    // across all relationship types, not just board/trustee edges. This
    // agent already has a valid context.prospectId at this point (guarded by
    // the early return at the top of this method), so no additional
    // prospectId guard is needed.
    if (ranked.length === 0) {
      delegations.push({
        childAgentCode: "BEN-REL-05",
        objective: `No board/trustee-network path was found from prospect ${prospect.id} to any tenant contact within ${WIDENED_MAX_HOPS} hops -- attempt a broader warm-introduction search across all relationship types, not just board/trustee edges.`,
        maxAutonomy: "A2",
        constraints: { prospectId: prospect.id },
      });
    }

    // BEN_REL_02Decision.v1's 6 named output dimensions (roster), mapped
    // onto data this method already computes -- no dedicated
    // pil_rel_02_decisions table exists, so this rides in conclusions
    // instead (same resolution BEN-REL-05's header documents).
    const decision = {
      sharedOrganization: topPath ? topPath.targetLabel : null,
      boardType: topPath && topPath.edgeTypes.length > 0 ? topPath.edgeTypes[0] : null,
      overlapInterval: governanceDelegated ? "not_yet_temporally_bounded_pending_BEN-INT-05" : "no_path_found",
      roleCompatibility: "unassessed_pending_BEN-INT-05_role_detail",
      pathLength: topPath ? topPath.hopCount : null,
      relationshipLimitations: ["co-service at a shared organization does not by itself imply personal closeness"],
    };

    const tokensUsed = await tryModelTokens(context, runner, 400);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        prospectId: prospect.id,
        maxHopsSearched: widened ? WIDENED_MAX_HOPS : DEFAULT_MAX_HOPS,
        widened,
        pathsFound: ranked.length,
        rankedPaths: ranked,
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

export default BoardRelationshipMappingAgent;
