import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import {
  callTool,
  extractLeadName,
  getPrimaryProspectNode,
  getProspectById,
  hostnameOf,
  recordRelationshipEvidence,
  tryModelTokens,
} from "@/lib/pil/agents/rel/shared";
import { getPilClient } from "@/lib/pil/db";
import { upsertEdge, upsertNode } from "@/lib/pil/graph";
import type { EvidenceItem, GraphEdge } from "@/lib/pil/types";

// BEN-REL-08 -- Professional Connection Mapping Agent.
//
// Same task/registry collision BEN-REL-07.ts documents in full: Family 4 is
// a fixed 6-agent list in both PROSPECT_INTELLIGENCE_AGENTS.md and
// pil_agent_registry (migration 155), and this mission (the task's own
// step 5, numbered BEN-REL-05 there) never got built when REL-01..06 were
// reconciled against the live registry -- the registry's real BEN-REL-05 is
// Warm Introduction Pathfinding instead (see BEN-REL-05.ts's header). Built
// here as a task-directed addition beyond the spec's 6-agent count,
// registered as the fleet's 48th agent by the same registry-seed migration
// BEN-REL-07.ts's header describes (precedent: BEN-SUP-07/08, migration
// 163).
//
// Mission (from the task spec): for a prospect, find colleagues at the same
// companies, co-authors on publications, co-panelists at events, and
// co-board members.
//
// "Colleagues at the same companies" and "co-board members" are exactly
// BEN-REL-04 (Organizational Overlap Agent)'s mission -- a set-intersection
// over employed_by/serves_on_board_of/trustee_of edges, already implemented
// there as an org-wide sweep. Reimplementing that traversal here would be
// the same query run twice against the same edges; when this prospect has
// employment/board edges on file, this agent delegates that half of the
// mission to BEN-REL-04 instead of duplicating it (this codebase's
// established delegate-don't-duplicate pattern -- see BEN-REL-01.ts/
// BEN-REL-02.ts's own delegations to sibling REL agents).
//
// "Co-authors on publications" and "co-panelists at events" have no graph-
// native source (GraphNodeType has no publication/event node type) -- these
// are the genuinely novel half of this mission, sourced via open-web search
// the same way BEN-REL-01 discovers one-hop relationship candidates:
// extractLeadName() pulls a capitalized-name candidate from the top search
// result's title, a new person node is created if needed, and a 'related_to'
// edge (properties.relationshipType='professional_connection') records the
// tie -- unverified, low confidence, same as every other web-search-sourced
// candidate this family produces.
//
// Permitted tools: T-GRAPH (read/write), T-WEB, T-EVIDENCE (write).

export class ProfessionalConnectionMappingAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-REL-08 requires an existing prospectId");
    }
    const prospect = await getProspectById(context.orgId, context.prospectId);
    if (!prospect) {
      return this.completedEmpty(`Prospect ${context.prospectId} not found`);
    }

    const primaryNode = await getPrimaryProspectNode(context.orgId, prospect.id);
    if (!primaryNode) {
      return this.completedEmpty(`No graph node on file yet for prospect ${prospect.id} -- nothing to search from`);
    }

    const evidenceCreated: EvidenceItem[] = [];
    const newEdgeIds: string[] = [];
    const delegations: DelegationRequest[] = [];

    // Delegate the graph-derivable half (colleagues/co-board-members) to
    // BEN-REL-04 whenever this prospect has an employment/board edge on
    // file for it to intersect against.
    const client = getPilClient();
    const { data: affiliationEdgeRows, error: affiliationError } = await client
      .from("pil_graph_edges")
      .select("*")
      .eq("organization_id", context.orgId)
      .eq("is_current", true)
      .eq("source_node_id", primaryNode.id)
      .in("edge_type", ["employed_by", "serves_on_board_of", "trustee_of"]);
    if (affiliationError) throw affiliationError;
    const affiliationEdges = (affiliationEdgeRows ?? []) as GraphEdge[];

    if (affiliationEdges.length > 0) {
      delegations.push({
        childAgentCode: "BEN-REL-04",
        objective: `Identify colleagues and co-board-members for prospect ${prospect.id} via shared employment/board affiliations`,
        maxAutonomy: "A2",
        constraints: { prospectId: prospect.id },
      });
    }

    // Novel half: co-authors and co-panelists, sourced via web search since
    // no graph-native source exists for either relationship type.
    const searches: Array<{ subType: string; query: string }> = [
      { subType: "co_author", query: `"${prospect.display_name}" co-author OR "co-authored" publication OR paper OR report` },
      { subType: "co_panelist", query: `"${prospect.display_name}" panel OR panelist OR conference OR summit speaker` },
    ];

    for (const search of searches) {
      const searchResult = await callTool(context, runner, "web_search", { query: search.query, limit: 3 });
      if (!searchResult.success) continue;
      const results = (searchResult.data as { results?: Array<{ title: string; url: string }> } | null)?.results ?? [];
      const top = results[0];
      if (!top) continue;

      const candidateName = extractLeadName(top.title);
      if (!candidateName || candidateName === prospect.display_name) continue;

      const candidateNode = await upsertNode({
        organization_id: context.orgId,
        node_type: "person",
        prospect_id: null,
        label: candidateName,
        properties: { discoveredVia: search.subType },
      });

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
        properties: { relationshipType: "professional_connection", subType: search.subType, sourceTitle: top.title },
      });
      newEdgeIds.push(edge.id);

      evidenceCreated.push(
        await recordRelationshipEvidence({
          orgId: context.orgId,
          entityTable: "pil_graph_edges",
          entityId: edge.id,
          claim: `Possible ${search.subType.replace("_", "-")} connection for ${prospect.display_name}: ${candidateName} (${top.title})`,
          value: { candidateName, title: top.title, url: top.url, subType: search.subType },
          claimType: "professional_connection",
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

    const tokensUsed = await tryModelTokens(context, runner, 400);

    return {
      status: "completed",
      evidence: evidenceCreated,
      conclusions: {
        prospectId: prospect.id,
        newEdgeIds,
        delegatedColleagueMapping: affiliationEdges.length > 0,
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

export default ProfessionalConnectionMappingAgent;
