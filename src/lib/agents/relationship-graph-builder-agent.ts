// Relationship Graph Builder Agent — AUTONOMOUS_PLATFORM_VISION.md Phase 3
// ("Corporate Relationship Graph"), AGENTS_v2.md AG-32.
//
// Not part of the relationship-scoring consolidation (see
// BEHAVIORAL_CONTRACTS.md's "Relationship Scoring" contract, funder-
// relationship.ts/Agent 23, and relationship-builder-agent.ts/AG-19's Phase
// A) — this agent never computes a funder relationship score and never reads
// or writes funder_relationship_scores or funder_relationship_events. It
// only discovers and writes pig_nodes/pig_edges graph connections (edge
// `weight` below is introduction confidence, not a relationship score).
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
//     member / leadership records live in the real `board_members` table,
//     not a "leadership_board section" of a nonexistent profiles table.
//     CORRECTED 2026-08-03 (AGENT_VERIFICATION_LOG.md, AG-32 entries): the
//     column list originally cited here (org_id, name, email, role,
//     committee, expertise, active) came from `src/supabase/migrations/
//     078_forecast_board.sql` — that migration was never applied live (same
//     two-parallel-migrations-directories pattern documented elsewhere in
//     this project). The table that's actually live is the original one
//     from root `supabase/migrations/001_initial_schema.sql`:
//     id, organization_id, name, title, bio, email, phone, start_date,
//     is_active, created_at, updated_at. No `role`/`committee`/`expertise`/
//     `active`/`org_id` exist. This file's query and prompt-builder now use
//     the real columns (`title` in place of `role`, `organization_id` in
//     place of `org_id`, `is_active` in place of `active`); `expertise` has
//     no real equivalent anywhere live, so it was dropped rather than
//     invented — `bio` (a different, real, free-text column) is included in
//     the prompt as its own separately-labeled field instead.
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
//     (AGENTS_v2.md §1.2). RESOLVED 2026-08-02: 'ag-32-relationship-graph'
//     was added live (see AGENT_VERIFICATION_LOG.md's enum-gap entries) and
//     this agent was independently re-run and confirmed reaching real work
//     (real board_members data loaded) up to the known corporate_prospects
//     table-missing blocker (shared with AG-20/21/22/24/30) — no longer
//     unreachable at startRun().
//
// --- Scheduler wiring, added 2026-08-03 (AG-23 spec, AGENTS_v2.md §5) ------
//
// run() now accepts an optional `boardMemberIds` scope parameter (see its
// own doc comment below) so a caller can restrict a run to a specific set
// of board members instead of always processing every active one. This is
// wired into worker/scheduler.ts as a new daily 5:30 AM CST job
// ('AG-23 relationship graph incremental pipeline' ->
// runRelationshipGraphIncrementalPipeline in worker/autonomous-orchestrator.ts),
// which resolves the incremental scope per org (board members with no
// pig_nodes row yet, or updated since their existing node's updated_at) and
// only calls run() for orgs that actually have candidates. Per AG-23's own
// spec: daily-incremental was chosen over a weekly full-rebuild because a
// full rebuild re-runs every board member's web-search Claude call weekly
// even when nothing changed, while the incremental scope only does real
// work where there's real new signal — cheaper at platform scale and
// fresher (a new board member's connections surface within a day, not up
// to a week later). Rules 5-8 (org-level) and the corporate_intent_signals
// seed are unaffected by this scope — see the header on run() below.
//
// --- Phase 2 discovery rules (rules 5-8), added July 19, 2026 ---------------
//
// Four more pig_edges discovery rules, verified against the real applied
// schema before writing (root supabase/migrations/, not the aspirational
// SCHEMA_REGISTRY_v2.md/AUTONOMOUS_PLATFORM_VISION.md wording):
//
//   - `organizations` (supabase/migrations/001_initial_schema.sql) has no
//     ntee_code column and never has — its only classification-adjacent
//     fields are free-text `mission_statement`, `target_population`, and
//     `service_area`. Rule 5 ("same NTEE code as this org") is therefore
//     implemented against an *inferred* NTEE major-group letter, derived
//     from a small keyword map over those three free-text fields (see
//     inferOrgNteeMajorGroup below) — the same style of heuristic mapping
//     already used for donor-discovery NAICS labels
//     (src/lib/donor-discovery/naics-labels.ts). `foundation_directory`
//     (supabase/migrations/046_foundation_directory.sql) does carry a real
//     `ntee_code` column, populated from IRS BMF data, and is matched
//     against the inferred major group with a prefix match.
//   - There is no recipient-level "which NTEE-coded orgs did this funder
//     give to" data anywhere in this schema — foundation_directory's
//     `enrichment` jsonb (added supabase/migrations/072_foundation_
//     directory_990_enrichment.sql) has only fund-level 990 fields
//     (total_giving, grant_count, grant_range_min/max, fiscal_year — see
//     scripts/enrich-foundations-990.ts), never a recipient list. "Funded
//     organizations with the same NTEE code... N times in past 3 years" is
//     therefore evaluated as: foundation's own ntee_code matches the org's
//     inferred major group, AND enrichment.grant_count > 0, AND
//     enrichment.fiscal_year falls within the last 3 years — the closest
//     real signal for "this funder was actively giving in this cause area
//     recently," not a literal recipient-NTEE join that no data supports.
//   - Rule 6 (asset compatibility) is the one rule with a clean, direct
//     real-schema match: `organizations.annual_budget` vs
//     `foundation_directory.asset_amount`, both real numeric columns.
//   - Rule 7 (geographic giving history) matches
//     `foundation_directory.city`/`state` against `organizations.city`/
//     `state`, gated on the same giving-activity signal as Rule 5
//     (grant_count > 0 or giving_total > 0 — both real columns).
//   - Rule 8 (board network overlap) names a `corporate_relationships`
//     table. Exactly like this file's own note above re: AG-32's original
//     board-overlap logic, **no migration anywhere in either
//     src/supabase/migrations/ or supabase/migrations/ has ever created a
//     `corporate_relationships` table** — it exists only in
//     CORPORATE_INTELLIGENCE_ARCHITECTURE.md as aspirational schema. This
//     rule is implemented defensively (query, catch a missing-relation
//     error, degrade to zero matches) using the exact same
//     try/catch-return-empty pattern strategic-advisor-agent.ts already
//     uses for its own Phase 2-5 "table may not exist yet" reads
//     (loadOptionalOrgRows). It will correctly no-op today and start
//     working the moment a future migration creates that table — it is not
//     dead code, it is forward-defensive code, matching this codebase's
//     established convention for PLANNED-but-unbuilt dependencies.
//   - `corporate_intent_signals` (task's pig_nodes seed source) also has no
//     migration anywhere — confirmed via the same table already being
//     treated as optional/not-yet-real in strategic-advisor-agent.ts
//     (AGENTS_v2.md AG-30/AG-40's own dependency notes say as much). Seeded
//     the same defensive way, per the task's own "if table exists"
//     qualifier.
//   - The org's own pig_nodes row (entity_table="organizations") did not
//     exist before this change — rules 5-7 need a source node for the org
//     itself, distinct from the per-board-member "person" nodes rules 1-4
//     create. node_type "nonprofit" per SCHEMA_REGISTRY_v2.md's own
//     pig_nodes.node_type vocabulary (business/foundation/government/
//     person/nonprofit).

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { causeOf, withCause } from "@/lib/agents/base-agent";
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

