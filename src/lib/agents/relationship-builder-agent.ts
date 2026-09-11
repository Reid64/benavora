// Relationship Builder Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 4
// (Autonomous Relationship Builder), AGENTS_v2.md AG-19.
//
// Phase A: nightly, per-funder pass that scores the funder relationship, then
// (above the auto-draft threshold, reused here as the relationship-
// recommendation floor) asks Claude for one specific engagement
// recommendation and logs the decision (migration 080 infrastructure:
// agent_runs, agent_decisions, org_autonomous_config).
//
// CONSOLIDATED onto the canonical event-sourced formula in
// src/lib/intelligence/relationship-scorer.ts (see BEHAVIORAL_CONTRACTS.md's
// "Relationship Scoring" contract). This phase used to compute its own score
// from relationship_memory recency/volume + award history — a completely
// different input and formula than both the canonical scorer (event-sourced
// over funder_relationship_events, read by the live /funders/[id]/
// relationship UI route) and funder-relationship.ts's Agent 23 (also now
// consolidated onto the same canonical scorer). relationship_memory is still
// fetched here, but only as narrative context for the Claude recommendation
// prompt below — it no longer feeds the score itself.
//
// funder_relationship_scores predates this agent and has no local migration
// file for its current shape; it was extended directly against prod twice
// (migration 139's header documents both column families). This agent
// upserts both: relationship_score/trend (Funder Relationship Agent's/the
// Funders UI's family) and score/events (this agent's own original family),
// writing the identical canonical value into both so no reader of this table
// can see two different scores for the same funder.
//
// relationship_memory and relationship_recommendations (migration 076) do
// use org_id, matching both SCHEMA_REGISTRY_v2.md and the reputation agent
// (src/lib/intelligence/reputation-agent.ts), which already writes
// relationship_memory rows this agent reads.
//
// --- Phase B (new): multi-hop warm-introduction path generation -----------
//
// Real-schema deviations from the task's literal wording, verified against
// the live migrations before writing this phase (src/supabase/migrations/),
// matching this codebase's established convention of documenting
// task-wording vs. actual-schema differences (see
// relationship-graph-builder-agent.ts's header for the same pattern applied
// to AG-32):
//
//   - `intelligence_relationship_nodes` does not exist anywhere in
//     src/supabase/migrations/ or supabase/migrations/ (confirmed by a
//     repo-wide search before writing this file). SCHEMA_REGISTRY_v2.md does
//     not describe it either. The task's own "if table exists" qualifier for
//     step 2 (board member research) is honored by always falling back to
//     `agent_decisions`, since the table never exists in this build.
//   - "KB leadership_board array" does not exist — there is no
//     `leadership_board` value in the `knowledge_base_category` enum
//     (migration 001) and no such jsonb array on any table. Real board data
//     lives in the `board_members` table — its real, live columns are
//     organization_id/name/title/bio/email/phone/start_date/is_active
//     (root supabase/migrations/001_initial_schema.sql, the table that's
//     actually live), NOT the org_id/role/expertise/active set
//     078_forecast_board.sql describes (that migration was never applied —
//     the identical stale-citation bug already found and fixed in
//     relationship-graph-builder-agent.ts/AG-32 2026-08-07; this file made
//     the same mistake independently and is fixed here the same way).
//   - AG-32 (relationship-graph-builder-agent.ts) already runs a bounded
//     Claude + web_search pass per board member to discover direct/one_hop
//     connections to named funders/prospects, and writes them as pig_edges
//     rows. Re-running that same expensive web-search discovery here (as the
//     task's step 2 literally describes) would duplicate AG-32's own Claude
//     spend for near-identical output. Phase B instead *consumes* the graph
//     AG-32 already builds — traversing pig_edges up to 3 hops from each
//     board member's pig_node to find paths to this org's funders — and adds
//     the capability AG-32 does not have: named funder-officer research
//     (bounded, Claude + web_search, only for funders a path was already
//     found to), specific introduction scripts, priority ranking, and a real
//     action queue with a follow-up reminder. This is a deliberate
//     architecture split: AG-32 owns "discover and write graph edges,"
//     Phase B here owns "traverse the graph and turn it into a ranked,
//     actionable outreach queue."
//   - `corporate_intent_signals` (task's funder_readiness_score source) is
//     real (src/supabase/migrations/093_donor_intent_engine.sql): org_id,
//     company_name, intent_score (0-100). It is keyed by company_name text,
//     not a funder FK, so funder readiness below matches by
//     `company_name ILIKE funder.name` — best-effort, defaults to the
//     Behavioral-Contracts-§25 midpoint (0.5) when no signal is on file.
//   - "insert into a notifications record" — this schema has no
//     `notifications` table (see autonomous-base.ts's own header note);
//     in-app notices live in `alerts`, written via the base class's
//     createNotification(). The "14-day follow-up reminder" is a real
//     `deadlines` row (deadline_type = 'follow_up_date',
//     application_id/opportunity_id both left null — both nullable per
//     schema, and neither applies to an introduction-path action).
//   - Chaining to `ag-digest` (AutonomousDigestAgent's real agentId, per its
//     own `super(orgId, "ag-digest", supabase)` call) is written exactly as
//     AG-17→AG-15→AG-06's existing chain calls are: a real
//     queueChainedAgent() call that is currently unreachable because
//     worker/autonomous-orchestrator.ts's routeQueueItem() switch has no
//     case for 'ag-digest' (AGENTS_v2.md §1.3's documented, accepted gap —
//     forward-defensive code, not dead code masquerading as working).
//   - This agent's own agent_type literal, 'ag-19-relationship', was never
//     added to the agent_type enum (AGENTS_v2.md §1.2) — every run has
//     failed at startRun() before Phase A's per-funder loop ever executed.
//     Migration 096 adds it, following the same one-migration-per-
//     newly-wired-agent convention every other AutonomousAgent upgrade in
//     this history used (085, 086, 088, 090, 091, 092, 093).
//   - Phase B is gated on org_autonomous_config.auto_relationship_enabled
//     (already defined in OrgAutonomousConfig, already false by default, but
//     never actually read anywhere in this codebase before now) since it is
//     the one phase in this file with real external Claude spend beyond
//     Phase A's existing per-funder recommendation calls. Phase A's existing
//     threshold-only gating is unchanged.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import {
  callClaude,
  callClaudeWithWebSearch,
  DEFAULT_MODEL,
} from "@/lib/ai/claude";
import {
  computeRelationshipScore,
  type RelationshipMomentum,
} from "@/lib/intelligence/relationship-scorer";

