import type { Agent, AgentContext, AgentResult, AgentRunner, DelegationRequest } from "@/lib/pil/agent-runner";
import { tryModelTokens } from "@/lib/pil/agents/rel/shared";
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
// Delegation permissions per spec: originally "none -- a leaf specialist
// other Relationship agents call into." Upgrade
// (PIL_AGENT_COMPLETE_ROSTER.md/PIL_AGENT_DEPENDENCIES.yaml, paper specs
// with no implementation evidence -- design input only) adds three
// conditional delegations, each gated on a concrete per-edge signal
// computed inside the existing scoring loop rather than firing
// unconditionally: BEN-KNW-03 (provenance verification) when an edge's
// evidence contains a contradicted claim or meaningfully divergent (3+
// distinct) verification statuses on the same edge, BEN-REL-01
// (relationship discovery) when an edge scores speculative on thin,
// indirect evidence (evidenceStrength < 0.35) -- a low-confidence dead end
// worth searching further for rather than leaving as final -- and
// BEN-QLF-04 (opportunity qualification; the roster flags this as the only
// confirmed cross-family delegation target in the Relationship family's 6
// specs, a mutual pair since BEN-QLF-04.ts's own NEXT_AGENTS_BY_DIMENSION
// already lists this agent among BEN-QLF-04's recommended next agents) when
// an edge's relationship_strength tier jumps 2+ ranks in either direction,
// since BEN-QLF-04's scoreRelationshipStrength() takes the max
// relationship_strength among a prospect's edges and may now compute
// differently.
//
// conclusions.decisionDimensions also now carries the roster's six named
// output dimensions per edge (recency/frequency/duration/directInteraction/
// mutuality/contextRelevance), reusing this agent's already-computed
// StrengthFactors -- duration and mutuality are documented as real current
// schema/agent limitations (no interval tracking, no reciprocal-confirmation
// column) rather than fabricated values.

const PROFESSIONAL_EDGE_TYPES = new Set(["owns", "employed_by", "serves_on_board_of", "trustee_of"]);
const RECENCY_FRESH_DAYS = 90;
const RECENCY_AGING_DAYS = 365;

// Ordinal rank of this schema's RelationshipStrength enum, used only to
// detect a material (2+ tier) jump for the BEN-QLF-04 delegation trigger --
// not a scoring input.
const STRENGTH_TIER_RANK: Record<RelationshipStrength, number> = {
  speculative: 0,
  weak: 1,
  moderate: 2,
  strong: 3,
  very_strong: 4,
};

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
    // Delegation-trigger accumulators (see header comment for the concrete
    // condition each one is gated on).
    const contestedEdgeIds: string[] = [];
    const weakEdgeIds: string[] = [];
    const materiallyChangedEdgeIds: string[] = [];

    for (const edge of edges) {
      const edgeEvidence = evidenceByEdgeId.get(edge.id) ?? [];
      const bestEvidence = edgeEvidence.reduce<EvidenceItem | null>((best, ev) => (!best || ev.confidence > best.confidence ? ev : best), null);

      // BEN-KNW-03 trigger (contested evidence): an outright contradiction,
      // or 3+ meaningfully divergent verification statuses on the same
      // edge, means this edge's strength score should not yet be treated as
      // final.
      const distinctVerificationStatuses = new Set(edgeEvidence.map((ev) => ev.verification_status));
      if (edgeEvidence.some((ev) => ev.verification_status === "contradicted") || (edgeEvidence.length > 1 && distinctVerificationStatuses.size >= 3)) {
        contestedEdgeIds.push(edge.id);
      }

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

      // BEN-REL-01 trigger (under-evidenced): a speculative label on
      // indirect, thin evidence is a low-confidence dead end -- worth
      // searching for corroborating evidence rather than leaving as final.
      if (strengthLabel === "speculative" && directness === "indirect" && evidenceStrength < 0.35) {
        weakEdgeIds.push(edge.id);
      }

      // BEN-QLF-04 trigger (material tier change): read edge.relationship_strength
      // BEFORE this update() call overwrites it -- `edge` is the row as read
      // at the top of execute(), never locally mutated, so this is still the
      // pre-update value.
      const oldRank = edge.relationship_strength ? STRENGTH_TIER_RANK[edge.relationship_strength] : 0;
      const newRank = STRENGTH_TIER_RANK[strengthLabel];
      if (Math.abs(newRank - oldRank) >= 2) {
        materiallyChangedEdgeIds.push(edge.id);
      }

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

    const delegations: DelegationRequest[] = [];

    if (contestedEdgeIds.length > 0) {
      delegations.push({
        childAgentCode: "BEN-KNW-03",
        objective: `${contestedEdgeIds.length} edge(s) scored by BEN-REL-06 for prospect ${context.prospectId} have contradicted or meaningfully divergent evidence -- resolve which claim is canonical before their strength score is treated as final.`,
        maxAutonomy: "A2",
        constraints: { edgeIds: contestedEdgeIds },
      });
    }

    if (weakEdgeIds.length > 0) {
      delegations.push({
        childAgentCode: "BEN-REL-01",
        objective: `${weakEdgeIds.length} edge(s) for prospect ${context.prospectId} scored speculative on thin, indirect evidence -- search for corroborating relationship evidence rather than leaving the score as a low-confidence dead end.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId, weakEdgeIds },
      });
    }

    // context.prospectId is already guaranteed truthy by the early-return
    // guard at the top of execute(); the check is kept here as defensive
    // documentation of the real constraint other REL-0N delegations to
    // prospectId-scoped agents must observe (AgentRunner.delegate() carries
    // a delegating parent's context.prospectId unchanged to the child, so a
    // null prospectId here would make BEN-QLF-04 a dead-on-arrival no-op).
    if (materiallyChangedEdgeIds.length > 0 && context.prospectId) {
      delegations.push({
        childAgentCode: "BEN-QLF-04",
        objective: `${materiallyChangedEdgeIds.length} edge(s) for prospect ${context.prospectId} just crossed a material relationship-strength tier boundary -- re-run qualification since its relationshipStrength dimension may now compute differently.`,
        maxAutonomy: "A2",
        constraints: { prospectId: context.prospectId, materiallyChangedEdgeIds },
      });
    }

    const decisionDimensions: Record<string, unknown> = {};
    for (const [edgeId, factors] of Object.entries(factorsByEdgeId)) {
      decisionDimensions[edgeId] = {
        recency: factors.recencyDays,
        frequency: factors.frequency,
        // This schema's temporal_validity_start/end columns exist on
        // pil_graph_edges but this agent does not currently read/write
        // them -- documented limitation, not a fabricated value.
        duration: "unmodeled_no_start_end_interval_tracked_on_this_edge_type",
        directInteraction: factors.directness,
        // pil_graph_edges has no reciprocal/mutual-confirmation column --
        // edges are directional, not bidirectionally confirmed.
        mutuality: "unmodeled_edges_are_directional_not_bidirectionally_confirmed",
        contextRelevance: `${factors.nature}_shared_orgs_${factors.sharedOrganizationCount}`,
      };
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
        decisionDimensions,
      },
      delegations,
      tokensUsed,
      costUsd: 0, // AR-10.1: real cost already recorded per-call in ai_usage_log by useTool()/T-MODEL via model-pricing.ts (called inside tryModelTokens); recording it again here would double-count the same tokens.
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