// Phase 2 rules 5-8 — deterministic, no Claude call (unlike rules 1-4's
// web-search connection discovery), so these caps exist purely to bound
// query/edge-write volume per nightly run, not token spend.
const MAX_GIVING_CYCLE_MATCHES = 20;
const MAX_ASSET_COMPATIBLE_MATCHES = 20;
const MAX_GEOGRAPHIC_MATCHES = 20;
const GIVING_CYCLE_LOOKBACK_YEARS = 3;
const ASSET_MULTIPLE_MIN = 10;
const ASSET_MULTIPLE_MAX = 1000;

/** Relationship_type values rules 5-8 write to pig_edges.relationship_type
 * — kept distinct from ALLOWED_RELATIONSHIP_TYPES above (which is rules
 * 1-4's Claude-constrained board-connection vocabulary). */
const GIVING_CYCLE_ALIGNED = "giving_cycle_aligned";
const ASSET_COMPATIBLE = "asset_compatible";
const GEOGRAPHIC_GIVING_HISTORY = "geographic_giving_history";
const BOARD_NETWORK_OVERLAP = "board_network_overlap";

/** Coarse keyword -> NTEE major-group letter map, standing in for the
 * ntee_code column organizations.ts doesn't have (see file header). Order
 * matters — first matching key wins. Not exhaustive; extend as new org
 * cause areas come online. */