// Matches AutonomousAgent's own TriggerSource exactly (autonomous-base.ts) —
// must include "event" since worker/autonomous-orchestrator.ts's
// feature.relationship_builder_v2 queue path calls run("event").
type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

type Momentum = RelationshipMomentum;
type StoredTrend = "rising" | "falling" | "neutral";
type HopCount = 1 | 2 | 3;

const RECENT_MEMORY_LIMIT = 10;
const MEMORY_FOR_PROMPT = 5;

// Phase B tuning — mirrors the sampling/bounding conventions already
// established by AG-18 (REPUTATION_SAMPLE_SIZE=5) and AG-32
// (MAX_BOARD_MEMBERS_PER_RUN=10) for other expensive, external-search-driven
// nightly steps.
const MAX_BOARD_MEMBERS_FOR_PATHFINDING = 10;
const MAX_HOPS = 3;
const MAX_EDGES_PER_HOP_QUERY = 500;
const MAX_FUNDER_OFFICER_LOOKUPS = 5;
const HIGH_PRIORITY_THRESHOLD = 0.6;
const MIN_HIGH_PRIORITY_FOR_DIGEST_CHAIN = 3;
const FOLLOWUP_DAYS = 14;
const INSUFFICIENT_DATA_MIDPOINT = 0.5; // Behavioral Contracts §25 convention

const PATH_STRENGTH_BY_HOP: Record<HopCount, number> = {
  1: 0.95,
  2: 0.7,
  3: 0.45,
};

interface FunderRow {
  id: string;
  name: string;
}

interface MemoryRow {
  memory_type: string;
  content: string;
  signal_date: string | null;
  created_at: string;
}

interface RecommendationResult {
  recommendation: string;
  urgency: "urgent" | "normal" | "low";
  reasoning: string;
}

interface BoardMemberRow {
  id: string;
  name: string;
  title: string | null;
}

interface PigEdgeRow {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: string;
  evidence: string | null;
}

