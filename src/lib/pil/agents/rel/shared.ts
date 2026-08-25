import { getPilClient } from "@/lib/pil/db";
import { recordEvidence } from "@/lib/pil/evidence";
import { getNodesByProspect } from "@/lib/pil/graph";
import { getTool } from "@/lib/pil/tools";
import type { ToolResult } from "@/lib/pil/tools";
import type { AgentContext, AgentRunner } from "@/lib/pil/agent-runner";
import type {
  EvidenceEntityTable,
  EvidenceItem,
  EvidenceVerificationStatus,
  GraphEdge,
  GraphNode,
  Prospect,
} from "@/lib/pil/types";

// Shared plumbing for the Relationship & Graph Intelligence family
// (BEN-REL-01..06, PROSPECT_INTELLIGENCE_AGENTS.md "FAMILY 4 -- RELATIONSHIP
// & GRAPH INTELLIGENCE"). This family's agents traverse the graph
// (pil_graph_nodes/pil_graph_edges) rather than issuing bare open-web
// searches, so its shared helpers center on path reconstruction and
// tenant-contact lookups instead of Discovery/Intelligence's
// goal-parsing/dossier helpers.

export const MODEL_TOKEN_UNIT_COST_USD = 0.00002;

export async function getProspectById(orgId: string, prospectId: string): Promise<Prospect | null> {
  const { data, error } = await getPilClient()
    .from("pil_prospects")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", prospectId)
    .maybeSingle();
  if (error) throw error;
  return (data as Prospect | null) ?? null;
}

/** The graph node anchoring a prospect's identity -- prefers a 'person' node, falling back to whatever node exists first (a foundation/company prospect has no 'person' node). */
export async function getPrimaryProspectNode(orgId: string, prospectId: string): Promise<GraphNode | null> {
  const nodes = await getNodesByProspect(prospectId, orgId);
  if (nodes.length === 0) return null;
  return nodes.find((n) => n.node_type === "person") ?? nodes[0] ?? null;
}

export interface RecordRelationshipEvidenceParams {
  orgId: string;
  entityTable: EvidenceEntityTable;
  entityId: string;
  claim: string;
  value: unknown;
  claimType: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceType: string;
  publisher: string | null;
  evidenceExcerpt: string | null;
  agentCode: string;
  researchRunId: string | null;
  confidence: number;
  verificationStatus: EvidenceVerificationStatus;
}

/** Unlike Discovery/Intelligence's evidence helpers (always entity_table='pil_prospects'), this family attaches evidence to whichever entity a claim is actually about -- a discovered edge's own provenance, not just the prospect it touches (pil_evidence is generically keyed by (entity_table, entity_id), see evidence.ts). */
export async function recordRelationshipEvidence(params: RecordRelationshipEvidenceParams): Promise<EvidenceItem> {
  const now = new Date().toISOString();
  return recordEvidence({
    organization_id: params.orgId,
    entity_id: params.entityId,
    entity_table: params.entityTable,
    claim: params.claim,
    value: params.value,
    claim_type: params.claimType,
    source_url: params.sourceUrl,
    source_title: params.sourceTitle,
    source_type: params.sourceType,
    publisher: params.publisher,
    retrieved_at: now,
    published_at: null,
    last_verified_at: now,
    evidence_excerpt: params.evidenceExcerpt,
    agent_id: params.agentCode,
    research_run_id: params.researchRunId,
    confidence: params.confidence,
    verification_status: params.verificationStatus,
    freshness_status: "fresh",
    inference_status: "direct",
    contradiction_status: "none",
    lineage: [],
    created_at: now,
  });
}

export async function callTool(
  context: AgentContext,
  runner: AgentRunner,
  toolName: string,
  params: Record<string, unknown>,
  costType: "api_call" | "licensed_data" = "api_call",
): Promise<ToolResult> {
  const result = await getTool(toolName).execute(params, context);
  if (result.success) {
    try {
      await runner.useTool(context, toolName, { unitCost: result.cost_usd, units: 1, costType });
    } catch {
      // Cost-ledger recording is best-effort -- a ledger write failure must
      // not discard search results the tool already returned.
    }
  }
  return result;
}