const NTEE_MAJOR_GROUP_KEYWORDS: Array<[string, string[]]> = [
  ["L", ["housing", "shelter", "homeless", "transitional housing"]],
  ["E", ["health", "medical", "healthcare", "hospital", "clinic"]],
  ["B", ["education", "school", "literacy", "tutoring", "scholarship"]],
  ["O", ["youth development", "youth", "mentoring"]],
  ["P", ["human services", "social services", "family services", "crisis", "food bank"]],
  ["A", ["arts", "culture", "museum", "theater", "music"]],
  ["C", ["environment", "conservation", "wildlife", "sustainability"]],
  ["D", ["animal welfare", "humane society", "animal rescue"]],
  ["X", ["religion", "faith", "church", "ministry"]],
  ["Q", ["international", "refugee", "global"]],
  ["S", ["community development", "economic development", "community improvement"]],
];

interface BoardMemberRow {
  id: string;
  name: string;
  title: string | null;
  // No real "expertise" tags/skills column exists anywhere on board_members
  // or a related table (confirmed live, AGENT_VERIFICATION_LOG.md's AG-32
  // entry) — `bio` (free-text) is the closest real signal and is included
  // as its own labeled field in the prompt below, not conflated with a
  // structured expertise list that doesn't exist.
  bio: string | null;
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

interface OrgRow {
  id: string;
  name: string;
  mission_statement: string | null;
  target_population: string | null;
  service_area: string | null;
  annual_budget: number | null;
  city: string | null;
  state: string | null;
}

interface FoundationDirectoryEnrichment {
  grant_count?: number | null;
  fiscal_year?: number | null;
  total_giving?: number | null;
}

interface FoundationDirectoryRow {
  id: string;
  name: string;
  ntee_code: string | null;
  asset_amount: number | null;
  city: string | null;
  state: string | null;
  giving_total: number | null;
  officers: unknown;
  enrichment: FoundationDirectoryEnrichment | null;
}

/** Loosely typed — corporate_relationships has no migration anywhere (see
 * file header); this shape is a best guess at the aspirational columns
 * named in CORPORATE_INTELLIGENCE_ARCHITECTURE.md, used only if the table
 * is ever actually created. */
interface CorporateRelationshipRow {
  id: string;
  source_entity_name?: string | null;
  target_entity_name?: string | null;
}

/** Also has no migration anywhere (see file header) — read defensively
 * with an unknown-shaped row and a best-effort label. */
interface CorporateIntentSignalRow {
  id: string;
  [key: string]: unknown;
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
    member.title ? `Role: ${member.title}` : null,
    member.bio ? `Bio: ${member.bio}` : null,
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

/** Best-effort NTEE major-group inference from an org's free-text
 * mission/population/service-area fields — see file header for why this
 * exists instead of reading a real ntee_code column. Returns null (rule 5
 * skips) when nothing matches rather than guessing. */
function inferOrgNteeMajorGroup(org: OrgRow): string | null {
  const haystack = [org.mission_statement, org.target_population, org.service_area]
    .filter((v): v is string => Boolean(v))
    .join(" ")
    .toLowerCase();
  if (!haystack) return null;

  for (const [majorGroup, keywords] of NTEE_MAJOR_GROUP_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return majorGroup;
  }
  return null;
}

/** Extracts trustee/officer names from foundation_directory.officers jsonb
 * (real column, supabase/migrations/058_lead_enrichment_system.sql).
 * Tolerant of unknown shapes since nothing in this codebase has ever
 * populated it at scale — see AGENTS_v2.md's Foundation Enrichment Agent
 * (AG-13) note that enrichment scripts were never run against the full
 * foundation set. */
function extractTrusteeNames(officers: unknown): string[] {
  if (!Array.isArray(officers)) return [];
  const names: string[] = [];
  for (const entry of officers) {
    if (typeof entry === "string" && entry.trim()) {
      names.push(entry.trim());
    } else if (entry && typeof entry === "object") {
      const name = (entry as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) names.push(name.trim());
    }
  }
  return names;
}

/** Best-effort display label for a corporate_intent_signals row whose real
 * shape is unknown (see file header) — tries the common name-ish columns
 * other tables in this schema use before falling back to the row id. */
function labelCorporateIntentSignal(row: CorporateIntentSignalRow): string {
  const candidates = ["name", "company_name", "legal_name", "prospect_name", "entity_name"];
  for (const key of candidates) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `corporate_intent_signals/${row.id}`;
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

  if (error) {
    console.error(
      `[ensurePigNode] upsert failed for ${entityTable}/${entityId}: ${causeOf(error)}`,
    );
    throw new Error(
      withCause(`Failed to upsert pig_nodes row for ${entityTable}/${entityId}.`, error),
    );
  }
  if (!data) {
    throw new Error(
      `Failed to upsert pig_nodes row for ${entityTable}/${entityId}: no row returned.`,
    );
  }
  return (data as { id: string }).id;
}

export class RelationshipGraphBuilderAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-32-relationship-graph", supabase);
  }