interface IntroductionPathResult {
  memberId: string;
  memberName: string;
  funder: FunderRow;
  hopCount: HopCount;
  /** pig_nodes ids of every mutual connection strictly between the board
   * member and the funder — empty for a direct (1-hop) path. */
  intermediateNodeIds: string[];
  edgeEvidence: string[];
}

interface RankedIntroductionPath extends IntroductionPathResult {
  pathStrength: number;
  funderReadiness: number;
  opportunityValue: number;
  priorityScore: number;
  matchedOfficerName: string | null;
}

/** Maps this agent's rising/declining/stable onto the trend column's
 * existing rising/falling/neutral vocabulary (see file header). */
function momentumToTrend(momentum: Momentum): StoredTrend {
  if (momentum === "rising") return "rising";
  if (momentum === "declining") return "falling";
  return "neutral";
}

function buildRecommendationPrompt(
  funderName: string,
  score: number,
  momentum: Momentum,
  memories: MemoryRow[],
): { system: string; prompt: string } {
  const system =
    'You are a nonprofit relationship strategist. Return JSON only: ' +
    '{ recommendation: string, urgency: "urgent"|"normal"|"low", reasoning: string }';

  const memoryLines =
    memories.length > 0
      ? memories
          .slice(0, MEMORY_FOR_PROMPT)
          .map((m) => {
            const date = m.signal_date ?? m.created_at.slice(0, 10);
            return `- [${m.memory_type}] ${date}: ${m.content}`;
          })
          .join("\n")
      : "(no recorded interactions)";

  const prompt = [
    `Funder: ${funderName}`,
    `Relationship score: ${score}`,
    `Momentum: ${momentum}`,
    "",
    "Recent interaction history:",
    memoryLines,
    "",
    "Recommend one specific next action. Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}

/** Tolerant JSON extraction — mirrors parseClassification in
 * src/lib/intelligence/reputation-agent.ts. Returns null on any
 * unreadable/malformed response rather than risking a garbage
 * recommendation. */
function parseRecommendation(text: string): RecommendationResult | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  const obj = (raw ?? {}) as {
    recommendation?: unknown;
    urgency?: unknown;
    reasoning?: unknown;
  };

  const recommendation =
    typeof obj.recommendation === "string" ? obj.recommendation.trim() : "";
  if (!recommendation) return null;

  const urgencyRaw =
    typeof obj.urgency === "string" ? obj.urgency.toLowerCase() : "";
  const urgency: RecommendationResult["urgency"] =
    urgencyRaw === "urgent" || urgencyRaw === "low" ? urgencyRaw : "normal";

  const reasoning =
    typeof obj.reasoning === "string" ? obj.reasoning.trim() : "";

  return { recommendation, urgency, reasoning };
}

// ---------------------------------------------------------------------------
// Phase B helpers
// ---------------------------------------------------------------------------

/** Upserts a pig_nodes row for a real entity row and returns its id.
 * pig_nodes has UNIQUE(entity_table, entity_id), so this is idempotent
 * across repeated runs. Mirrors relationship-graph-builder-agent.ts's own
 * ensurePigNode — duplicated locally rather than shared since neither file
 * exports it and this codebase's convention is per-agent-file self
 * containment (see that file's own header). */
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

/** Loads every pig_edges row touching any of the given node ids — one query
 * per BFS level rather than per node, bounded to MAX_EDGES_PER_HOP_QUERY.
 * Treats the graph as undirected (a warm introduction works regardless of
 * which side of the edge is "source"). */
async function loadEdgesTouching(
  supabase: SupabaseClient,
  nodeIds: string[],
): Promise<PigEdgeRow[]> {
  if (nodeIds.length === 0) return [];
  const idList = nodeIds.join(",");
  const { data, error } = await supabase
    .from("pig_edges")
    .select("id, source_node_id, target_node_id, relationship_type, evidence")
    .or(`source_node_id.in.(${idList}),target_node_id.in.(${idList})`)
    .limit(MAX_EDGES_PER_HOP_QUERY);

  if (error) return [];
  return (data ?? []) as PigEdgeRow[];
}

/**
 * Breadth-first traversal of the real pig_nodes/pig_edges graph (populated
 * by relationship-graph-builder-agent.ts and this org's own funder nodes,
 * ensured below), up to MAX_HOPS deep, from each board member's node to any
 * of this org's funder nodes. BFS guarantees the first path found to a given
 * funder is the shortest, so hopCount directly maps to the task's
 * direct(1)/one_hop(2)/two_hop(3) vocabulary.
 */
async function findIntroductionPaths(
  supabase: SupabaseClient,
  members: Array<{ memberId: string; memberName: string; nodeId: string }>,
  funderNodeIndex: Map<string, FunderRow>,
): Promise<IntroductionPathResult[]> {
  const results: IntroductionPathResult[] = [];

  for (const member of members) {
    const visited = new Set<string>([member.nodeId]);
    const foundFunderNodeIds = new Set<string>();
    let frontier: Array<{
      nodeId: string;
      pathNodeIds: string[];
      evidence: string[];
    }> = [{ nodeId: member.nodeId, pathNodeIds: [], evidence: [] }];

    for (let hop = 1; hop <= MAX_HOPS && frontier.length > 0; hop++) {
      const frontierIds = frontier.map((f) => f.nodeId);
      const edges = await loadEdgesTouching(supabase, frontierIds);
      const nextFrontier: typeof frontier = [];

      for (const f of frontier) {
        const touching = edges.filter(
          (e) => e.source_node_id === f.nodeId || e.target_node_id === f.nodeId,
        );

        for (const edge of touching) {
          const neighborId =
            edge.source_node_id === f.nodeId
              ? edge.target_node_id
              : edge.source_node_id;
          if (visited.has(neighborId)) continue;

          const evidence = [
            ...f.evidence,
            edge.evidence ?? edge.relationship_type,
          ].filter((v): v is string => Boolean(v));

          const funder = funderNodeIndex.get(neighborId);
          if (funder && !foundFunderNodeIds.has(neighborId)) {
            foundFunderNodeIds.add(neighborId);
            results.push({
              memberId: member.memberId,
              memberName: member.memberName,
              funder,
              hopCount: hop as HopCount,
              intermediateNodeIds: f.pathNodeIds,
              edgeEvidence: evidence,
            });
            continue;
          }

          visited.add(neighborId);
          nextFrontier.push({
            nodeId: neighborId,
            pathNodeIds: [...f.pathNodeIds, neighborId],
            evidence,
          });
        }
      }
      frontier = nextFrontier;
    }
  }

  return results;
}

/** Keeps only the shortest (strongest) path per funder across all board
 * members, so the action queue never surfaces two redundant paths to the
 * same funder in one run. */
function dedupeBestPathPerFunder(
  paths: IntroductionPathResult[],
): IntroductionPathResult[] {
  const best = new Map<string, IntroductionPathResult>();
  for (const p of paths) {
    const existing = best.get(p.funder.id);
    if (!existing || p.hopCount < existing.hopCount) {
      best.set(p.funder.id, p);
    }
  }
  return Array.from(best.values());
}

async function loadNodeLabels(
  supabase: SupabaseClient,
  nodeIds: string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(nodeIds));
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from("pig_nodes")
    .select("id, label")
    .in("id", unique);

  if (error) return new Map();
  return new Map(
    ((data ?? []) as Array<{ id: string; label: string }>).map((n) => [
      n.id,
      n.label,
    ]),
  );
}

