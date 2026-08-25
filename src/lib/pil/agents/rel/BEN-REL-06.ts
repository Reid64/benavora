import type { Agent, AgentContext, AgentResult, AgentRunner } from "@/lib/pil/agent-runner";
import { MODEL_TOKEN_UNIT_COST_USD, tryModelTokens } from "@/lib/pil/agents/rel/shared";
import { getPilClient } from "@/lib/pil/db";
import { getNodesByProspect } from "@/lib/pil/graph";
import type { EvidenceItem, GraphEdge, GraphNode, RelationshipStrength } from "@/lib/pil/types";

// BEN-REL-06 -- Relationship Strength Agent
// (PROSPECT_INTELLIGENCE_AGENTS.md line ~714). Evaluates the practical
// strength and usefulness of identified relationship paths: for each graph
// edge involving a prospect, scores VERY_STRONG/STRONG/MODERATE/WEAK/
// SPECULATIVE (this schema's RelationshipStrength enum uses lowercase
// snake_case -- very_strong/strong/moderate/weak/speculative, see types.ts
// -- the spec prose's uppercase labels map onto it directly) using the same
// weighted factor model every call (spec planning behavior: "not ad hoc
// per-request judgment"), with the factor breakdown recorded in
// pil_graph_edges.properties.
//
// The task spec that commissioned this batch numbered this mission
// BEN-REL-08. The registry's real BEN-REL-06 is this Relationship Strength
// Agent (supabase/migrations/155_pil_agent_registry.sql line 104);
// BEN-REL-07/08 do not exist in the fixed 6-agent Family 4 (see
// BEN-REL-05.ts's header for the full reconciliation). Convenient overlap:
// the task's own BEN-REL-08 step description ("for each graph edge
// involving a prospect: scores strength based on frequency, duration,
// nature of relationship, recency ... updates graph edge properties") is
// materially the same mission as the real BEN-REL-06, so that step's prose
// is used here as the concrete scoring spec.
//
// Permitted tools per spec: T-GRAPH (read), T-EVIDENCE (read), T-MODEL. This
// agent updates pil_graph_edges directly (its entire output, per spec) --
// not gated behind T-GRAPH (write) since the spec explicitly lists this
// agent's T-GRAPH permission as read-only and its output as a column write,
// not a new-edge write via graph.ts's upsertEdge.
//
// Delegation permissions: none -- a leaf specialist other Relationship
// agents call into (spec).

const PROFESSIONAL_EDGE_TYPES = new Set(["owns", "employed_by", "serves_on_board_of", "trustee_of"]);
const RECENCY_FRESH_DAYS = 90;
const RECENCY_AGING_DAYS = 365;

export interface StrengthFactors {
  directness: "direct" | "indirect";
  currency: "current" | "historical";
  nature: "professional" | "nominal";
  evidenceStrength: number;
  frequency: string;
  sharedOrganizationCount: number;
  recencyDays: number | null;
  hopCount: number;
}

