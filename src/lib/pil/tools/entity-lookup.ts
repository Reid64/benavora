import { createAdminClient } from "@/lib/supabase/admin";
import type { AgentContext } from "@/lib/pil/agent-runner";
import { getPilClient } from "@/lib/pil/db";
import type { Tool, ToolResult } from "@/lib/pil/tools";

// T-GRAPH/T-CRM-adjacent internal lookup, not a real external API call --
// $0.0001/lookup per the task spec reflects that this only ever touches
// this platform's own tables (foundation_directory, pil_prospects,
// pil_graph_nodes), never a paid third party. Ranks matches by a local
// bigram Dice-coefficient string similarity (no new dependency) since none
// of these three tables share a common fuzzy-search index today.
//
// A DB-level ILIKE prefilter (on the first normalized name token) keeps this
// safe against foundation_directory's 133,812-row scale -- fuzzy ranking
// only runs over the prefiltered candidate set, never the full table.

const TOOL_NAME = "entity_lookup";
const COST_PER_LOOKUP_USD = 0.0001;
const CANDIDATE_LIMIT = 50;
const RESULT_LIMIT = 10;

export interface EntityMatch {
  source: "foundation_directory" | "pil_prospects" | "pil_graph_nodes";
  id: string;
  name: string;
  entity_type: string | null;
  location: string | null;
  confidence: number;
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(value: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < value.length - 1; i++) {
    set.add(value.slice(i, i + 2));
  }
  return set;
}

/** Sorensen-Dice coefficient over character bigrams. 1.0 = identical, 0 = no overlap. */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return na === nb ? 1 : 0;
  let overlap = 0;
  for (const gram of ba) {
    if (bb.has(gram)) overlap++;
  }
  return (2 * overlap) / (ba.size + bb.size);
}

interface FoundationCandidate {
  id: string;
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
}

async function searchFoundationDirectory(nameToken: string, location?: string): Promise<FoundationCandidate[]> {
  let query = createAdminClient()
    .from("foundation_directory")
    .select("id, ein, name, city, state")
    .ilike("name", `%${nameToken}%`)
    .limit(CANDIDATE_LIMIT);
  if (location) {
    query = query.eq("state", location);
  }
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as FoundationCandidate[];
}

async function searchProspects(orgId: string, nameToken: string, entityType?: string): Promise<Array<{ id: string; display_name: string; entity_type: string }>> {
  let query = getPilClient()
    .from("pil_prospects")
    .select("id, display_name, entity_type")
    .eq("organization_id", orgId)
    .ilike("canonical_name", `%${nameToken}%`)
    .limit(CANDIDATE_LIMIT);
  if (entityType) {
    query = query.eq("entity_type", entityType);
  }
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as Array<{ id: string; display_name: string; entity_type: string }>;
}

async function searchGraphNodes(orgId: string, nameToken: string): Promise<Array<{ id: string; label: string; node_type: string }>> {
  const { data, error } = await getPilClient()
    .from("pil_graph_nodes")
    .select("id, label, node_type")
    .eq("organization_id", orgId)
    .ilike("label", `%${nameToken}%`)
    .limit(CANDIDATE_LIMIT);
  if (error) return [];
  return (data ?? []) as Array<{ id: string; label: string; node_type: string }>;
}

export const entityLookupTool: Tool = {
  name: TOOL_NAME,
  description:
    "Fuzzy-searches foundation_directory, pil_prospects, and pil_graph_nodes for entities matching a name; returns ranked matches with confidence scores.",

  async execute(params: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
    if (!context.tools.includes(TOOL_NAME)) {
      return {
        success: false,
        data: null,
        cost_usd: 0,
        error: `Tool "${TOOL_NAME}" is not in the permitted tool set for agent ${context.agentCode}`,
      };
    }

    const name = params.name;
    if (typeof name !== "string" || name.length === 0) {
      return { success: false, data: null, cost_usd: 0, error: "entity_lookup requires a string `name` param" };
    }
    const entityType = typeof params.type === "string" ? params.type : undefined;
    const location = typeof params.location === "string" ? params.location : undefined;

    const normalized = normalize(name);
    const firstToken = normalized.split(" ")[0] ?? normalized;
    if (!firstToken) {
      return { success: true, data: { query: name, matches: [] }, cost_usd: COST_PER_LOOKUP_USD };
    }

    try {
      const [foundations, prospects, nodes] = await Promise.all([
        searchFoundationDirectory(firstToken, location),
        searchProspects(context.orgId, firstToken, entityType),
        searchGraphNodes(context.orgId, firstToken),
      ]);

      const matches: EntityMatch[] = [
        ...foundations.map((f) => ({
          source: "foundation_directory" as const,
          id: f.id,
          name: f.name,
          entity_type: "foundation",
          location: [f.city, f.state].filter(Boolean).join(", ") || null,
          confidence: similarity(name, f.name),
        })),
        ...prospects.map((p) => ({
          source: "pil_prospects" as const,
          id: p.id,
          name: p.display_name,
          entity_type: p.entity_type,
          location: null,
          confidence: similarity(name, p.display_name),
        })),
        ...nodes.map((n) => ({
          source: "pil_graph_nodes" as const,
          id: n.id,
          name: n.label,
          entity_type: n.node_type,
          location: null,
          confidence: similarity(name, n.label),
        })),
      ]
        .filter((m) => m.confidence > 0)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, RESULT_LIMIT);

      return {
        success: true,
        data: { query: name, matches },
        cost_usd: COST_PER_LOOKUP_USD,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, data: null, cost_usd: 0, error: `entity_lookup failed for "${name}": ${message}` };
    }
  },
};

export default entityLookupTool;