function buildOfficerResearchPrompt(funderName: string): {
  system: string;
  prompt: string;
} {
  const system = [
    "You are a nonprofit relationship-intelligence researcher. Use web search",
    "to identify the current program officer(s) and/or board of directors",
    "for the named funder. Return ONLY a JSON array of full names, no prose:",
    '["Jane Smith", "John Doe"]. Return an empty array [] if nothing',
    "verifiable is found. Never invent a name.",
  ].join("\n");

  const prompt = [
    `Funder: ${funderName}`,
    `Search: "${funderName} program officer board of directors"`,
    `Search: "${funderName} grants manager leadership team"`,
    "Return ONLY the JSON array of names described in the system prompt.",
  ].join("\n");

  return { system, prompt };
}

/** Tolerant JSON-array-of-strings extraction — same tolerant-parse pattern
 * as parseRecommendation above and parseConnections in
 * relationship-graph-builder-agent.ts, adapted for a plain string array. */
function parseNameArray(text: string): string[] {
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

  return raw
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
}

/** funder_readiness_score, per the task's priority formula: latest
 * corporate_intent_signals.intent_score for a company_name match, rescaled
 * to 0-1. Defaults to the insufficient-data midpoint (0.5) when the table
 * has no signal for this funder — the table is real (migration 093) but is
 * keyed to corporate donor prospects, so most foundation-style funders will
 * have no row and fall back to the midpoint by design. */