  private async loadOrg(): Promise<OrgRow | null> {
    const { data, error } = await this.supabase
      .from("organizations")
      .select(
        "id, name, mission_statement, target_population, service_area, annual_budget, city, state",
      )
      .eq("id", this.orgId)
      .maybeSingle();
    if (error) {
      console.error(
        `[RelationshipGraphBuilderAgent.loadOrg] query failed for orgId=${this.orgId}: ${causeOf(error)}`,
      );
      throw new Error(
        withCause("Failed to load organization for relationship graph building.", error),
      );
    }
    if (!data) return null;
    return data as OrgRow;
  }

  /** Shared write path for rules 5-7: ensures the foundation's pig_nodes
   * row, upserts the pig_edges row, and logs the decision. Rule-specific
   * query/candidate logic lives in each rule's own method below. */
  private async writeFoundationEdge(params: {
    runId: string;
    orgNodeId: string;
    foundation: FoundationDirectoryRow;
    relationshipType: string;
    weight: number;
    evidence: string;
    decisions: string[];
    errors: string[];
  }): Promise<boolean> {
    const { runId, orgNodeId, foundation, relationshipType, weight, evidence, decisions, errors } =
      params;
    try {
      const foundationNodeId = await ensurePigNode(
        this.supabase,
        "foundation",
        "foundation_directory",
        foundation.id,
        foundation.name,
      );

      const { error: edgeError } = await this.supabase.from("pig_edges").upsert(
        {
          source_node_id: orgNodeId,
          target_node_id: foundationNodeId,
          relationship_type: relationshipType,
          weight,
          evidence,
          verified: false,
          metadata: {
            source_type: "org_self",
            target_entity_name: foundation.name,
          },
        },
        { onConflict: "source_node_id,target_node_id,relationship_type" },
      );

      if (edgeError) {
        errors.push(
          `${relationshipType} -> ${foundation.name}: failed to write pig_edges row: ${edgeError.message}`,
        );
        return false;
      }

      decisions.push(
        await this.logDecision({
          decisionType: relationshipType,
          agentRunId: runId,
          entityType: "pig_edge",
          entityId: foundationNodeId,
          reasoning: evidence,
          confidenceScore: Math.round(weight * 100),
          actionTaken: `Discovered ${relationshipType} edge to ${foundation.name}`,
          actionPayload: {
            relationshipType,
            targetEntityName: foundation.name,
          },
        }),
      );
      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to write foundation edge.";
      errors.push(`${relationshipType} -> ${foundation.name}: ${message}`);
      return false;
    }
  }

