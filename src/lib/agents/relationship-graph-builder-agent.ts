// Relationship Graph Builder Agent — AUTONOMOUS_PLATFORM_VISION.md Phase 3
// ("Corporate Relationship Graph"), AGENTS_v2.md AG-32.
//
// Per AGENTS_v2.md §1.4 and AUTONOMOUS_PLATFORM_VISION.md §7's own Phase 3
// blueprint table, this feature has "no new agent number" — it is an
// extension of AG-23 (Relationship Mapper), and it "extends pig_nodes and
// pig_edges (migration 094) directly — it does not introduce a parallel
// relationship schema." This file is written as a standalone class (as the
// task that produced it requested, labeled AG-32) but follows that explicit
// design constraint: it writes board-overlap / shared-executive /
// alumni-network connections as new `relationship_type` values on the real,
// applied `pig_edges` table (src/supabase/migrations/077_intelligence_graph.sql),
// never to a `corporate_relationships` table — no migration anywhere in
// either src/supabase/migrations/ or supabase/migrations/ ever created one,
// despite SCHEMA_REGISTRY_v2.md table 37 describing it as applied.
//
// Schema deviations from the task's literal wording, verified against real
// migrations before writing this file:
//   - There is no `knowledge_base_profiles` table (see draft-generation-
//     agent.ts's header for the same finding re: org profile data). Board
//     member / leadership records live in the real `board_members` table
//     (org_id, name, email, role, committee, expertise, active —
//     src/supabase/migrations/078_forecast_board.sql), not a
//     "leadership_board section" of a nonexistent profiles table.
//   - `pig_nodes` requires `entity_table` + `entity_id` pointing at a real
//     row (UNIQUE(entity_table, entity_id)) and `pig_edges` requires
//     `source_node_id`/`target_node_id` FKs into pig_nodes, not free-text
//     entity names. This agent upserts a pig_nodes row per board member and
//     per matched funder/prospect before writing the edge, and folds the
//     task's requested source_entity_name/target_entity_name/
//     introduction_strength/warm-introduction-path fields into
//     pig_edges.metadata (jsonb) and pig_edges.evidence (text) since
//     pig_edges has no dedicated columns for them.
//   - `corporate_prospects` is real (src/lib/sources/corporate-acquisition-
//     adapter.ts confirms legal_name/website/enrichment columns) but has no
//     `organization_id` — it is a shared, cross-org table by design
//     (BLUEPRINT_v2.md §4.4; see project memory
//     benavora-corporate-prospects-no-org-id). This agent therefore cannot
//     load "the org's corporate_prospects list" as literally scoped — it
//     reads a bounded, recency-ordered slice of the shared pool instead of
//     an org-filtered query, and that limitation is intentional, not a bug.
//   - `agent_type` on `agent_runs` is a strict Postgres enum
//     (AGENTS_v2.md §1.2). No migration has ever added an `ag-32-*` value.
//     Exactly like the eleven other unwired AutonomousAgent subclasses
//     documented in AGENTS_v2.md §1.2 (e.g. draft-generation-agent.ts,
//     eligibility-scoring-agent.ts), this.startRun()'s agent_runs insert
//     will fail against the live schema until a future migration adds
//     'ag-32-relationship-graph' via ALTER TYPE ... ADD VALUE IF NOT
//     EXISTS. This file is built and ready; it is not wired into any
//     scheduler, queue route, or `routeQueueItem()` case, matching every
//     other PLANNED agent's status in this codebase — see AGENTS_v2.md §1.1.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaudeWithWebSearch, DEFAULT_MODEL } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";

type IntroductionStrength = "direct" | "one_hop";

/** The relationship_type vocabulary this agent is permitted to write onto
 * pig_edges, per AUTONOMOUS_PLATFORM_VISION.md's own Phase 3 description
 * ("board overlaps, alumni networks, and shared-executive relationships").
 * Anything Claude returns outside this set is coerced to the closest
 * generic value rather than rejected outright — see normalizeRelationshipType. */
const ALLOWED_RELATIONSHIP_TYPES = new Set([
  "board_overlap",
  "shared_executive",
  "alumni_network",
  "family_foundation_tie",
]);

const DEFAULT_RELATIONSHIP_TYPE = "shared_executive";