async function computeFunderReadiness(
  supabase: SupabaseClient,
  orgId: string,
  funderName: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("corporate_intent_signals")
    .select("intent_score")
    .eq("org_id", orgId)
    .ilike("company_name", `%${funderName}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return INSUFFICIENT_DATA_MIDPOINT;
  const score = (data as { intent_score: number | null }).intent_score;
  return typeof score === "number"
    ? Math.max(0, Math.min(100, score)) / 100
    : INSUFFICIENT_DATA_MIDPOINT;
}

/** opportunity_value_score, per the task's priority formula: highest
 * eligibility_score among this funder's open opportunities, rescaled to
 * 0-1. Defaults to the insufficient-data midpoint when no open opportunity
 * is on file yet — a missing opportunity isn't evidence the funder is a bad
 * target, just that discovery hasn't found one for them. */
async function computeOpportunityValue(
  supabase: SupabaseClient,
  orgId: string,
  funderId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("opportunities")
    .select("eligibility_score")
    .eq("organization_id", orgId)
    .eq("funder_id", funderId)
    .eq("status", "open")
    .order("eligibility_score", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return INSUFFICIENT_DATA_MIDPOINT;
  const score = (data as { eligibility_score: number | null })
    .eligibility_score;
  return typeof score === "number"
    ? Math.max(0, Math.min(100, score)) / 100
    : INSUFFICIENT_DATA_MIDPOINT;
}

/** Builds the specific introduction script + email starter per the task's
 * step 4 templates. Deterministic (no extra Claude call) — the specificity
 * the task asks for comes from the real names/evidence already gathered by
 * the graph traversal and officer research above, not from further
 * generation, keeping Phase B's Claude spend bounded to officer research. */
function buildIntroductionScript(params: {
  memberName: string;
  funderName: string;
  hopCount: HopCount;
  intermediateLabels: string[];
  edgeEvidence: string[];
  matchedOfficerName: string | null;
}): { script: string; emailSubject: string; emailOpeningLine: string } {
  const {
    memberName,
    funderName,
    hopCount,
    intermediateLabels,
    edgeEvidence,
    matchedOfficerName,
  } = params;
  const evidenceSuffix = edgeEvidence[0] ? ` Evidence: ${edgeEvidence[0]}` : "";

  if (hopCount === 1) {
    const officerClause = matchedOfficerName
      ? ` Program Officer ${matchedOfficerName}`
      : "";
    const script =
      `Board member ${memberName} has a direct relationship with ${funderName}` +
      `${officerClause}. Recommend ${memberName} send a personal email ` +
      `introducing the organization.${evidenceSuffix}`;
    return {
      script,
      emailSubject: `Introduction: ${memberName} <> ${funderName}`,
      emailOpeningLine: `Hi${matchedOfficerName ? ` ${matchedOfficerName}` : ""}, ${memberName} suggested I reach out given your work with ${funderName}.`,
    };
  }

  const mutualLabel = intermediateLabels[0] ?? "a mutual connection";
  const chain = [memberName, ...intermediateLabels, funderName].join(" → ");
  const officerClause = matchedOfficerName
    ? ` (likely reaching ${matchedOfficerName})`
    : "";
  const script =
    `${chain}${officerClause}. Recommend asking ${memberName} to request an ` +
    `introduction through ${mutualLabel}.${evidenceSuffix}`;
  return {
    script,
    emailSubject: `Warm introduction request via ${mutualLabel}`,
    emailOpeningLine: `Hi ${mutualLabel}, ${memberName} mentioned you might be able to connect us with ${funderName}.`,
  };
}

function addDaysISODate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Real `deadlines` row (deadline_type='follow_up_date') 14 days out — the
 * schema-accurate stand-in for the task's "notifications record ... with a
 * 14-day follow-up reminder" (see file header: this schema has no
 * notifications table). */
async function queueFollowUpDeadline(
  supabase: SupabaseClient,
  orgId: string,
  funderName: string,
  script: string,
  emailSubject: string,
): Promise<boolean> {
  const { error } = await supabase.from("deadlines").insert({
    organization_id: orgId,
    application_id: null,
    opportunity_id: null,
    deadline_type: "follow_up_date",
    due_date: addDaysISODate(FOLLOWUP_DAYS),
    title: `Follow up: introduction path to ${funderName}`,
    description: `${emailSubject} — ${script}`,
  });
  return !error;
}

export class RelationshipBuilderAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-19-relationship", supabase);
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    let fundersAnalyzed = 0;
    let scoresUpdated = 0;
    let recommendationsGenerated = 0;
    let skippedLowPriority = 0;

    try {
      const { data: funderRows, error: fundersError } = await this.supabase
        .from("funders")
        .select("id, name")
        .eq("organization_id", this.orgId);

      if (fundersError) {
        throw new Error(`Failed to load funders: ${fundersError.message}`);
      }

      const funders = (funderRows ?? []) as FunderRow[];
      const config = await this.getOrgConfig();
      const threshold = config.auto_draft_threshold;

      // ---- Phase A: deterministic scoring + engagement recommendation ----
      for (const funder of funders) {
        fundersAnalyzed++;

        try {
          const { data: memoryRows, error: memoriesError } = await this.supabase
            .from("relationship_memory")
            .select("memory_type, content, signal_date, created_at")
            .eq("org_id", this.orgId)
            .eq("entity_id", funder.id)
            .eq("entity_type", "funder")
            .order("created_at", { ascending: false })
            .limit(RECENT_MEMORY_LIMIT);

          if (memoriesError) {
            throw new Error(
              `Failed to load relationship memory: ${memoriesError.message}`,
            );
          }

          // relationship_memory is narrative context for the Claude
          // recommendation prompt below only — the score itself comes from
          // the canonical event-sourced scorer (see file header).
          const memories = (memoryRows ?? []) as MemoryRow[];

          const { score: newScore, momentum } = await computeRelationshipScore(
            funder.id,
            this.orgId,
            this.supabase,
          );

          const trend = momentumToTrend(momentum);

          const { error: upsertError } = await this.supabase
            .from("funder_relationship_scores")
            .upsert(
              {
                organization_id: this.orgId,
                funder_id: funder.id,
                // This agent's own original column family.
                score: newScore,
                events: { trend, momentum },
                last_updated_at: new Date().toISOString(),
                // Funder Relationship Agent's/the Funders UI's column
                // family — kept in sync so no reader of this table can see
                // two different scores for the same funder.
                relationship_score: newScore,
                trend,
              },
              { onConflict: "organization_id,funder_id" },
            );

          if (upsertError) {
            throw new Error(
              `Failed to upsert relationship score: ${upsertError.message}`,
            );
          }
          scoresUpdated++;

          if (newScore < threshold) {
            skippedLowPriority++;
            decisions.push(
              await this.logDecision({
                decisionType: "relationship_recommendation_generated",
                agentRunId: runId,
                entityType: "funder",
                entityId: funder.id,
                reasoning:
                  `Score ${newScore} (${momentum}). Below relationship-recommendation ` +
                  `threshold ${threshold} — skipped Claude call.`,
                confidenceScore: newScore,
                actionTaken: "score_updated_low_priority_skipped",
              }),
            );
            continue;
          }

          const { data: pendingRec } = await this.supabase
            .from("relationship_recommendations")
            .select("id")
            .eq("org_id", this.orgId)
            .eq("entity_id", funder.id)
            .eq("status", "pending")
            .maybeSingle();

          if (pendingRec) continue;

          const { system, prompt } = buildRecommendationPrompt(
            funder.name,
            newScore,
            momentum,
            memories,
          );

          const response = await callClaude({
            system,
            prompt,
            model: DEFAULT_MODEL,
            maxTokens: 300,
          });
          const parsed = parseRecommendation(response.text);
          if (!parsed) {
            errors.push(
              `funder ${funder.id}: unparseable recommendation response.`,
            );
            continue;
          }

          const { error: insertError } = await this.supabase
            .from("relationship_recommendations")
            .insert({
              org_id: this.orgId,
              entity_id: funder.id,
              entity_type: "funder",
              recommendation_text: parsed.recommendation,
              urgency: parsed.urgency,
              status: "pending",
            });

          if (insertError) {
            throw new Error(
              `Failed to insert recommendation: ${insertError.message}`,
            );
          }
          recommendationsGenerated++;

          decisions.push(
            await this.logDecision({
              decisionType: "relationship_recommendation_generated",
              agentRunId: runId,
              entityType: "funder",
              entityId: funder.id,
              reasoning: `Score ${newScore} (${momentum}). ${parsed.reasoning}`,
              confidenceScore: newScore,
              actionTaken: "inserted_recommendation",
            }),
          );
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to process funder relationship.";
          errors.push(`funder ${funder.id}: ${message}`);
        }
      }

      // ---- Phase B: multi-hop introduction path generation --------------
      let pathsFound = 0;
      let highPriorityPathsQueued = 0;

      if (config.auto_relationship_enabled) {
        try {
          const { data: boardRows, error: boardError } = await this.supabase
            .from("board_members")
            .select("id, name, title")
            .eq("organization_id", this.orgId)
            .eq("is_active", true)
            .limit(MAX_BOARD_MEMBERS_FOR_PATHFINDING);

          if (boardError) {
            throw new Error(
              `Failed to load board members: ${boardError.message}`,
            );
          }
          const boardMembers = (boardRows ?? []) as BoardMemberRow[];

          if (boardMembers.length > 0 && funders.length > 0) {
            const memberNodeEntries = await Promise.all(
              boardMembers.map(async (m) => ({
                memberId: m.id,
                memberName: m.name,
                nodeId: await ensurePigNode(
                  this.supabase,
                  "person",
                  "board_members",
                  m.id,
                  m.name,
                ),
              })),
            );

            const funderNodeEntries = await Promise.all(
              funders.map(async (funder) => ({
                funder,
                nodeId: await ensurePigNode(
                  this.supabase,
                  "funder",
                  "funders",
                  funder.id,
                  funder.name,
                ),
              })),
            );
            const funderNodeIndex = new Map<string, FunderRow>();
            for (const entry of funderNodeEntries) {
              funderNodeIndex.set(entry.nodeId, entry.funder);
            }

            const rawPaths = await findIntroductionPaths(
              this.supabase,
              memberNodeEntries,
              funderNodeIndex,
            );
            const paths = dedupeBestPathPerFunder(rawPaths);
            pathsFound = paths.length;

            const labelMap = await loadNodeLabels(
              this.supabase,
              paths.flatMap((p) => p.intermediateNodeIds),
            );

            // Funder-officer research — bounded to the shortest (strongest)
            // paths found, since a specific officer name is most actionable
            // when a path to that funder already exists.
            const officerLookupTargets = [...paths]
              .sort((a, b) => a.hopCount - b.hopCount)
              .slice(0, MAX_FUNDER_OFFICER_LOOKUPS);
            const officerNamesByFunderId = new Map<string, string[]>();

            for (const target of officerLookupTargets) {
              try {
                const { system, prompt } = buildOfficerResearchPrompt(
                  target.funder.name,
                );
                const response = await callClaudeWithWebSearch({
                  system,
                  prompt,
                  model: DEFAULT_MODEL,
                  maxTokens: 400,
                  maxSearches: 3,
                });
                const officerNames = parseNameArray(response.text);
                officerNamesByFunderId.set(target.funder.id, officerNames);

                decisions.push(
                  await this.logDecision({
                    decisionType: "funder_officer_researched",
                    agentRunId: runId,
                    entityType: "funder",
                    entityId: target.funder.id,
                    reasoning:
                      officerNames.length > 0
                        ? `Identified ${officerNames.length} potential decision-maker(s) via web search.`
                        : "Web search found no verifiable program officer / board names.",
                    confidenceScore: officerNames.length > 0 ? 65 : 30,
                    actionTaken: "researched_funder_officers",
                    actionPayload: { officerNames },
                  }),
                );
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : "Officer research failed.";
                errors.push(
                  `funder ${target.funder.id} officer research: ${message}`,
                );
              }
            }

            // Rank every path by path_strength * funder_readiness *
            // opportunity_value, per the task's priority formula.
            const ranked: RankedIntroductionPath[] = [];
            for (const p of paths) {
              const [funderReadiness, opportunityValue] = await Promise.all([
                computeFunderReadiness(this.supabase, this.orgId, p.funder.name),
                computeOpportunityValue(this.supabase, this.orgId, p.funder.id),
              ]);
              const pathStrength = PATH_STRENGTH_BY_HOP[p.hopCount];
              const priorityScore =
                pathStrength * funderReadiness * opportunityValue;

              const officerNames = officerNamesByFunderId.get(p.funder.id) ?? [];
              const intermediateLabels = p.intermediateNodeIds
                .map((id) => labelMap.get(id))
                .filter((v): v is string => Boolean(v));
              const matchedOfficerName =
                officerNames.find((name) =>
                  intermediateLabels.some((label) =>
                    label.toLowerCase().includes(name.toLowerCase()),
                  ),
                ) ?? null;

              ranked.push({
                ...p,
                pathStrength,
                funderReadiness,
                opportunityValue,
                priorityScore,
                matchedOfficerName,
              });
            }
            ranked.sort((a, b) => b.priorityScore - a.priorityScore);

            // Action queue: priority_score >= 0.6 gets a scripted
            // introduction, an in-app alert, and a 14-day follow-up
            // deadline.
            for (const path of ranked) {
              if (path.priorityScore < HIGH_PRIORITY_THRESHOLD) continue;

              const intermediateLabels = path.intermediateNodeIds
                .map((id) => labelMap.get(id))
                .filter((v): v is string => Boolean(v));

              const { script, emailSubject, emailOpeningLine } =
                buildIntroductionScript({
                  memberName: path.memberName,
                  funderName: path.funder.name,
                  hopCount: path.hopCount,
                  intermediateLabels,
                  edgeEvidence: path.edgeEvidence,
                  matchedOfficerName: path.matchedOfficerName,
                });

              const queued = await queueFollowUpDeadline(
                this.supabase,
                this.orgId,
                path.funder.name,
                script,
                emailSubject,
              );
              if (!queued) {
                errors.push(
                  `funder ${path.funder.id}: failed to queue 14-day follow-up deadline.`,
                );
                continue;
              }

              await this.createNotification(
                "introduction_path",
                `Warm introduction available: ${path.funder.name}`,
                `${script} Suggested subject line: "${emailSubject}" Opening line: "${emailOpeningLine}"`,
              );

              highPriorityPathsQueued++;
              decisions.push(
                await this.logDecision({
                  decisionType: "introduction_path_queued",
                  agentRunId: runId,
                  entityType: "funder",
                  entityId: path.funder.id,
                  reasoning:
                    `priority=${path.priorityScore.toFixed(2)} ` +
                    `(path_strength=${path.pathStrength}, ` +
                    `funder_readiness=${path.funderReadiness}, ` +
                    `opportunity_value=${path.opportunityValue})`,
                  confidenceScore: Math.round(path.priorityScore * 100),
                  actionTaken: script,
                  actionPayload: {
                    memberName: path.memberName,
                    funderName: path.funder.name,
                    hopCount: path.hopCount,
                    emailSubject,
                    emailOpeningLine,
                  },
                  requiredHumanReview: true,
                }),
              );
            }

            if (highPriorityPathsQueued >= MIN_HIGH_PRIORITY_FOR_DIGEST_CHAIN) {
              await this.queueChainedAgent(
                "ag-digest",
                3,
                {
                  reason: "high_priority_introduction_paths",
                  count: highPriorityPathsQueued,
                },
                runId,
              );
            }
          }
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Introduction path generation failed.";
          errors.push(`introduction path generation: ${message}`);
        }
      }

      const summary = {
        fundersAnalyzed,
        scoresUpdated,
        recommendationsGenerated,
        skippedLowPriority,
        pathsFound,
        highPriorityPathsQueued,
      };

      await this.completeRun(runId, {
        outputSummary: JSON.stringify(summary),
        itemsFound: funders.length + pathsFound,
        itemsProcessed: scoresUpdated,
        itemsQueued: recommendationsGenerated + highPriorityPathsQueued,
      });

      return {
        success: true,
        itemsFound: funders.length + pathsFound,
        itemsProcessed: scoresUpdated,
        itemsQueued: recommendationsGenerated + highPriorityPathsQueued,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Relationship builder run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: scoresUpdated,
        itemsQueued: recommendationsGenerated,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
