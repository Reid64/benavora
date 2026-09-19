// AG-29 Knowledge Engine Indexer Agent (AutonomousAgent, migration 080 infra +
// migration 111 enum value + migration 107 embedding columns). Per
// AGENTS_v2.md's AG-29 spec: continuously generates and stores pgvector
// embeddings for intelligence_proposal_sections, outcomes, and
// foundation_directory records that have real text content and a null
// embedding, and separately aggregates knowledge_patterns on a 24-hour
// cadence.
//
// The hard part — real OpenAI embedding generation — already exists and is
// proven (src/lib/intelligence/embeddings.ts's generateEmbeddingsBatch()/
// chunkText(), live-verified: 105/105 intelligence_proposal_sections rows
// already carry genuine, non-null, content-varying 1536-dim vectors). This
// agent calls that library directly; it does not reimplement or modify it.
// The embedding columns on outcomes/foundation_directory (migration 107) and
// the pre-existing one on intelligence_proposal_sections (migration 048)
// were all confirmed live via the PostgREST OpenAPI schema before writing
// this file, not assumed from the migration files alone.
//
// PLATFORM-LEVEL, NOT ORG-SCOPED — same shape as AG-36/AG-38
// (learning-network-aggregator-agent.ts / self-improvement-agent.ts):
// constructor takes only `supabase`, uses a well-known SYSTEM_ORG_ID for
// agent_runs/agent_decisions/agent_queue FK targets, and never filters its
// actual data queries by organization_id. This is the correct shape here:
// intelligence_proposal_sections and foundation_directory are genuinely
// cross-org shared data with no organization_id column at all, and outcomes
// is processed platform-wide regardless of which org recorded it — this
// agent only ever writes a numeric vector back to the source row, it never
// surfaces one org's outcome text to another org.
//
// This is the one agent in AGENTS_v2.md's batch designed for genuine 24/7
// continuous operation, not a periodic schedule (see the AG-29 spec's
// "Trigger design" section, which explicitly rejects a nightly/weekly
// cadence here). worker/knowledge-indexer-processor.ts runs a dedicated poll
// loop (started at worker boot alongside queueProcessor.start()/
// ddRequestProcessor.start(), not a cron entry) that calls run('autonomous')
// repeatedly: 60s sleep when a pass finds nothing to embed, immediate
// re-poll when a pass fills a full EMBEDDING_BATCH_SIZE batch. Event-
// triggered rows (agent_queue, trigger_source='event') are routed here via
// worker/autonomous-orchestrator.ts's routeQueueItem() and given priority
// within the very next batch over the poll's own oldest-pending scan.
//
// Known, deliberate simplification (stated explicitly, not hidden, per the
// spec's own process step 5): when a row's text exceeds one chunk, only the
// FIRST chunk's embedding is stored in that row's single `embedding` column.
// True multi-chunk-per-row storage would need a join table (the pattern
// intelligence_proposal_sections itself already uses at the section level —
// one row per section, not one row per document) — out of scope for
// outcomes/foundation_directory specifically, since neither table is
// naturally pre-split into sections. Flagged for a future session.
//
// Deviation from the spec's literal error-handling text: the spec describes
// "the existing generateEmbedding() retry... reused as-is via
// generateEmbeddingsBatch()" — but generateEmbeddingsBatch() itself has no
// internal retry (only the singular generateEmbedding() does; confirmed by
// reading embeddings.ts, which this task explicitly says not to modify). The
// same 3-attempt/1s-2s-4s-backoff shape is instead applied at this file's own
// call site, around the unmodified generateEmbeddingsBatch() call — not a
// new retry *mechanism*, just applied one layer up from where the spec
// assumed it already lived.
//
// Embedding activity itself is NOT decision-logged per row (would flood
// agent_decisions at routine, high-frequency, low-individual-significance
// volume, per the spec's own Observability section) — agent_runs is the
// audit trail for that (one row per batch pass). Only the once-a-day
// pattern-aggregation pass logs a decision ("patterns_aggregated").
//
// knowledge_patterns has a single `category` column (migration 096), not
// separate funder_category/opportunity_category columns — the spec's
// "aggregates ... by funder_category/opportunity_category" is implemented
// against the one real column that exists (opportunity_category preferred,
// falling back to funder_category), not two columns this schema doesn't
// have. Not fabricating a column to match the spec's prose more literally.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { generateEmbeddingsBatch, chunkText } from "@/lib/intelligence/embeddings";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