export async function tryModelTokens(context: AgentContext, runner: AgentRunner, units: number): Promise<number> {
  if (!context.tools.includes("T-MODEL")) return 0;
  try {
    await runner.useTool(context, "T-MODEL", { unitCost: MODEL_TOKEN_UNIT_COST_USD, units, costType: "model_tokens" });
    return units;
  } catch {
    return 0;
  }
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Best-effort capitalized-name extractor for search-result titles (no snippet field is available -- see tools/web-search.ts). One candidate per call is deliberate: this family attaches a discovered name to a specific already-known organization node, not a bulk scrape. */
export function extractLeadName(text: string): string | null {
  const stopWords = new Set(["The", "This", "That", "Board", "Foundation", "Community", "United", "National", "American"]);
  for (const match of text.matchAll(/\b(?:[A-Z][a-z]+ ){1,2}[A-Z][a-z]+\b/g)) {
    const candidate = match[0].trim();
    const firstWord = candidate.split(" ")[0];
    if (firstWord && stopWords.has(firstWord)) continue;
    return candidate;
  }
  return null;
}

/**
 * Reconstructs shortest (fewest-hop) paths from `startNodeId` to every node
 * reached in `edges`, using the fact that traverseGraph() (graph.ts) expands
 * strictly hop-by-hop and pushes each hop's edges in order -- the first edge
 * to reach a given target is therefore that node's shortest-hop parent, the
 * same guarantee a formal BFS parent-pointer pass would give. Returns a map
 * of nodeId -> ordered edge path from startNodeId to that node.
 */
export function reconstructShortestPaths(startNodeId: string, edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const parentEdge = new Map<string, GraphEdge>();
  for (const edge of edges) {
    if (edge.target_node_id === startNodeId) continue;
    if (!parentEdge.has(edge.target_node_id)) {
      parentEdge.set(edge.target_node_id, edge);
    }
  }

  const paths = new Map<string, GraphEdge[]>();
  for (const nodeId of parentEdge.keys()) {
    const path: GraphEdge[] = [];
    let cursor = nodeId;
    const guard = new Set<string>();
    while (cursor !== startNodeId) {
      if (guard.has(cursor)) break; // defensive: never loop on malformed data
      guard.add(cursor);
      const edge = parentEdge.get(cursor);
      if (!edge) break;
      path.unshift(edge);
      cursor = edge.source_node_id;
    }
    if (path.length > 0 && path[0]?.source_node_id === startNodeId) {
      paths.set(nodeId, path);
    }
  }
  return paths;
}

/** Product of each edge's confidence along a path (per spec: "edge confidence product, not just hop count" when ranking candidate paths). A null confidence is treated as neutral (1), never as zero. */
export function pathConfidence(path: GraphEdge[]): number {
  return path.reduce((product, edge) => product * (edge.confidence ?? 1), 1);
}

/** Every prospect on file that originated from the tenant's own CRM import (pil_prospects.source_of_record='crm_import', same convention BEN-DIS-08 established) -- this family's stand-in for "the tenant's own contact roster" since no dedicated CRM-roster table exists in the PIL schema. */
export async function getTenantContactProspectIds(orgId: string): Promise<string[]> {
  const { data, error } = await getPilClient()
    .from("pil_prospects")
    .select("id")
    .eq("organization_id", orgId)
    .eq("source_of_record", "crm_import");
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

export async function getNodesForProspectIds(orgId: string, prospectIds: string[]): Promise<GraphNode[]> {
  if (prospectIds.length === 0) return [];
  const { data, error } = await getPilClient()
    .from("pil_graph_nodes")
    .select("*")
    .eq("organization_id", orgId)
    .in("prospect_id", prospectIds);
  if (error) throw error;
  return (data ?? []) as GraphNode[];
}

/** Re-fetches a single edge by id, used to re-confirm is_current immediately before a path is finalized for use (spec BEN-REL-05 observation behavior: "a path through a now-lapsed board seat is not usable"). */
export async function refetchEdge(edgeId: string): Promise<GraphEdge | null> {
  const { data, error } = await getPilClient().from("pil_graph_edges").select("*").eq("id", edgeId).maybeSingle();
  if (error) throw error;
  return (data as GraphEdge | null) ?? null;
}

const FRICTION_BY_HOPS: Record<number, string> = { 1: "low", 2: "low_moderate", 3: "moderate" };

/** Coarse friction estimate from hop count alone (spec requires a friction estimate in BEN-REL-05's output shape but does not specify a formula) -- more hops between the org and the prospect means more people who have to agree to make an introduction. */
export function frictionEstimateForHops(hopCount: number): string {
  return FRICTION_BY_HOPS[hopCount] ?? "high";
}