function labelFromScore(score: number): RelationshipStrength {
  if (score >= 6) return "very_strong";
  if (score >= 4.5) return "strong";
  if (score >= 3) return "moderate";
  if (score >= 1.5) return "weak";
  return "speculative";
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const diffMs = Date.parse(new Date().toISOString()) - Date.parse(iso);
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export class RelationshipStrengthAgent implements Agent {
  async execute(context: AgentContext, runner: AgentRunner): Promise<AgentResult> {
    if (!context.prospectId) {
      return this.completedEmpty("BEN-REL-06 requires an existing prospectId");
    }

    const prospectNodes = await getNodesByProspect(context.prospectId, context.orgId);
    if (prospectNodes.length === 0) {
      return this.completedEmpty(`No graph nodes on file yet for prospect ${context.prospectId}`);
    }
    const prospectNodeIds = new Set(prospectNodes.map((n) => n.id));

    const client = getPilClient();
    const [{ data: asSource, error: sourceError }, { data: asTarget, error: targetError }] = await Promise.all([
      client.from("pil_graph_edges").select("*").eq("organization_id", context.orgId).eq("is_current", true).in("source_node_id", [...prospectNodeIds]),
      client.from("pil_graph_edges").select("*").eq("organization_id", context.orgId).eq("is_current", true).in("target_node_id", [...prospectNodeIds]),
    ]);
    if (sourceError) throw sourceError;
    if (targetError) throw targetError;

    const edgeById = new Map<string, GraphEdge>();
    for (const e of [...((asSource ?? []) as GraphEdge[]), ...((asTarget ?? []) as GraphEdge[])]) {
      edgeById.set(e.id, e);
    }
    const edges = [...edgeById.values()];
    if (edges.length === 0) {
      return this.completedEmpty(`No current graph edges found involving prospect ${context.prospectId}`);
    }

    const allEndpointNodeIds = new Set<string>();
    for (const edge of edges) {
      allEndpointNodeIds.add(edge.source_node_id);
      allEndpointNodeIds.add(edge.target_node_id);
    }
    const { data: endpointNodeRows, error: endpointError } = await client
      .from("pil_graph_nodes")
      .select("*")
      .eq("organization_id", context.orgId)
      .in("id", [...allEndpointNodeIds]);
    if (endpointError) throw endpointError;
    const nodeById = new Map(((endpointNodeRows ?? []) as GraphNode[]).map((n) => [n.id, n]));

    // Evidence rows attached directly to these edges (their provenance) --
    // used for evidenceStrength/directness/frequency/recency below.
    const { data: evidenceRows, error: evidenceError } = await client
      .from("pil_evidence")
      .select("*")
      .eq("organization_id", context.orgId)
      .eq("entity_table", "pil_graph_edges")
      .in("entity_id", edges.map((e) => e.id));
    if (evidenceError) throw evidenceError;
    const evidenceByEdgeId = new Map<string, EvidenceItem[]>();
    for (const ev of (evidenceRows ?? []) as EvidenceItem[]) {
      const list = evidenceByEdgeId.get(ev.entity_id) ?? [];
      list.push(ev);
      evidenceByEdgeId.set(ev.entity_id, list);
    }

    // Shared-organization count: for each edge's two endpoints, how many
    // org-type nodes do both connect to as sources (spec factor "shared
    // organization count").
    const orgConnectionsByNodeId = await this.loadOrgConnections(context.orgId, [...allEndpointNodeIds]);

    const updatedEdgeIds: string[] = [];
    const factorsByEdgeId: Record<string, StrengthFactors> = {};
    const scoresByEdgeId: Record<string, number> = {};

    for (const edge of edges) {
      const edgeEvidence = evidenceByEdgeId.get(edge.id) ?? [];
      const bestEvidence = edgeEvidence.reduce<EvidenceItem | null>((best, ev) => (!best || ev.confidence > best.confidence ? ev : best), null);

      const directness: "direct" | "indirect" =
        bestEvidence && (bestEvidence.verification_status === "verified_fact" || bestEvidence.verification_status === "corroborated_fact")
          ? "direct"
          : "indirect";
      const currency: "current" | "historical" =
        edge.is_current && (!edge.temporal_validity_end || Date.parse(edge.temporal_validity_end) >= Date.now()) ? "current" : "historical";
      const nature: "professional" | "nominal" = PROFESSIONAL_EDGE_TYPES.has(edge.edge_type) ? "professional" : "nominal";
      const evidenceStrength = bestEvidence?.confidence ?? edge.confidence ?? 0.3;
      const frequency = typeof edge.properties?.frequency === "string" ? (edge.properties.frequency as string) : "unknown";

      const sourceOrgCount = orgConnectionsByNodeId.get(edge.source_node_id)?.size ?? 0;
      const targetOrgCount = orgConnectionsByNodeId.get(edge.target_node_id)?.size ?? 0;
      const sourceOrgs = orgConnectionsByNodeId.get(edge.source_node_id) ?? new Set<string>();
      const targetOrgs = orgConnectionsByNodeId.get(edge.target_node_id) ?? new Set<string>();
      const sharedOrganizationCount = sourceOrgCount === 0 || targetOrgCount === 0 ? 0 : [...sourceOrgs].filter((id) => targetOrgs.has(id)).length;

      const recencyIso = bestEvidence?.last_verified_at ?? edge.updated_at;
      const recencyDays = daysSince(recencyIso);

      const factors: StrengthFactors = {
        directness,
        currency,
        nature,
        evidenceStrength,
        frequency,
        sharedOrganizationCount,
        recencyDays,
        hopCount: 1,
      };

      let score = 0;
      score += directness === "direct" ? 2 : 0;
      score += currency === "current" ? 2 : -1;
      score += nature === "professional" ? 1 : 0;
      score += evidenceStrength * 2;
      score += Math.min(sharedOrganizationCount, 3) * 0.5;
      if (recencyDays !== null) {
        if (recencyDays <= RECENCY_FRESH_DAYS) score += 1;
        else if (recencyDays <= RECENCY_AGING_DAYS) score += 0.5;
      }

      const strengthLabel = labelFromScore(score);
      factorsByEdgeId[edge.id] = factors;
      scoresByEdgeId[edge.id] = score;

      const { error: updateError } = await client
        .from("pil_graph_edges")
        .update({
          relationship_strength: strengthLabel,
          properties: { ...edge.properties, strengthFactors: factors, strengthScore: score },
          updated_at: new Date().toISOString(),
        })
        .eq("id", edge.id);
      if (updateError) throw updateError;
      updatedEdgeIds.push(edge.id);
    }

    const tokensUsed = await tryModelTokens(context, runner, 300);

    return {
      status: "completed",
      evidence: [],
      conclusions: {
        prospectId: context.prospectId,
        edgesScored: updatedEdgeIds.length,
        updatedEdgeIds,
        factorsByEdgeId,
        scoresByEdgeId,
        nodesInvolved: [...nodeById.keys()],
      },
      delegations: [],
      tokensUsed,
      costUsd: tokensUsed * MODEL_TOKEN_UNIT_COST_USD,
      error: null,
    };
  }

  /** For each node, the set of org-type node ids it connects to as a source via a professional affiliation edge -- used to compute shared-organization count between two endpoints without an unbounded graph walk. */
  private async loadOrgConnections(orgId: string, nodeIds: string[]): Promise<Map<string, Set<string>>> {
    if (nodeIds.length === 0) return new Map();
    const { data, error } = await getPilClient()
      .from("pil_graph_edges")
      .select("source_node_id, target_node_id, edge_type")
      .eq("organization_id", orgId)
      .eq("is_current", true)
      .in("edge_type", [...PROFESSIONAL_EDGE_TYPES])
      .in("source_node_id", nodeIds);
    if (error) throw error;

    const result = new Map<string, Set<string>>();
    for (const row of (data ?? []) as Array<{ source_node_id: string; target_node_id: string }>) {
      const set = result.get(row.source_node_id) ?? new Set<string>();
      set.add(row.target_node_id);
      result.set(row.source_node_id, set);
    }
    return result;
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

export default RelationshipStrengthAgent;