/** Well-known system-org row this agent provisions (idempotent, and also
 * seeded directly by migration 111) so it has a real FK target for
 * agent_runs/agent_decisions/agent_queue while running platform-wide and
 * unscoped — same convention as AG-36/AG-38. */
export const SYSTEM_ORG_ID = "00000000-0000-4000-8000-000000000029";
const SYSTEM_ORG_NAME = "Benavora Platform (System - AG-29 Knowledge Indexer)";

/** Spec: "matching generateEmbeddingsBatch()'s own existing 100-per-request
 * design." */
const EMBEDDING_BATCH_SIZE = 100;
/** Spec: "every 24 hours." */
const PATTERN_AGGREGATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Bound on outcomes considered per aggregation pass, mirroring the batch
 * cap already used for embedding itself — keeps a single run's cost and
 * duration predictable regardless of platform growth (same
 * self-imposed-cap convention as AG-10's MAX_FUNDERS_PER_SCHEDULED_RUN /
 * AG-42's MAX_ENTITIES_PER_RUN). */
const MAX_OUTCOMES_PER_AGGREGATION_PASS = 500;
/** Retry shape applied around the (unmodified) generateEmbeddingsBatch()
 * call — see file header's "Deviation from the spec's literal error-
 * handling text" note. */
const EMBEDDING_RETRY_ATTEMPTS = 3;

export type KnowledgeIndexerSourceTable =
  | "intelligence_proposal_sections"
  | "outcomes"
  | "foundation_directory";

interface EmbeddableRow {
  table: KnowledgeIndexerSourceTable;
  id: string;
  text: string;
}

interface EventTriggerPayload {
  table: KnowledgeIndexerSourceTable;
  rowId: string;
}

/** Extends the base result with whether this pass filled a full batch — the
 * poll loop (worker/knowledge-indexer-processor.ts) uses this to decide
 * whether to re-poll immediately (spec: "0 seconds... when the last pass
 * found and processed a full batch") or sleep 60s. */
export interface KnowledgeIndexerRunResult extends AutonomousAgentResult {
  batchWasFull: boolean;
}

function isSourceTable(value: unknown): value is KnowledgeIndexerSourceTable {
  return (
    value === "intelligence_proposal_sections" ||
    value === "outcomes" ||
    value === "foundation_directory"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Flattens foundation_directory's structured fields into plain text for
 * embedding (spec process step 3: "programs (jsonb array) is flattened to
 * plain text first"). `programs` is a real text[] column (migration 058);
 * `enrichment.mission` is named explicitly in the spec's own input contract
 * (`enrichment->>'mission'`) as a real, already-existing jsonb column this
 * agent should read defensively. Returns null (never a placeholder string)
 * when no source has real content.
 *
 * AR-14.1: neither of the above has ever been populated by any writer in
 * this codebase (test-evidence/DATA_PIPELINE_AUDIT.md §1) — every one of
 * 133,812 rows had `programs IS NULL` and no `enrichment.mission` key,
 * which is why this agent found 0 indexable rows on every one of its
 * ~64,000 lifetime runs. The field every enrichment writer actually
 * populates — confirmed live, 133,811/133,812 rows — is
 * `enrichment.propublica` (name/city/state/ntee_code/subsection_code/
 * totrevenue/totassetsend/totfuncexpns, from `enrich-foundations-propublica.ts`
 * / `enrich-foundations-990.ts`). That block is synthesized into one plain-
 * text filing summary as a fallback so these rows finally carry real,
 * substantive content to embed instead of being permanently unindexable. */
function flattenFoundationText(row: {
  programs: string[] | null;
  enrichment: Record<string, unknown> | null;
}): string | null {
  const parts: string[] = [];
  const enrichment =
    row.enrichment && typeof row.enrichment === "object"
      ? (row.enrichment as Record<string, unknown>)
      : null;

  if (row.programs && row.programs.length > 0) {
    parts.push(row.programs.filter((p) => p && p.trim()).join(". "));
  }
  const mission = enrichment?.["mission"];
  if (typeof mission === "string" && mission.trim()) parts.push(mission.trim());

  if (parts.length === 0) {
    const propublicaText = flattenPropublicaText(enrichment?.["propublica"]);
    if (propublicaText) parts.push(propublicaText);
  }

  const joined = parts.join(" ").trim();
  return joined.length > 0 ? joined : null;
}

/** Synthesizes a plain-text Form 990 filing summary from
 * `enrichment.propublica` — the one enrichment block that is actually
 * populated on essentially every `foundation_directory` row (see
 * `flattenFoundationText()`'s doc comment). Returns null when the block is
 * missing or carries no usable fields (defensive: enrichment writers may
 * legitimately produce a partial record). */
function flattenPropublicaText(propublica: unknown): string | null {
  if (!propublica || typeof propublica !== "object") return null;
  const p = propublica as Record<string, unknown>;

  const name = typeof p["name"] === "string" && p["name"].trim() ? p["name"].trim() : null;
  const city = typeof p["city"] === "string" && p["city"].trim() ? p["city"].trim() : null;
  const state = typeof p["state"] === "string" && p["state"].trim() ? p["state"].trim() : null;
  const nteeCode =
    typeof p["ntee_code"] === "string" && p["ntee_code"].trim() ? p["ntee_code"].trim() : null;
  const subsectionCode =
    typeof p["subsection_code"] === "number" || typeof p["subsection_code"] === "string"
      ? String(p["subsection_code"])
      : null;
  const totRevenue = typeof p["totrevenue"] === "number" ? p["totrevenue"] : null;
  const totAssets = typeof p["totassetsend"] === "number" ? p["totassetsend"] : null;
  const totExpenses = typeof p["totfuncexpns"] === "number" ? p["totfuncexpns"] : null;

  const sentences: string[] = [];
  if (name) {
    const location = city && state ? ` (${city}, ${state})` : "";
    const subsection = subsectionCode ? ` filed under IRS subsection ${subsectionCode}` : "";
    const ntee = nteeCode ? `, NTEE code ${nteeCode}` : "";
    sentences.push(`${name}${location} is a tax-exempt organization${subsection}${ntee}.`);
  }
  const financials: string[] = [];
  if (totRevenue !== null) financials.push(`total revenue $${totRevenue.toLocaleString("en-US")}`);
  if (totAssets !== null) financials.push(`total assets $${totAssets.toLocaleString("en-US")}`);
  if (totExpenses !== null)
    financials.push(`total functional expenses $${totExpenses.toLocaleString("en-US")}`);
  if (financials.length > 0) {
    sentences.push(`Most recent Form 990 filing reports ${financials.join(", ")}.`);
  }

  return sentences.length > 0 ? sentences.join(" ") : null;
}

/** Concatenates outcomes' three possible text fields with clear section
 * labels (spec process step 3: "concatenated with clear section labels so
 * the resulting embedding represents the whole outcome, not just one field
 * arbitrarily"). Returns null when none of the three fields have real
 * content. */
function flattenOutcomeText(row: {
  narrative_snapshot: string | null;
  funder_feedback: string | null;
  denial_reason: string | null;
}): string | null {
  const parts: string[] = [];
  if (row.narrative_snapshot?.trim()) {
    parts.push(`Narrative: ${row.narrative_snapshot.trim()}`);
  }
  if (row.funder_feedback?.trim()) {
    parts.push(`Funder feedback: ${row.funder_feedback.trim()}`);
  }
  if (row.denial_reason?.trim()) {
    parts.push(`Denial reason: ${row.denial_reason.trim()}`);
  }
  const joined = parts.join("\n").trim();
  return joined.length > 0 ? joined : null;
}

/**
 * Enqueues an event-triggered agent_queue row for this agent — the primary
 * trigger per the spec's design, reusing the same agent_queue infrastructure
 * FollowupGeneratorAgent (AG-28) and GrantDnaAgent (AG-10) already use for
 * their own event-driven designs, not a new mechanism.
 *
 * `orgId` defaults to SYSTEM_ORG_ID for service-role callers (e.g. ingestion
 * scripts, agent code — RLS does not apply there). A caller running under a
 * user session (RLS-bound client, e.g. a browser-triggered API route) must
 * pass its own real organization_id instead, since agent_queue's RLS policy
 * requires org_id to match the caller's own profile — routeQueueItem()'s
 * 'ag-29-knowledge-indexer' case ignores item.org_id entirely (same as the
 * ag-36/ag-38 platform-wide cases), so which real org_id satisfies RLS at
 * enqueue time has no bearing on how the row is actually processed.
 */
export async function enqueueKnowledgeIndexerTrigger(
  supabase: SupabaseClient,
  table: KnowledgeIndexerSourceTable,
  rowId: string,
  orgId: string = SYSTEM_ORG_ID,
): Promise<void> {
  const { error } = await supabase.from("agent_queue").insert({
    org_id: orgId,
    agent_id: "ag-29-knowledge-indexer",
    priority: 5,
    status: "queued",
    trigger_source: "event",
    input_payload: { table, rowId },
  });

  if (error) {
    throw new Error(`Failed to enqueue knowledge indexer trigger: ${error.message}`);
  }
}

export class KnowledgeIndexerAgent extends AutonomousAgent {
  constructor(supabase: SupabaseClient) {
    super(SYSTEM_ORG_ID, "ag-29-knowledge-indexer", supabase);
  }

  /** Idempotent — same pattern as AG-36/AG-38's ensureSystemOrg(). Migration
   * 111 also seeds this row directly, so this is defense-in-depth, not the
   * only place it's created. */
  private async ensureSystemOrg(): Promise<void> {
    const { data: existing } = await this.supabase
      .from("organizations")
      .select("id")
      .eq("id", SYSTEM_ORG_ID)
      .maybeSingle();
    if (existing) return;

    const { error } = await this.supabase.from("organizations").insert({
      id: SYSTEM_ORG_ID,
      name: SYSTEM_ORG_NAME,
      onboarding_completed: true,
    });
    if (error && !/duplicate key/i.test(error.message ?? "")) {
      throw new Error(
        `Failed to provision system organization for platform-level agent runs: ${error.message}`,
      );
    }
  }

  /** Reads the specific (table, rowId) an event-trigger enqueue targeted, if
   * this run was fired that way — mirrors FollowupGeneratorAgent's
   * loadTriggerPayload(): the currently-"processing" agent_queue row for
   * this agent is the only way to recover the event payload, since run()
   * itself takes no direct-input parameter. Not filtered by org_id, since a
   * caller satisfying its own RLS may have enqueued under any real org_id —
   * see enqueueKnowledgeIndexerTrigger's doc comment. */
  private async loadEventTriggerPayload(): Promise<EventTriggerPayload | null> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("agent_id", "ag-29-knowledge-indexer")
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as Partial<EventTriggerPayload>;
    if (!isSourceTable(payload.table) || typeof payload.rowId !== "string") return null;
    return { table: payload.table, rowId: payload.rowId };
  }

  /** Fetches one specific row by (table, id) if it still needs embedding —
   * used to give an event-triggered row priority within the batch. Returns
   * null if the row no longer qualifies (already embedded since the event
   * fired, deleted, or has no real text content). */
  private async loadSpecificRow(target: EventTriggerPayload): Promise<EmbeddableRow | null> {
    if (target.table === "intelligence_proposal_sections") {
      const { data } = await this.supabase
        .from("intelligence_proposal_sections")
        .select("id, section_text")
        .eq("id", target.rowId)
        .is("embedding", null)
        .maybeSingle();
      const row = data as { id: string; section_text: string | null } | null;
      if (!row?.section_text?.trim()) return null;
      return { table: target.table, id: row.id, text: row.section_text };
    }

    if (target.table === "outcomes") {
      const { data } = await this.supabase
        .from("outcomes")
        .select("id, narrative_snapshot, funder_feedback, denial_reason")
        .eq("id", target.rowId)
        .is("embedding", null)
        .maybeSingle();
      if (!data) return null;
      const text = flattenOutcomeText(
        data as {
          narrative_snapshot: string | null;
          funder_feedback: string | null;
          denial_reason: string | null;
        },
      );
      if (!text) return null;
      return { table: target.table, id: (data as { id: string }).id, text };
    }

    // foundation_directory
    const { data } = await this.supabase
      .from("foundation_directory")
      .select("id, programs, enrichment")
      .eq("id", target.rowId)
      .is("embedding", null)
      .maybeSingle();
    if (!data) return null;
    const text = flattenFoundationText(
      data as { programs: string[] | null; enrichment: Record<string, unknown> | null },
    );
    if (!text) return null;
    return { table: target.table, id: (data as { id: string }).id, text };
  }

  /**
   * Scans the 3 source tables for oldest-pending rows with real text and a
   * null embedding, up to `limit` combined — the catch-up half of the
   * design, real for every trigger source (not just the continuous poll),
   * so an event-triggered run also tops up its batch with other pending
   * work rather than doing only the one row that fired it.
   *
   * Each table is over-fetched (3x the remaining slots) and filtered for
   * real content in JS, rather than expressing the jsonb `enrichment->>
   * 'mission'` / multi-column OR condition as a single PostgREST filter
   * string — safer than a hand-built filter-string that risks a subtle
   * syntax error, at the cost of occasionally re-reading a few rows with no
   * real content (harmless; they are simply skipped).
   */
  private async loadPendingBatch(
    limit: number,
    exclude: EmbeddableRow[],
  ): Promise<EmbeddableRow[]> {
    if (limit <= 0) return [];
    const excludeIds = new Set(exclude.map((r) => `${r.table}:${r.id}`));
    const rows: EmbeddableRow[] = [];
    const overfetch = Math.max(limit * 3, 30);

    const { data: sections } = await this.supabase
      .from("intelligence_proposal_sections")
      .select("id, section_text")
      .is("embedding", null)
      .order("created_at", { ascending: true })
      .limit(overfetch);
    for (const row of (sections ?? []) as Array<{ id: string; section_text: string | null }>) {
      if (rows.length >= limit) break;
      if (!row.section_text?.trim()) continue;
      if (excludeIds.has(`intelligence_proposal_sections:${row.id}`)) continue;
      rows.push({ table: "intelligence_proposal_sections", id: row.id, text: row.section_text });
    }

    if (rows.length < limit) {
      const { data: outcomeRows } = await this.supabase
        .from("outcomes")
        .select("id, narrative_snapshot, funder_feedback, denial_reason")
        .is("embedding", null)
        .order("recorded_at", { ascending: true })
        .limit(overfetch);
      for (const row of (outcomeRows ?? []) as Array<{
        id: string;
        narrative_snapshot: string | null;
        funder_feedback: string | null;
        denial_reason: string | null;
      }>) {
        if (rows.length >= limit) break;
        if (excludeIds.has(`outcomes:${row.id}`)) continue;
        const text = flattenOutcomeText(row);
        if (!text) continue;
        rows.push({ table: "outcomes", id: row.id, text });
      }
    }

    if (rows.length < limit) {
      const { data: foundationRows } = await this.supabase
        .from("foundation_directory")
        .select("id, programs, enrichment")
        .is("embedding", null)
        .order("imported_at", { ascending: true })
        .limit(overfetch);
      for (const row of (foundationRows ?? []) as Array<{
        id: string;
        programs: string[] | null;
        enrichment: Record<string, unknown> | null;
      }>) {
        if (rows.length >= limit) break;
        if (excludeIds.has(`foundation_directory:${row.id}`)) continue;
        const text = flattenFoundationText(row);
        if (!text) continue;
        rows.push({ table: "foundation_directory", id: row.id, text });
      }
    }

    return rows.slice(0, limit);
  }

  /** Checks whether 24h have elapsed since the last successful pattern-
   * aggregation pass, tracked via the most recent completed agent_runs row
   * for this agent whose output_payload.ranPatternAggregation is true — a
   * dedicated state table was considered and rejected as unnecessary for a
   * single timestamp this agent's own run history already carries (spec's
   * own build-time implementation choice). Runs the aggregation and returns
   * the resulting decision id if it ran, or null if not due yet. */
  /**
   * Read-only due-check, split out of maybeRunPatternAggregation() (AR-17.6)
   * so callers can decide whether there is any work at all — an empty
   * embedding batch AND aggregation not due — before writing anything to
   * agent_runs at all. Safe to call twice per pass (once here, once inside
   * maybeRunPatternAggregation itself): it's a cheap read against the last
   * 20 agent_runs rows, and re-checking after startRun() guards against the
   * rare race where aggregation became due in between.
   */
  private async isPatternAggregationDue(): Promise<boolean> {
    const { data: recentRuns } = await this.supabase
      .from("agent_runs")
      .select("completed_at, output_payload")
      .eq("agent_type", "ag-29-knowledge-indexer")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(20);

    const lastAggRun = (
      (recentRuns ?? []) as Array<{
        completed_at: string | null;
        output_payload: Record<string, unknown> | null;
      }>
    ).find((r) => r.output_payload?.["ranPatternAggregation"] === true);

    const msSinceLastAgg = lastAggRun?.completed_at
      ? Date.now() - new Date(lastAggRun.completed_at).getTime()
      : Infinity;

    return msSinceLastAgg >= PATTERN_AGGREGATION_INTERVAL_MS;
  }

  private async maybeRunPatternAggregation(runId: string): Promise<string | null> {
    const due = await this.isPatternAggregationDue();
    if (!due) return null;
    return this.runPatternAggregation(runId);
  }

  /** Deterministic aggregation (spec process step 6) — no Claude call, this
   * is structured-column arithmetic, matching the same "aggregation over
   * real structured columns doesn't need a language model" principle
   * already established for AG-10's requirement_patterns step. Groups
   * embedded outcomes by category (opportunity_category preferred,
   * funder_category fallback — see file header for why there is only one
   * real category column to group by) and upserts one knowledge_patterns
   * row per category: merges into the existing row if present, never
   * replaces wholesale. */
  private async runPatternAggregation(runId: string): Promise<string> {
    const { data } = await this.supabase
      .from("outcomes")
      .select("id, result, funder_category, opportunity_category")
      .not("embedding", "is", null)
      .order("recorded_at", { ascending: false })
      .limit(MAX_OUTCOMES_PER_AGGREGATION_PASS);

    const rows = (data ?? []) as Array<{
      id: string;
      result: string;
      funder_category: string | null;
      opportunity_category: string | null;
    }>;

    const groups = new Map<string, { total: number; awarded: number }>();
    for (const row of rows) {
      const category = row.opportunity_category ?? row.funder_category;
      if (!category) continue;
      const existing = groups.get(category) ?? { total: 0, awarded: 0 };
      existing.total++;
      if (row.result === "awarded" || row.result === "partial") existing.awarded++;
      groups.set(category, existing);
    }

    const categorySummaries: string[] = [];
    for (const [category, stats] of groups) {
      const successRate =
        stats.total > 0 ? Number((stats.awarded / stats.total).toFixed(3)) : null;
      const confidence = stats.total >= 10 ? "high" : stats.total >= 3 ? "medium" : "low";
      const description =
        `${stats.awarded} of ${stats.total} recorded outcomes for ${category} opportunities ` +
        "were awarded or partially awarded.";

      const { data: existingPattern } = await this.supabase
        .from("knowledge_patterns")
        .select("id")
        .eq("pattern_type", "category_success_rate")
        .eq("category", category)
        .maybeSingle();

      if (existingPattern) {
        await this.supabase
          .from("knowledge_patterns")
          .update({
            success_rate: successRate,
            sample_count: stats.total,
            confidence,
            pattern_description: description,
            updated_at: new Date().toISOString(),
          })
          .eq("id", (existingPattern as { id: string }).id);
      } else {
        await this.supabase.from("knowledge_patterns").insert({
          pattern_type: "category_success_rate",
          category,
          pattern_description: description,
          success_rate: successRate,
          sample_count: stats.total,
          confidence,
        });
      }
      categorySummaries.push(`${category}: ${stats.awarded}/${stats.total}`);
    }

    return this.logDecision({
      decisionType: "patterns_aggregated",
      agentRunId: runId,
      entityType: "platform",
      reasoning:
        `Aggregated ${rows.length} embedded outcome(s) across ${groups.size} category grouping(s) ` +
        `into knowledge_patterns: ${categorySummaries.join("; ") || "no categorized outcomes found"}. ` +
        "Merged into existing pattern rows where present rather than replacing them wholesale.",
      confidenceScore: 90,
      actionTaken: "aggregated_knowledge_patterns",
      actionPayload: { touchedCategories: groups.size, totalOutcomesConsidered: rows.length },
    });
  }

  override async run(triggerSource: TriggerSource): Promise<KnowledgeIndexerRunResult> {
    await this.ensureSystemOrg();

    // AR-17.6: check for claimable work BEFORE writing anything to
    // agent_runs — every other continuous poll loop in this codebase
    // (dd-request-processor.ts, enrichment-processor.ts, queue-processor.ts)
    // already does this; this agent didn't, which is the actual mechanism
    // behind it being 95.94% of every agent_runs row ever recorded on the
    // platform (65,602 of 68,377) despite making no Anthropic calls. An
    // empty poll is now invisible in the run history, exactly like every
    // other poll loop's empty pass already is — this does not change the
    // 60s/backoff poll cadence itself (worker/knowledge-indexer-processor.ts
    // already handles that), only whether a no-op tick leaves a row behind.
    let batch: EmbeddableRow[] = [];
    if (triggerSource === "event") {
      const target = await this.loadEventTriggerPayload();
      if (target) {
        const specific = await this.loadSpecificRow(target);
        if (specific) batch.push(specific);
      }
    }
    const remaining = EMBEDDING_BATCH_SIZE - batch.length;
    if (remaining > 0) {
      batch = [...batch, ...(await this.loadPendingBatch(remaining, batch))];
    }
    const itemsFoundPreCheck = batch.length;
    const aggregationDue = await this.isPatternAggregationDue();

    if (itemsFoundPreCheck === 0 && !aggregationDue) {
      return {
        success: true,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions: [],
        nextActions: [],
        errors: [],
        batchWasFull: false,
      };
    }

    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let itemsFound = 0;
    let itemsProcessed = 0;
    let failedCount = 0;
    const sourceBreakdown: Record<KnowledgeIndexerSourceTable, number> = {
      intelligence_proposal_sections: 0,
      outcomes: 0,
      foundation_directory: 0,
    };

    try {
      itemsFound = batch.length;

      if (batch.length > 0) {
        // Every row's text goes through chunkText() even when short (it
        // returns a single chunk in that case) — only the first chunk's
        // embedding is ever stored, per the file header's stated
        // simplification.
        const firstChunkTexts = batch.map((row) => {
          const chunks = chunkText(row.text);
          return chunks[0] ?? row.text;
        });

        let embeddings: number[][] | null = null;
        let lastBatchError: string | null = null;
        for (let attempt = 0; attempt < EMBEDDING_RETRY_ATTEMPTS; attempt++) {
          try {
            embeddings = await generateEmbeddingsBatch(firstChunkTexts);
            break;
          } catch (err) {
            lastBatchError = err instanceof Error ? err.message : String(err);
            if (attempt < EMBEDDING_RETRY_ATTEMPTS - 1) {
              await sleep(Math.pow(2, attempt) * 1000);
            }
          }
        }

        if (embeddings === null) {
          // Whole-batch failure after retries: every row in this batch stays
          // embedding: null and is naturally retried by the next pass (poll
          // or event) — the WHERE embedding IS NULL scope query means
          // nothing extra is needed to make this a real retry, not a dead
          // end.
          failedCount = batch.length;
          errors.push(
            `Embedding batch of ${batch.length} row(s) failed after ${EMBEDDING_RETRY_ATTEMPTS} attempts: ${lastBatchError ?? "unknown error"}`,
          );
        } else {
          for (let i = 0; i < batch.length; i++) {
            const row = batch[i];
            const embedding = embeddings[i];
            if (!row || !embedding) continue;
            const { error } = await this.supabase
              .from(row.table)
              .update({ embedding })
              .eq("id", row.id);
            if (error) {
              failedCount++;
              errors.push(`Failed to write embedding for ${row.table}:${row.id}: ${error.message}`);
              continue;
            }
            itemsProcessed++;
            sourceBreakdown[row.table]++;
          }
        }
      }

      const aggregationDecisionId = await this.maybeRunPatternAggregation(runId);
      if (aggregationDecisionId) decisions.push(aggregationDecisionId);

      const batchWasFull = batch.length >= EMBEDDING_BATCH_SIZE;
      // A batch found rows to embed but embedded fewer than it found — this
      // is a real failure (most commonly generateEmbeddingsBatch() throwing,
      // e.g. a missing/invalid OPENAI_API_KEY), not a success, even though no
      // exception escaped this try block. Previously this was always reported
      // as status='completed', which made a 100%-failing batch indefinitely
      // indistinguishable from real work in agent_runs.
      const batchLevelFailure = itemsFound > 0 && itemsProcessed < itemsFound;
      // AR-14.1: a pass that found nothing to embed and didn't run pattern
      // aggregation either did zero real work — reporting that as
      // status='completed' made it indistinguishable from a pass that
      // genuinely embedded a full batch, which is exactly how ~9,700 empty
      // passes/week went unnoticed (test-evidence/DATA_PIPELINE_AUDIT.md
      // §1). 'skipped' (migration 199) is the honest status for this case;
      // 'completed' is reserved for passes that did something (embedded
      // rows and/or ran the aggregation pass).
      const didNothing = itemsFound === 0 && aggregationDecisionId === null;

      await this.completeRun(runId, {
        outputSummary:
          `Embedded ${itemsProcessed}/${itemsFound} row(s) (${failedCount} failed); ` +
          `pattern aggregation ${aggregationDecisionId ? "ran" : "not due"}.`,
        itemsFound,
        itemsProcessed,
        outputPayload: {
          sourceBreakdown,
          failed: failedCount,
          ranPatternAggregation: aggregationDecisionId !== null,
        },
        ...(batchLevelFailure
          ? { status: "failed" as const, errorMessage: errors.join("; ") }
          : didNothing
            ? { status: "skipped" as const }
            : {}),
      });

      return {
        success: !batchLevelFailure,
        itemsFound,
        itemsProcessed,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors,
        batchWasFull,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Knowledge indexing failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound,
        itemsProcessed,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...errors, message],
        batchWasFull: false,
      };
    }
  }
}