  /** Rule 5 — giving cycle alignment: foundations whose own ntee_code
   * matches this org's inferred cause area and that show recent (last 3
   * fiscal years on file) grantmaking activity. See file header for why
   * this is the real-schema proxy for "funded orgs with the same NTEE code
   * in the past 3 years." */
  private async runGivingCycleRule(
    runId: string,
    orgNodeId: string,
    org: OrgRow,
    decisions: string[],
    errors: string[],
  ): Promise<number> {
    const nteeMajorGroup = inferOrgNteeMajorGroup(org);
    if (!nteeMajorGroup) return 0;

    const { data, error } = await this.supabase
      .from("foundation_directory")
      .select("id, name, ntee_code, asset_amount, city, state, giving_total, officers, enrichment")
      .ilike("ntee_code", `${nteeMajorGroup}%`)
      .order("asset_amount", { ascending: false, nullsFirst: false })
      .limit(100);

    if (error) {
      errors.push(`giving cycle rule: failed to load foundation_directory: ${error.message}`);
      return 0;
    }

    const cutoffYear = new Date().getFullYear() - GIVING_CYCLE_LOOKBACK_YEARS;
    const candidates = ((data ?? []) as FoundationDirectoryRow[])
      .filter((f) => {
        const grantCount = f.enrichment?.grant_count ?? 0;
        const fiscalYear = f.enrichment?.fiscal_year ?? 0;
        return grantCount > 0 && fiscalYear >= cutoffYear;
      })
      .slice(0, MAX_GIVING_CYCLE_MATCHES);

    let matched = 0;
    for (const foundation of candidates) {
      const grantCount = foundation.enrichment?.grant_count ?? 0;
      const fiscalYear = foundation.enrichment?.fiscal_year ?? cutoffYear;
      const evidence = `Funded NTEE ${nteeMajorGroup} organizations ${grantCount} times in the past ${GIVING_CYCLE_LOOKBACK_YEARS} years (most recent fiscal year on file: ${fiscalYear}).`;
      const wrote = await this.writeFoundationEdge({
        runId,
        orgNodeId,
        foundation,
        relationshipType: GIVING_CYCLE_ALIGNED,
        weight: 0.7,
        evidence,
        decisions,
        errors,
      });
      if (wrote) matched++;
    }
    return matched;
  }

  /** Rule 6 — asset size compatibility: foundation assets between 10x and
   * 1000x this org's annual budget (too small = won't fund at this scale,
   * too large = out of reach / not a realistic target). Skips entirely if
   * the org has no annual_budget on file. */
  private async runAssetCompatibilityRule(
    runId: string,
    orgNodeId: string,
    org: OrgRow,
    decisions: string[],
    errors: string[],
  ): Promise<number> {
    if (!org.annual_budget || org.annual_budget <= 0) return 0;

    const minAsset = org.annual_budget * ASSET_MULTIPLE_MIN;
    const maxAsset = org.annual_budget * ASSET_MULTIPLE_MAX;

    const { data, error } = await this.supabase
      .from("foundation_directory")
      .select("id, name, ntee_code, asset_amount, city, state, giving_total, officers, enrichment")
      .gte("asset_amount", minAsset)
      .lte("asset_amount", maxAsset)
      .order("asset_amount", { ascending: true })
      .limit(MAX_ASSET_COMPATIBLE_MATCHES);

    if (error) {
      errors.push(`asset compatibility rule: failed to load foundation_directory: ${error.message}`);
      return 0;
    }

    let matched = 0;
    for (const foundation of (data ?? []) as FoundationDirectoryRow[]) {
      const assetAmount = foundation.asset_amount ?? 0;
      const multiple = Math.round(assetAmount / org.annual_budget);
      const evidence = `Foundation assets of $${assetAmount.toLocaleString()} are ~${multiple}x this org's annual budget of $${org.annual_budget.toLocaleString()} — within the fundable ${ASSET_MULTIPLE_MIN}x-${ASSET_MULTIPLE_MAX}x range.`;
      const wrote = await this.writeFoundationEdge({
        runId,
        orgNodeId,
        foundation,
        relationshipType: ASSET_COMPATIBLE,
        weight: 0.6,
        evidence,
        decisions,
        errors,
      });
      if (wrote) matched++;
    }
    return matched;
  }

