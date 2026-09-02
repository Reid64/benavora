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
//
// Richer-spec upgrade (PIL_AGENT_COMPLETE_ROSTER.md "Relationship (6
// agents)" / PIL_AGENT_DEPENDENCIES.yaml's BEN-REL-05 entry -- both Phase-1
// paper specs, design input only): this agent is the only REL agent that
// names all 5 other REL siblings as dependencies. Two condition-gated
// delegation batches were added on top of the existing BEN-REL-06
// per-fresh-path strength-scoring loop:
//   - No fresh path found (freshRanked.length === 0): fan out one delegation
//     each to BEN-REL-01/02/03/04 asking for a broader/board/corporate/
//     org-overlap discovery pass, since this agent's own traversal found
//     nothing usable.
//   - Fresh paths found but some went stale on the pre-finalization refetch
//     (stalePathTargetIds.length > 0): one delegation to BEN-KNW-03 asking
//     it to re-verify/refresh those edges rather than let them silently
//     drop out of rotation.
// Per PIL_AGENT_DEPENDENCIES.yaml's own methodology note, BEN-REL-05 <->
// BEN-REL-02/03/04 forms a documented, expected delegation CYCLE under
// this spec's "authority to call" semantics (not a strict data-flow DAG) --
// REL-02/03/04 each delegate back to BEN-REL-05 on their own no-path-found
// conditions. This is not resolved with extra cycle-breaking logic here;
// AgentRunner's existing depth-bounded delegation (agent-runner.ts,
// context.depth decrementing each hop, delegation only firing while
// context.depth > 0) is what terminates it at runtime.
//
// All five new delegations are constrained to prospect.id, which is only
// reachable past this file's own early-return guard on !context.prospectId
// -- so a delegating parent run with a null prospectId (e.g. an org-wide
// batch sweep) never reaches this code path in the first place and never
// hands a prospectId-scoped sibling a dead-on-arrival null prospectId.
//
// conclusions.decision maps this file's existing computed values onto the
// roster's 6 named output dimensions (Source Node Authorization, Target
// Identity, Edge Validity, Path Length, Edge Strength, Introduction
// Feasibility) -- see the `decision` object built at the end of execute().

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

    // Richer-spec delegation: no fresh, usable path exists to any tenant
    // contact even after the freshness re-check -- fan out to all four
    // sibling discovery specialists rather than reporting a dead end.
    // prospect.id is always populated here (see the !context.prospectId
    // early-return above), so none of these constraints objects can end up
    // null/empty.
    if (freshRanked.length === 0) {
      delegations.push(
        {
          childAgentCode: "BEN-REL-01",
          objective: `No introduction path currently exists to ${prospect.display_name} -- requesting a broader one-hop-outward relationship discovery pass around this prospect.`,
          maxAutonomy: "A2",
          constraints: { prospectId: prospect.id },
        },
        {
          childAgentCode: "BEN-REL-02",
          objective: `No introduction path currently exists to ${prospect.display_name} -- requesting a dedicated board/trustee-network pass to surface any board-based route.`,
          maxAutonomy: "A2",
          constraints: { prospectId: prospect.id },
        },
        {
          childAgentCode: "BEN-REL-03",
          objective: `No introduction path currently exists to ${prospect.display_name} -- requesting a dedicated corporate-network pass to surface any employer-based route.`,
          maxAutonomy: "A2",
          constraints: { prospectId: prospect.id },
        },
        {
          childAgentCode: "BEN-REL-04",
          objective: `No introduction path currently exists to ${prospect.display_name} -- requesting an organizational-overlap pass to surface any shared-membership route.`,
          maxAutonomy: "A2",
          constraints: { prospectId: prospect.id },
        },
      );
    }

    // Richer-spec delegation: at least one candidate path's edges were
    // still current when ranked but went stale on the pre-finalization
    // refetch -- ask BEN-KNW-03 to re-verify/refresh them rather than let
    // them silently drop out of rotation on the next run.
    if (freshRanked.length > 0 && stalePathTargetIds.length > 0) {
      delegations.push({
        childAgentCode: "BEN-KNW-03",
        objective: `${stalePathTargetIds.length} candidate introduction path(s) to ${prospect.display_name} went stale between computation and finalization -- re-verify/refresh their underlying edges.`,
        maxAutonomy: "A2",
        constraints: { prospectId: prospect.id, staleTargetNodeIds: stalePathTargetIds },
      });
    }

    const tokensUsed = await tryModelTokens(context, runner, 500);

    const top = freshRanked[0] as RankedPath | undefined;
    const decision = {
      sourceNodeAuthorization: "tenant_crm_import_contact",
      targetIdentity: prospect.display_name,
      edgeValidity: {
        reverifiedCurrentCount: freshRanked.length,
        staleDroppedCount: stalePathTargetIds.length,
      },
      pathLength: top?.hopCount ?? null,
      edgeStrength: top?.averageStrengthWeight ?? null,
      introductionFeasibility: top?.frictionEstimate ?? "no_path_found",
    };

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        prospectId: prospect.id,
        maxHopsSearched: MAX_HOPS,
        pathsFound: freshRanked.length,
        rankedPaths: freshRanked,
        staleCandidatesDropped: stalePathTargetIds.length,
        decision,
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
