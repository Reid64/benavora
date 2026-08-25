import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  frictionEstimateForHops,
  getNodesForProspectIds,
  getPrimaryProspectNode,
  getProspectById,
  getTenantContactProspectIds,
  MODEL_TOKEN_UNIT_COST_USD,
  pathConfidence,
  reconstructShortestPaths,
  recordRelationshipEvidence,
  refetchEdge,
  tryModelTokens,
} from "@/lib/pil/agents/rel/shared";
import { traverseGraph } from "@/lib/pil/graph";
import type { EvidenceItem, GraphEdge, RelationshipStrength } from "@/lib/pil/types";

// BEN-REL-05 -- Warm Introduction Pathfinding Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~693). Finds the strongest
// evidence-backed introduction path between the organization and a
// prospect: computes multiple candidate paths (not just the shortest) and
// ranks by a composite of hop count, edge confidence, strength, and
// freshness (spec planning behavior).
//
// The task spec that commissioned this batch numbered this mission
// BEN-REL-07 and put a "Professional Connection Mapping" agent at BEN-REL-05
// instead. The registry's real BEN-REL-05 is this Warm Introduction
// Pathfinding Agent (supabase/migrations/155_pil_agent_registry.sql line
// 103); Family 4 (Relationship & Graph Intelligence) is a hard-capped 6
// agents there ("| Relationship & Graph Intelligence | 6 | BEN-REL-01 ..
// BEN-REL-06 |") -- BEN-REL-07/08 do not exist anywhere in the spec,
// architecture doc, or registry. Built to the live spec per this codebase's
// established registry-wins pattern; BEN-REL-07/08 are not built (see
// index.ts's header for the full reconciliation).
//
// Spec output destination "pil_prospect_digital_twins.relationships_summary"
// does not exist anywhere in this schema (no migration creates it, no
// TS interface in types.ts) -- ranked paths are written to pil_evidence and
// returned in conclusions instead, the same "table doesn't exist, use
// evidence + conclusions" resolution BEN-INT-09.ts documents for a
// comparable spec/schema gap.
//
// Permitted tools per spec: T-GRAPH (read), T-EVIDENCE (read), T-MODEL.
// Written evidence rows here follow the same convention every other REL
// agent uses (see BEN-REL-02.ts's identical note).

const MAX_HOPS = 4;
const TOP_PATHS_LIMIT = 5;
const STRENGTH_WEIGHT: Record<RelationshipStrength, number> = {
  very_strong: 1,
  strong: 0.8,
  moderate: 0.6,
  weak: 0.4,
  speculative: 0.2,
};

interface RankedPath {
  targetNodeId: string;
  targetLabel: string;
  hopCount: number;
  confidenceProduct: number;
  averageStrengthWeight: number;
  score: number;
  fresh: boolean;
  frictionEstimate: string;
  recommendedIntroducer: string;
  edgeIds: string[];
}

function averageStrengthWeight(path: GraphEdge[]): number {
  const weights = path.map((e) => STRENGTH_WEIGHT[e.relationship_strength ?? "moderate"] ?? STRENGTH_WEIGHT.moderate);
  return weights.reduce((sum, w) => sum + w, 0) / weights.length;
}

export class WarmIntroductionPathfindingAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-REL-05 requires an existing prospectId");
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
    const labelByNodeId = new Map(tenantContactNodes.map((n) => [n.id, n.label]));

    const { edges } = await traverseGraph(primaryNode.id, MAX_HOPS, context.orgId);
    const paths = reconstructShortestPaths(primaryNode.id, edges);

    const candidates: RankedPath[] = [];
    for (const [targetNodeId, path] of paths) {
      if (!tenantContactNodeIds.has(targetNodeId)) continue;
      const confidenceProduct = pathConfidence(path);
      const strengthWeight = averageStrengthWeight(path);
      const score = (confidenceProduct * strengthWeight) / path.length;
      candidates.push({
        targetNodeId,
        targetLabel: labelByNodeId.get(targetNodeId) ?? targetNodeId,
        hopCount: path.length,
        confidenceProduct,
        averageStrengthWeight: strengthWeight,
        score,
        fresh: true, // re-verified against pil_graph_edges.is_current below
        frictionEstimate: frictionEstimateForHops(path.length),
        recommendedIntroducer: labelByNodeId.get(targetNodeId) ?? targetNodeId,
        edgeIds: path.map((e) => e.id),
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const ranked = candidates.slice(0, TOP_PATHS_LIMIT);

    // Spec observation behavior: re-check path freshness against
    // pil_graph_edges.is_current immediately before finalizing -- a path
    // computed moments ago may include an edge superseded in the interim
    // (e.g. a lapsed board seat).
    const evidenceCreated: EvidenceItem[] = [];
    const stalePathTargetIds: string[] = [];
    for (const candidate of ranked) {
      const refetched = await Promise.all(candidate.edgeIds.map((id) => refetchEdge(id)));
      const stillCurrent = refetched.every((e) => e !== null && e.is_current);
      candidate.fresh = stillCurrent;
      if (!stillCurrent) stalePathTargetIds.push(candidate.targetNodeId);
    }
    const freshRanked = ranked.filter((c) => c.fresh);

    const delegations: DelegationRequest[] = [];

    if (freshRanked.length === 0) {
      evidenceCreated.push(
        await recordRelationshipEvidence({
          orgId: context.orgId,
          entityTable: "pil_prospects",
          entityId: prospect.id,
          claim: `No fresh, evidence-backed introduction path found from any tenant contact to ${prospect.display_name} within ${MAX_HOPS} hops`,
          value: { maxHopsSearched: MAX_HOPS, staleCandidatesFound: stalePathTargetIds.length },
          claimType: "warm_introduction_path",
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
      const top = freshRanked[0] as RankedPath;
      evidenceCreated.push(
        await recordRelationshipEvidence({
          orgId: context.orgId,
          entityTable: "pil_prospects",
          entityId: prospect.id,
          claim: `Top-ranked warm introduction path to ${prospect.display_name}: via ${top.recommendedIntroducer} in ${top.hopCount} hop(s), friction=${top.frictionEstimate}`,
          value: { topPath: top, alternativePaths: freshRanked.slice(1) },
          claimType: "warm_introduction_path",
          sourceUrl: null,
          sourceTitle: null,
          sourceType: "internal",
          publisher: null,
          evidenceExcerpt: null,
          agentCode: context.agentCode,
          researchRunId: context.runId,
          confidence: top.confidenceProduct,
          verificationStatus: "reasoned_inference",
        }),
      );

      // Spec delegation: strength scoring delegated to BEN-REL-06 for each
      // candidate path.
      for (const path of freshRanked) {
        delegations.push({
          childAgentCode: "BEN-REL-06",
          objective: `Score relationship strength for warm-introduction path edges [${path.edgeIds.join(", ")}] toward ${path.targetLabel}`,
          maxAutonomy: "A2",
          constraints: { prospectId: prospect.id, edgeIds: path.edgeIds },
        });
      }
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        prospectId: prospect.id,
        maxHopsSearched: MAX_HOPS,
        pathsFound: freshRanked.length,
        rankedPaths: freshRanked,
        staleCandidatesDropped: stalePathTargetIds.length,
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

export default WarmIntroductionPathfindingAgent;