  /** Rule 7 — geographic giving history: foundations in the org's own
   * city/state with evidence of past giving (grant_count or giving_total
   * on file). Skips if the org has neither city nor state on file. */
  private async runGeographicGivingRule(
    runId: string,
    orgNodeId: string,
    org: OrgRow,
    decisions: string[],
    errors: string[],
  ): Promise<number> {
    if (!org.state && !org.city) return 0;

    let query = this.supabase
      .from("foundation_directory")
      .select("id, name, ntee_code, asset_amount, city, state, giving_total, officers, enrichment");
    query = org.state ? query.eq("state", org.state) : query.eq("city", org.city as string);

    const { data, error } = await query
      .order("giving_total", { ascending: false, nullsFirst: false })
      .limit(100);

    if (error) {
      errors.push(`geographic giving rule: failed to load foundation_directory: ${error.message}`);
      return 0;
    }

    const candidates = ((data ?? []) as FoundationDirectoryRow[])
      .filter((f) => (f.enrichment?.grant_count ?? 0) > 0 || (f.giving_total ?? 0) > 0)
      .slice(0, MAX_GEOGRAPHIC_MATCHES);

    let matched = 0;
    for (const foundation of candidates) {
      const grantCount = foundation.enrichment?.grant_count ?? 0;
      const givingTotal = foundation.giving_total ?? 0;
      const location = [foundation.city, foundation.state].filter(Boolean).join(", ");
      const evidence = `Foundation based in ${location || "org's service area"} matches this org's location; giving history on file: ${grantCount} recorded grants, $${givingTotal.toLocaleString()} total giving.`;
      const wrote = await this.writeFoundationEdge({
        runId,
        orgNodeId,
        foundation,
        relationshipType: GEOGRAPHIC_GIVING_HISTORY,
        weight: 0.8,
        evidence,
        decisions,
        errors,
      });
      if (wrote) matched++;
    }
    return matched;
  }