// Nightly-batch caps, mirroring the sampling convention every other
// external-search-driven agent in this codebase uses (e.g. AG-18's
// REPUTATION_SAMPLE_SIZE=5 — a Claude + web_search call per entity is
// expensive; see reputation-agent.ts / AGENTS_v2.md's own note on this).
const MAX_BOARD_MEMBERS_PER_RUN = 10;
const MAX_FUNDERS_IN_PROMPT = 25;
const MAX_PROSPECTS_IN_PROMPT = 25;
const MAX_PROSPECTS_LOADED = 50;
const WEB_SEARCH_MAX_USES = 4;
const CLAUDE_MAX_TOKENS = 800;

interface BoardMemberRow {
  id: string;
  name: string;
  role: string | null;
  expertise: string[] | null;
}

interface FunderRow {
  id: string;
  name: string;
  website: string | null;
}

interface ProspectRow {
  id: string;
  legal_name: string;
  website: string | null;
}

interface TargetEntity {
  id: string;
  label: string;
  nodeType: "funder" | "business";
  entityTable: "funders" | "corporate_prospects";
}

interface RawConnection {
  target_name?: unknown;
  relationship_type?: unknown;
  degree?: unknown;
  description?: unknown;
  confidence?: unknown;
}

interface DiscoveredConnection {
  targetName: string;
  relationshipType: string;
  degree: IntroductionStrength;
  description: string;
  confidence: number;
}