  /** Rule 8 — board network overlap via corporate_relationships. That
   * table has no migration anywhere in this codebase (see file header) —
   * this queries it defensively and degrades to zero matches rather than
   * failing the run, exactly like strategic-advisor-agent.ts's
   * loadOptionalOrgRows pattern for the same class of not-yet-real table.
   * Matches a foundation pig_node's officers-derived trustee names (real
   * foundation_directory.officers jsonb, via extractTrusteeNames) against
   * corporate_relationships.source_entity_name for this org. */
  private async runBoardNetworkOverlapRule(
    runId: string,
    orgNodeId: string,
    decisions: string[],
    errors: string[],
  ): Promise<number> {
    let relationshipRows: CorporateRelationshipRow[] = [];
    try {
      const { data, error } = await this.supabase
        .from("corporate_relationships")
        .select("id, source_entity_name, target_entity_name")
        .limit(50);
      if (error) return 0;
      relationshipRows = (data ?? []) as CorporateRelationshipRow[];
    } catch {
      return 0;
    }
    if (relationshipRows.length === 0) return 0;

    const sourceNames = new Set(
      relationshipRows
        .map((r) => (typeof r.source_entity_name === "string" ? r.source_entity_name.trim().toLowerCase() : ""))
        .filter(Boolean),
    );
    if (sourceNames.size === 0) return 0;

    const { data: foundationRows, error: foundationError } = await this.supabase
      .from("foundation_directory")
      .select("id, name, ntee_code, asset_amount, city, state, giving_total, officers, enrichment")
      .not("officers", "eq", "[]")
      .limit(200);

    if (foundationError) {
      errors.push(
        `board network overlap rule: failed to load foundation_directory: ${foundationError.message}`,
      );
      return 0;
    }

    let matched = 0;
    for (const foundation of (foundationRows ?? []) as FoundationDirectoryRow[]) {
      const trustees = extractTrusteeNames(foundation.officers);
      const matchedTrustee = trustees.find((t) => sourceNames.has(t.toLowerCase()));
      if (!matchedTrustee) continue;

      const evidence = `Trustee ${matchedTrustee} of ${foundation.name} matches a corporate_relationships source_entity_name recorded for this org.`;
      const foundationNodeId = await ensurePigNode(
        this.supabase,
        "foundation",
        "foundation_directory",
        foundation.id,
        foundation.name,
      );

      const { error: edgeError } = await this.supabase.from("pig_edges").upsert(
        {
          source_node_id: orgNodeId,
          target_node_id: foundationNodeId,
          relationship_type: BOARD_NETWORK_OVERLAP,
          weight: 0.95,
          evidence,
          verified: true,
          metadata: {
            source_type: "org_self",
            target_entity_name: foundation.name,
            matched_trustee: matchedTrustee,
          },
        },
        { onConflict: "source_node_id,target_node_id,relationship_type" },
      );

      if (edgeError) {
        errors.push(
          `${BOARD_NETWORK_OVERLAP} -> ${foundation.name}: failed to write pig_edges row: ${edgeError.message}`,
        );
        continue;
      }

      matched++;
      decisions.push(
        await this.logDecision({
          decisionType: BOARD_NETWORK_OVERLAP,
          agentRunId: runId,
          entityType: "pig_edge",
          entityId: foundationNodeId,
          reasoning: evidence,
          confidenceScore: 95,
          actionTaken: `Discovered verified board network overlap with ${foundation.name}`,
          actionPayload: {
            relationshipType: BOARD_NETWORK_OVERLAP,
            targetEntityName: foundation.name,
          },
        }),
      );
    }
    return matched;
  }

  /** Seeds pig_nodes from corporate_intent_signals "if table exists" per
   * the task spec — that table also has no migration anywhere (see file
   * header), so this degrades to zero seeded nodes today via the same
   * defensive pattern as runBoardNetworkOverlapRule above. */
  private async seedCorporateIntentSignalNodes(errors: string[]): Promise<number> {
    let rows: CorporateIntentSignalRow[] = [];
    try {
      const { data, error } = await this.supabase
        .from("corporate_intent_signals")
        .select("*")
        .eq("org_id", this.orgId)
        .limit(50);
      if (error) return 0;
      rows = (data ?? []) as CorporateIntentSignalRow[];
    } catch {
      return 0;
    }

    let seeded = 0;
    for (const row of rows) {
      try {
        await ensurePigNode(
          this.supabase,
          "business",
          "corporate_intent_signals",
          row.id,
          labelCorporateIntentSignal(row),
        );
        seeded++;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to seed corporate_intent_signals node.";
        errors.push(`corporate_intent_signals/${row.id}: ${message}`);
      }
    }
    return seeded;
  }