function normalizeRelationshipType(value: unknown): string {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  return ALLOWED_RELATIONSHIP_TYPES.has(normalized)
    ? normalized
    : DEFAULT_RELATIONSHIP_TYPE;
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 40;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Tolerant JSON-array extraction — mirrors parseRecommendation in
 * relationship-builder-agent.ts, adapted for an array response instead of a
 * single object. Returns an empty array (never throws) on any unreadable or
 * malformed response so one bad Claude turn never aborts the whole run.
 */
function parseConnections(text: string): DiscoveredConnection[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  if (!Array.isArray(raw)) return [];

  const results: DiscoveredConnection[] = [];
  for (const item of raw as RawConnection[]) {
    const targetName =
      typeof item.target_name === "string" ? item.target_name.trim() : "";
    const description =
      typeof item.description === "string" ? item.description.trim() : "";
    if (!targetName || !description) continue;

    const degree: IntroductionStrength =
      item.degree === "one_hop" ? "one_hop" : "direct";

    results.push({
      targetName,
      relationshipType: normalizeRelationshipType(item.relationship_type),
      degree,
      description,
      confidence: clampConfidence(item.confidence),
    });
  }
  return results;
}

/** Case-insensitive match of Claude's free-text target_name against the
 * known funder/prospect names passed into the prompt, so a discovered
 * connection can be tied back to a real row before any DB write. */
function resolveTarget(
  targetName: string,
  funders: FunderRow[],
  prospects: ProspectRow[],
): TargetEntity | null {
  const needle = targetName.toLowerCase();

  const funderMatch = funders.find(
    (f) =>
      f.name.toLowerCase() === needle || f.name.toLowerCase().includes(needle),
  );
  if (funderMatch) {
    return {
      id: funderMatch.id,
      label: funderMatch.name,
      nodeType: "funder",
      entityTable: "funders",
    };
  }

  const prospectMatch = prospects.find(
    (p) =>
      p.legal_name.toLowerCase() === needle ||
      p.legal_name.toLowerCase().includes(needle),
  );
  if (prospectMatch) {
    return {
      id: prospectMatch.id,
      label: prospectMatch.legal_name,
      nodeType: "business",
      entityTable: "corporate_prospects",
    };
  }

  return null;
}

function buildConnectionSearchPrompt(
  member: BoardMemberRow,
  funders: FunderRow[],
  prospects: ProspectRow[],
): { system: string; prompt: string } {
  const system = [
    "You are a nonprofit relationship-intelligence researcher. Use web search",
    "to find this person's professional connections: past employers,",
    "university affiliations, other board memberships, and family foundation",
    "ties. Only report a connection if it links to one of the specific",
    "funder or prospect names provided — never invent a connection to an",
    "organization not in that list.",
    "",
    'Return ONLY a JSON array, no prose: [{ "target_name": string,',
    '"relationship_type": "board_overlap"|"shared_executive"|',
    '"alumni_network"|"family_foundation_tie", "degree": "direct"|"one_hop",',
    '"description": string, "confidence": number (0-100) }]',
    "",
    "direct = the person is currently or was personally on that entity's",
    "board/staff/leadership. one_hop = the connection runs through an",
    "intermediary (e.g. a shared alma mater or a former colleague now at",
    "that entity). Return an empty array [] if nothing verifiable is found.",
  ].join("\n");

  const funderLines = funders
    .map((f) => `- ${f.name}${f.website ? ` (${f.website})` : ""}`)
    .join("\n");
  const prospectLines = prospects
    .map((p) => `- ${p.legal_name}${p.website ? ` (${p.website})` : ""}`)
    .join("\n");

  const prompt = [
    `Board member: ${member.name}`,
    member.role ? `Role: ${member.role}` : null,
    member.expertise && member.expertise.length > 0
      ? `Known expertise: ${member.expertise.join(", ")}`
      : null,
    "",
    "Known funders (search for connections to these):",
    funderLines || "(none on file)",
    "",
    "Known corporate prospects (search for connections to these):",
    prospectLines || "(none on file)",
    "",
    "Search for this person's professional history and affiliations, then",
    "report any verifiable connection to the entities listed above. Return",
    "ONLY the JSON array described in the system prompt.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return { system, prompt };
}

/** Human-readable warm-introduction path, e.g. "Board member John Smith
 * previously worked at ABC Corp, which donates to organizations like
 * yours." Stored in pig_edges.metadata.warm_introduction_path and used as
 * the decision log's action_taken text. */
function buildWarmIntroductionPath(
  memberName: string,
  targetLabel: string,
  description: string,
  degree: IntroductionStrength,
): string {
  const degreeText =
    degree === "direct"
      ? "a direct connection to"
      : "a one-hop connection (through an intermediary) to";
  return `Board member ${memberName} has ${degreeText} ${targetLabel}: ${description}`;
}

/** Upserts a pig_nodes row for a real entity row and returns its id.
 * pig_nodes has UNIQUE(entity_table, entity_id), so this is idempotent
 * across repeated runs — re-discovering the same person/entity never
 * creates a duplicate node. */
async function ensurePigNode(
  supabase: SupabaseClient,
  nodeType: string,
  entityTable: string,
  entityId: string,
  label: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("pig_nodes")
    .upsert(
      {
        node_type: nodeType,
        entity_table: entityTable,
        entity_id: entityId,
        label,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entity_table,entity_id" },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to upsert pig_nodes row for ${entityTable}/${entityId}: ${
        error?.message ?? "no row returned"
      }`,
    );
  }
  return (data as { id: string }).id;
}

export class RelationshipGraphBuilderAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-32-relationship-graph", supabase);
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    let boardMembersAnalyzed = 0;
    let connectionsFound = 0;
    let directConnections = 0;
    let oneHopConnections = 0;

    try {
      const [boardRes, funderRes, prospectRes] = await Promise.all([
        this.supabase
          .from("board_members")
          .select("id, name, role, expertise")
          .eq("org_id", this.orgId)
          .eq("active", true)
          .limit(MAX_BOARD_MEMBERS_PER_RUN),
        this.supabase
          .from("funders")
          .select("id, name, website")
          .eq("organization_id", this.orgId)
          .limit(MAX_FUNDERS_IN_PROMPT),
        // corporate_prospects has no organization_id (shared pool across
        // orgs by design - see file header). We read a bounded,
        // recency-ordered slice rather than an org-scoped query.
        this.supabase
          .from("corporate_prospects")
          .select("id, legal_name, website")
          .order("created_at", { ascending: false })
          .limit(MAX_PROSPECTS_LOADED),
      ]);

      if (boardRes.error) {
        throw new Error(`Failed to load board members: ${boardRes.error.message}`);
      }
      if (funderRes.error) {
        throw new Error(`Failed to load funders: ${funderRes.error.message}`);
      }
      if (prospectRes.error) {
        throw new Error(
          `Failed to load corporate prospects: ${prospectRes.error.message}`,
        );
      }

      const boardMembers = (boardRes.data ?? []) as BoardMemberRow[];
      const funders = (funderRes.data ?? []) as FunderRow[];
      const prospects = ((prospectRes.data ?? []) as ProspectRow[]).slice(
        0,
        MAX_PROSPECTS_IN_PROMPT,
      );

      if (boardMembers.length === 0) {
        const summary = {
          boardMembersAnalyzed: 0,
          connectionsFound: 0,
          directConnections: 0,
          oneHopConnections: 0,
        };
        await this.completeRun(runId, {
          outputSummary: JSON.stringify(summary),
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
        });
        return {
          success: true,
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      for (const member of boardMembers) {
        boardMembersAnalyzed++;

        try {
          const { system, prompt } = buildConnectionSearchPrompt(
            member,
            funders,
            prospects,
          );

          const response = await callClaudeWithWebSearch({
            system,
            prompt,
            model: DEFAULT_MODEL,
            maxTokens: CLAUDE_MAX_TOKENS,
            maxSearches: WEB_SEARCH_MAX_USES,
          });

          const connections = parseConnections(response.text);
          if (connections.length === 0) continue;

          const memberNodeId = await ensurePigNode(
            this.supabase,
            "person",
            "board_members",
            member.id,
            member.name,
          );

          for (const conn of connections) {
            const target = resolveTarget(conn.targetName, funders, prospects);
            if (!target) {
              errors.push(
                `board member ${member.id}: could not resolve discovered ` +
                  `connection target "${conn.targetName}" to a known funder ` +
                  `or prospect - skipped.`,
              );
              continue;
            }

            const targetNodeId = await ensurePigNode(
              this.supabase,
              target.nodeType,
              target.entityTable,
              target.id,
              target.label,
            );

            const warmIntroductionPath = buildWarmIntroductionPath(
              member.name,
              target.label,
              conn.description,
              conn.degree,
            );
            const weight = conn.degree === "direct" ? 1.0 : 0.5;

            const { error: edgeError } = await this.supabase
              .from("pig_edges")
              .upsert(
                {
                  source_node_id: memberNodeId,
                  target_node_id: targetNodeId,
                  relationship_type: conn.relationshipType,
                  weight,
                  evidence: conn.description,
                  verified: false,
                  metadata: {
                    introduction_strength: conn.degree,
                    warm_introduction_path: warmIntroductionPath,
                    confidence: conn.confidence,
                    source_type: "board_member",
                    source_entity_name: member.name,
                    target_entity_name: target.label,
                  },
                },
                { onConflict: "source_node_id,target_node_id,relationship_type" },
              );

            if (edgeError) {
              errors.push(
                `board member ${member.id} -> ${target.label}: failed to ` +
                  `write pig_edges row: ${edgeError.message}`,
              );
              continue;
            }

            connectionsFound++;
            if (conn.degree === "direct") {
              directConnections++;
            } else {
              oneHopConnections++;
            }

            decisions.push(
              await this.logDecision({
                decisionType: "relationship_connection_discovered",
                agentRunId: runId,
                entityType: "pig_edge",
                entityId: targetNodeId,
                reasoning: `${member.name} -> ${target.label} (${conn.relationshipType}, ${conn.degree}): ${conn.description}`,
                confidenceScore: conn.confidence,
                actionTaken: warmIntroductionPath,
                actionPayload: {
                  relationshipType: conn.relationshipType,
                  degree: conn.degree,
                  sourceEntityName: member.name,
                  targetEntityName: target.label,
                },
              }),
            );
          }
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to process board member connections.";
          errors.push(`board member ${member.id}: ${message}`);
        }
      }

      const summary = {
        boardMembersAnalyzed,
        connectionsFound,
        directConnections,
        oneHopConnections,
      };

      await this.completeRun(runId, {
        outputSummary: JSON.stringify(summary),
        itemsFound: boardMembers.length,
        itemsProcessed: boardMembersAnalyzed,
        itemsQueued: connectionsFound,
      });

      return {
        success: true,
        itemsFound: boardMembers.length,
        itemsProcessed: boardMembersAnalyzed,
        itemsQueued: connectionsFound,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Relationship graph builder run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: boardMembersAnalyzed,
        itemsQueued: connectionsFound,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