  /**
   * @param boardMemberIds - Optional scope: when provided (and non-empty),
   * only these board member ids are candidates for rules 1-4's Claude+
   * web-search connection discovery, instead of every active board member
   * for the org (up to MAX_BOARD_MEMBERS_PER_RUN). This is the caller-side
   * incremental-scope hook AGENTS_v2.md's AG-23 spec asks for — the actual
   * "which board members need processing" query (no pig_nodes row yet, or
   * updated since their existing node) lives in the caller
   * (worker/autonomous-orchestrator.ts's runRelationshipGraphIncrementalPipeline),
   * not here, so this agent stays a pure "process this scope" function.
   * Rules 5-8 (org-level) and the corporate_intent_signals seed are
   * unaffected by this param — they always run once per invocation
   * regardless of board member scope, matching the existing code below.
   */
  override async run(
    triggerSource: TriggerSource,
    boardMemberIds?: string[],
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    let boardMembersAnalyzed = 0;
    let connectionsFound = 0;
    let directConnections = 0;
    let oneHopConnections = 0;

    try {
      let boardQuery = this.supabase
        .from("board_members")
        .select("id, name, title, bio")
        .eq("organization_id", this.orgId)
        .eq("is_active", true);
      if (boardMemberIds && boardMemberIds.length > 0) {
        // Scoped run (incremental daily job) — restrict to the caller-
        // resolved candidate set instead of every active board member.
        boardQuery = boardQuery.in("id", boardMemberIds);
      }
      boardQuery = boardQuery.limit(MAX_BOARD_MEMBERS_PER_RUN);

      const [boardRes, funderRes, prospectRes] = await Promise.all([
        boardQuery,
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

      // Rules 5-8 (below) don't depend on board members existing, so an
      // empty board no longer short-circuits the whole run — this loop
      // (rules 1-4) simply does zero iterations in that case.
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

      // Phase 2 rules 5-8 — org-level, run once per invocation regardless
      // of board member count (see file header for the schema findings
      // behind each rule's implementation).
      let givingCycleMatches = 0;
      let assetCompatibleMatches = 0;
      let geographicMatches = 0;
      let boardNetworkMatches = 0;
      let corporateIntentNodesSeeded = 0;

      const org = await this.loadOrg();
      if (org) {
        try {
          const orgNodeId = await ensurePigNode(
            this.supabase,
            "nonprofit",
            "organizations",
            org.id,
            org.name,
          );

          givingCycleMatches = await this.runGivingCycleRule(
            runId,
            orgNodeId,
            org,
            decisions,
            errors,
          );
          assetCompatibleMatches = await this.runAssetCompatibilityRule(
            runId,
            orgNodeId,
            org,
            decisions,
            errors,
          );
          geographicMatches = await this.runGeographicGivingRule(
            runId,
            orgNodeId,
            org,
            decisions,
            errors,
          );
          boardNetworkMatches = await this.runBoardNetworkOverlapRule(
            runId,
            orgNodeId,
            decisions,
            errors,
          );
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Phase 2 relationship discovery rules failed.";
          errors.push(`phase 2 rules: ${message}`);
        }
      } else {
        errors.push(`phase 2 rules: could not load organization ${this.orgId} - skipped.`);
      }

      corporateIntentNodesSeeded = await this.seedCorporateIntentSignalNodes(errors);

      const phase2EdgesWritten =
        givingCycleMatches + assetCompatibleMatches + geographicMatches + boardNetworkMatches;

      const summary = {
        boardMembersAnalyzed,
        connectionsFound,
        directConnections,
        oneHopConnections,
        givingCycleMatches,
        assetCompatibleMatches,
        geographicMatches,
        boardNetworkMatches,
        corporateIntentNodesSeeded,
      };

      const totalItemsFound = boardMembers.length + phase2EdgesWritten;
      const totalItemsProcessed = boardMembersAnalyzed + phase2EdgesWritten;
      const totalItemsQueued = connectionsFound + phase2EdgesWritten;

      await this.completeRun(runId, {
        outputSummary: JSON.stringify(summary),
        itemsFound: totalItemsFound,
        itemsProcessed: totalItemsProcessed,
        itemsQueued: totalItemsQueued,
      });

      return {
        success: true,
        itemsFound: totalItemsFound,
        itemsProcessed: totalItemsProcessed,
        itemsQueued: totalItemsQueued,
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
