// AG-42 Change Monitor Agent (CM-01) (AutonomousAgent, migration 077:
// corporate_monitoring_events / pig_nodes / pig_edges, RLS added migration
// 105; this build adds the 'ag-42-change-monitor' agent_type enum value via
// migration 111). Enterprise spec: AGENTS_v2.md §5, AG-42 "Change Monitor
// Agent (CM-01)" (written 2026-08-03, renumbered from AG-30 the same day so
// AG-30 stays permanently the real, live Donor Intent Monitor — see
// AGENTS_v2.md §1.4). Purpose: detects changes in monitored entities
// (website reachability, leadership/status drift) and triggers
// re-enrichment.
//
// Scope correction, UPDATED (Phase 5.5, 2026-09-15): the paragraph below
// documented corporate_prospects as missing in production as of 2026-08-03.
// Live-verified against the real database today: the table exists (created
// 2026-08-03, the same day this comment was written — the two events simply
// landed on the same date in different order) with 49 real rows and the
// exact columns this agent's loadProspectScope() query selects (id,
// legal_name, website, enrichment). Both halves of this agent's scope are
// now genuinely live — this is no longer degrading to "zero prospects in
// scope" in practice, though the try/catch-and-treat-as-empty pattern below
// is kept as defensive code (harmless if the table's shape ever changes
// again). This agent's foundation_directory half is the other real,
// populated (133,000+ rows) branch — "IRS BMF status" (the spec's own
// phrase) is literally foundation_directory's foundation_type/
// subsection_code/status columns, sourced from the real IRS BMF import
// (confirmed real columns: supabase/migrations/046, 058, 072).
//
// PLATFORM-LEVEL, NOT ORG-SCOPED — same pattern as AG-36 (Learning Network
// Aggregator, learning-network-aggregator-agent.ts): neither
// corporate_prospects nor foundation_directory carries an organization_id
// (both are shared, cross-tenant reference data), and
// corporate_monitoring_events itself has no org_id/organization_id column
// at all (confirmed live and via migration 105's own header comment).
// AutonomousAgent's constructor still requires a real orgId
// (agent_runs.organization_id / agent_decisions.org_id are both NOT NULL
// FKs to organizations(id)) — this class lazily provisions the same kind
// of well-known "system" organization row AG-36 already established
// (ensureSystemOrg()), using a distinct sentinel id so the two
// platform-level agents never collide on the same synthetic org.
//
// Trigger: schedule only, daily, 5:00 AM CST, via
// runChangeMonitorDailyPipeline() in worker/autonomous-orchestrator.ts,
// wired ahead of 'foundation-enrichment-weekly' (3AM Sunday) per the spec's
// own rationale ("so a detected change can be re-enrichment-queued and
// picked up by that same run later the same week rather than waiting a
// further week"). Unconditional — fires every day, not gated to a single
// day of week, since MAX_ENTITIES_PER_RUN already bounds cost regardless
// of cadence.
//
// Website check: StealthEngine.fetchPage() (src/lib/scraper/stealth-engine.ts)
// — the same fetcher every other web-touching agent in this codebase
// already uses, never a new HTTP client. StealthEngine does not expose the
// final post-redirect URL or raw HTTP status back to callers (checked — no
// such accessor exists on the class), so "a changed final-redirect URL"
// from the spec's own Process step 2 is implemented as a reachability
// check (fetchPage() returned real HTML vs. returned null after its own
// internal retry/rotation exhaustion) rather than a literal URL-string
// diff — a documented, reasoned adaptation to the fetcher's real public
// surface, not a silent narrowing.
//
// Leadership/status diff (foundation_directory only, no web fetch):
// deterministic comparison of the row's current officers/foundation_type/
// subsection_code/status against enrichment.change_monitor_snapshot — a
// pure diff against data other agents already gathered, per the spec's own
// "reuses data other agents already gathered rather than re-deriving it"
// design note.
//
// Severity: Claude classifies a detected change as minor/notable/material
// in one bounded call (DEFAULT_MODEL, small maxTokens — the lightest
// Claude task in this whole agent batch per the spec's own "Model
// selection" section). One fixed exception, taken directly from the
// spec's Error Handling section: a previously-reachable website going
// unreachable (with no other field change alongside it) is *itself*
// logged as 'notable' without a Claude call — "the failure to reach a
// previously-reachable site is real signal, not noise to discard."
// agent_decisions only logs notable/material severities (spec step 5) —
// minor changes are still recorded in the event/enrichment write, just
// without a decision-log entry.
//
// Chain output: ANY detected foundation_directory change (any severity)
// queues 'foundation-990-enrichment' (priority 50, {foundationId}) —
// routed in worker/autonomous-orchestrator.ts's routeQueueItem() to a new
// enrichSingleFoundation() export on foundation-scraper.ts, which reuses
// that file's existing, proven processFoundation()/buildEinIndex()
// unchanged for just the one changed row, out-of-cycle from the weekly
// full-directory sweep. No equivalent chain target exists yet for
// corporate_prospects (no EA-0X pipeline is wired into worker/index.ts's
// boot sequence at all, per AGENTS_v2.md §1.5 / AGENT_VERIFICATION_LOG.md)
// — rather than queue into a routeQueueItem() case that doesn't exist (the
// exact "queues but never routes, retries 3x, dies in `failed`" failure
// mode AGENTS_v2.md §1.3 documents for other agents), this agent writes
// the corporate_monitoring_events row and stops there for that branch.
//
// Idempotency: corporate_monitoring_events is append-only by design (a
// still-unresolved change re-detected tomorrow is real information, "still
// broken as of today," not a duplicate to suppress — spec's own
// Idempotency section). foundation_directory.enrichment's
// change_monitor_snapshot/_last_checked_at keys are always overwritten
// wholesale with the current state (never appended to), so a same-day
// re-run with no real change in between produces the identical final
// jsonb value.
//
// Hard limits: the global AUTONOMOUS_HARD_LIMITS apply; this agent never
// writes application/submission/financial data, only enrichment/event
// read-models plus a chained call into an already-autonomous,
// already-approved enrichment pipeline (foundation-990-enrichment) it
// does not invent new authority to trigger. No human-approval gate — per
// the spec's "Autonomy level" section, queueing re-enrichment is a safe,
// read-only-triggering action; material-severity changes are still only
// *flagged* for a human to notice via agent_decisions, never gated on
// approval before acting.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { causeOf } from "@/lib/agents/base-agent";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import { StealthEngine } from "@/lib/scraper/stealth-engine";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";
type Severity = "minor" | "notable" | "material";

const SYSTEM_ORG_ID = "00000000-0000-4000-8000-000000000042";
const SYSTEM_ORG_NAME = "Benavora Platform (AG-42 Change Monitor)";

/** Spec's own bound — a deliberately bounded daily sweep, not a full-table
 * scan. Cost scales with real change-event rate, not with monitored-set
 * size: only entities WITH a detected change ever reach the Claude call. */
const MAX_ENTITIES_PER_RUN = 200;
const CLAUDE_MAX_TOKENS = 200;
const VALID_SEVERITIES: Severity[] = ["minor", "notable", "material"];

interface ProspectRow {
  id: string;
  legal_name: string;
  website: string | null;
  enrichment: Record<string, unknown> | null;
}

interface FoundationRow {
  id: string;
  name: string;
  website: string | null;
  officers: unknown;
  foundation_type: string | null;
  subsection_code: string | null;
  status: string | null;
  enrichment: Record<string, unknown> | null;
  enriched_web_at: string | null;
}

interface ChangeMonitorSnapshot {
  website_reachable?: boolean;
  officers?: unknown;
  foundation_type?: string | null;
  subsection_code?: string | null;
  status?: string | null;
}

interface DetectedChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

interface ClassifiedChange {
  description: string;
  severity: Severity;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error.";
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function parseSeverity(value: unknown): Severity | null {
  return typeof value === "string" &&
    (VALID_SEVERITIES as string[]).includes(value)
    ? (value as Severity)
    : null;
}

export class ChangeMonitorAgent extends AutonomousAgent {
  constructor(supabase: SupabaseClient) {
    super(SYSTEM_ORG_ID, "ag-42-change-monitor", supabase);
  }

  /** See file header — AutonomousAgent's FK-backed columns need a real
   * organizations row to satisfy NOT NULL REFERENCES, even though this
   * agent's own queries never scope by org. Same lazy-provision pattern as
   * LearningNetworkAggregatorAgent.ensureSystemOrg(), a distinct sentinel
   * id so the two platform-level agents never collide. */
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
    if (error) {
      throw new Error(
        `Failed to provision system org for AG-42 Change Monitor: ${error.message}`,
      );
    }
  }

  /** corporate_prospects exists live (49 rows, re-verified 2026-09-15) with
   * matching columns for this query — this branch is genuinely active, not
   * degraded. The try/catch-and-treat-as-empty pattern (same one
   * DonorIntentMonitorAgent.loadProspects() established for this exact
   * table) is kept as defensive code: a future schema change to this table
   * still degrades this half of scope to zero rather than failing the run. */
  private async loadProspectScope(
    budget: number,
  ): Promise<{ rows: ProspectRow[]; tableMissing: boolean; cause: string | null }> {
    if (budget <= 0) return { rows: [], tableMissing: false, cause: null };
    try {
      const { data, error } = await this.supabase
        .from("corporate_prospects")
        .select("id, legal_name, website, enrichment")
        .order("id", { ascending: true })
        .limit(budget);

      // AR-7.3: this branch used to assert "table does not exist" for ANY
      // error (RLS denial, network blip, column drift, an actually-missing
      // table) — the query result's real cause is preserved instead of
      // guessing which one it was.
      if (error) return { rows: [], tableMissing: true, cause: causeOf(error) };
      return { rows: (data ?? []) as ProspectRow[], tableMissing: false, cause: null };
    } catch (err) {
      return { rows: [], tableMissing: true, cause: causeOf(err) };
    }
  }

  /** Oldest-checked-first, per the spec's step 1: "enriched_web_at ASC
   * NULLS FIRST (never-checked first, then oldest-checked), filtered to
   * rows enriched at least once already." Filtering to
   * enriched_web_at IS NOT NULL (a never-enriched row has no baseline to
   * diff against — that's the enrichment agent's own job, not this one's)
   * makes "NULLS FIRST" moot once applied; ordering is simply
   * oldest-checked-first among rows that do have a baseline. */
  private async loadFoundationScope(budget: number): Promise<FoundationRow[]> {
    if (budget <= 0) return [];
    const { data, error } = await this.supabase
      .from("foundation_directory")
      .select(
        "id, name, website, officers, foundation_type, subsection_code, status, enrichment, enriched_web_at",
      )
      .not("enriched_web_at", "is", null)
      .order("enriched_web_at", { ascending: true })
      .limit(budget);

    if (error || !data) return [];
    return data as FoundationRow[];
  }

  /** Reusing StealthEngine directly (per file header — the same fetcher
   * every other web-touching agent already uses). One short-lived engine
   * per entity, matching the established per-entity-engine convention
   * already used by ea-01..ea-08 rather than a shared multi-engine pool
   * (this agent processes at most MAX_ENTITIES_PER_RUN entities/day, most
   * of which have already-cached "no change" outcomes; a shared pool would
   * be the right call at foundation-scraper.ts's full-directory scale, not
   * here). */
  private async checkReachable(url: string): Promise<boolean> {
    const engine = new StealthEngine();
    try {
      await engine.init();
      const html = await engine.fetchPage(url);
      return html !== null;
    } catch {
      return false;
    } finally {
      await engine.close().catch(() => {});
    }
  }

  private diffFoundationFields(
    row: FoundationRow,
    snapshot: ChangeMonitorSnapshot | null,
  ): DetectedChange[] {
    if (!snapshot) return [];
    const changes: DetectedChange[] = [];

    if (!jsonEqual(snapshot.officers ?? null, row.officers ?? null)) {
      changes.push({
        field: "officers",
        oldValue: snapshot.officers ?? null,
        newValue: row.officers ?? null,
      });
    }
    if ((snapshot.foundation_type ?? null) !== (row.foundation_type ?? null)) {
      changes.push({
        field: "foundation_type",
        oldValue: snapshot.foundation_type ?? null,
        newValue: row.foundation_type ?? null,
      });
    }
    if ((snapshot.subsection_code ?? null) !== (row.subsection_code ?? null)) {
      changes.push({
        field: "subsection_code",
        oldValue: snapshot.subsection_code ?? null,
        newValue: row.subsection_code ?? null,
      });
    }
    if ((snapshot.status ?? null) !== (row.status ?? null)) {
      changes.push({
        field: "status",
        oldValue: snapshot.status ?? null,
        newValue: row.status ?? null,
      });
    }
    return changes;
  }

  /** One bounded Claude call, only on an actual detected change (spec's
   * Cost budget section). 3-attempt exponential backoff (1s/2s/4s), the
   * same pattern already proven in src/lib/intelligence/embeddings.ts and
   * reused by AG-10/AG-26/AG-27/AG-41. On exhaustion, defaults to
   * 'notable' rather than silently dropping an already-detected diff (this
   * agent's own posture: a real change must always surface somewhere, even
   * if Claude can't characterize it this run). */
  private async classifyChange(
    entityName: string,
    changes: DetectedChange[],
  ): Promise<{ result: ClassifiedChange; tokensUsed: number }> {
    const system =
      "You are a change-detection classifier inside Benavora's autonomous " +
      "agent platform. You are given exactly one entity's detected field " +
      "changes (old value -> new value) and must respond with ONLY a JSON " +
      'object shaped exactly {"description": "one plain sentence stating ' +
      'what changed", "severity": "minor" | "notable" | "material"}. ' +
      "minor = a cosmetic or low-impact update; notable = a leadership " +
      "change, a site redesign, or a website going unreachable; material " +
      "= a status or foundation-type change that can affect eligibility " +
      "scoring elsewhere in the platform. No markdown fences, no " +
      "commentary before or after the JSON.";
    const prompt =
      `Entity: ${entityName}\n\nDetected changes:\n` +
      changes
        .map(
          (c) =>
            `- ${c.field}: ${stableStringify(c.oldValue)} -> ${stableStringify(c.newValue)}`,
        )
        .join("\n");

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await callClaude({
          model: DEFAULT_MODEL,
          system,
          prompt,
          maxTokens: CLAUDE_MAX_TOKENS,
        });
        const jsonText = response.text
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/```\s*$/i, "");
        const parsed: unknown = JSON.parse(jsonText);
        const obj = parsed as { description?: unknown; severity?: unknown };
        const severity = parseSeverity(obj.severity) ?? "minor";
        const description =
          typeof obj.description === "string" && obj.description.trim() !== ""
            ? obj.description
            : `${changes.length} field(s) changed for ${entityName}.`;
        return {
          result: { description, severity },
          tokensUsed: response.usage.totalTokens,
        };
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 1000),
          );
        }
      }
    }

    return {
      result: {
        description:
          `${changes.length} field(s) changed for ${entityName} ` +
          `(Claude classification unavailable: ${errMsg(lastError)}).`,
        severity: "notable",
      },
      tokensUsed: 0,
    };
  }

  /** Processes exactly one foundation_directory row: website reachability
   * (if it has a website) + officers/foundation_type/subsection_code/status
   * diff against the stored snapshot. Real, working half of this agent —
   * see file header. */
  private async processFoundationEntity(
    row: FoundationRow,
    runId: string,
    decisions: string[],
    errors: string[],
  ): Promise<{ changed: boolean; tokensUsed: number }> {
    const snapshot = (row.enrichment?.["change_monitor_snapshot"] ?? null) as
      | ChangeMonitorSnapshot
      | null;

    const fieldChanges = this.diffFoundationFields(row, snapshot);

    let websiteChange: DetectedChange | null = null;
    let websiteDegraded = false;
    let reachableNow: boolean | undefined;

    if (row.website) {
      reachableNow = await this.checkReachable(row.website);
      if (
        snapshot &&
        typeof snapshot.website_reachable === "boolean" &&
        snapshot.website_reachable !== reachableNow
      ) {
        websiteChange = {
          field: "website_reachable",
          oldValue: snapshot.website_reachable,
          newValue: reachableNow,
        };
        if (snapshot.website_reachable === true && reachableNow === false) {
          websiteDegraded = true;
        }
      }
    }

    const allChanges = websiteChange
      ? [...fieldChanges, websiteChange]
      : fieldChanges;

    const nowIso = new Date().toISOString();
    const newSnapshot: ChangeMonitorSnapshot = {
      officers: row.officers ?? null,
      foundation_type: row.foundation_type ?? null,
      subsection_code: row.subsection_code ?? null,
      status: row.status ?? null,
      ...(reachableNow !== undefined
        ? { website_reachable: reachableNow }
        : snapshot?.website_reachable !== undefined
          ? { website_reachable: snapshot.website_reachable }
          : {}),
    };

    if (allChanges.length === 0) {
      const { error } = await this.supabase
        .from("foundation_directory")
        .update({
          enrichment: {
            ...(row.enrichment ?? {}),
            change_monitor_snapshot: newSnapshot,
            change_monitor_last_checked_at: nowIso,
          },
        })
        .eq("id", row.id);
      if (error) {
        errors.push(
          `Failed to update change-monitor timestamp for foundation ${row.id}: ${error.message}`,
        );
      }
      return { changed: false, tokensUsed: 0 };
    }

    // Error Handling section's fixed exception: a previously-reachable
    // site going unreachable, with no other field change alongside it, is
    // itself logged as 'notable' without spending a Claude call. If
    // leadership/status fields changed too in the same run, the general
    // classifier below considers everything together instead — strictly
    // more informative than the fixed label alone.
    let classified: ClassifiedChange;
    let tokensUsed = 0;
    if (websiteDegraded && fieldChanges.length === 0) {
      classified = {
        description: `${row.name}'s website (${row.website}) is no longer reachable — it previously resolved.`,
        severity: "notable",
      };
    } else {
      const { result, tokensUsed: used } = await this.classifyChange(
        row.name,
        allChanges,
      );
      classified = result;
      tokensUsed = used;
    }

    const { error: updateError } = await this.supabase
      .from("foundation_directory")
      .update({
        enrichment: {
          ...(row.enrichment ?? {}),
          change_monitor_snapshot: newSnapshot,
          change_monitor_last_checked_at: nowIso,
          change_monitor_last_change: {
            description: classified.description,
            severity: classified.severity,
            detectedAt: nowIso,
          },
        },
      })
      .eq("id", row.id);
    if (updateError) {
      errors.push(
        `Failed to write change for foundation ${row.id}: ${updateError.message}`,
      );
    }

    if (classified.severity === "notable" || classified.severity === "material") {
      decisions.push(
        await this.logDecision({
          decisionType: "entity_change_detected",
          agentRunId: runId,
          entityType: "foundation",
          entityId: row.id,
          reasoning: classified.description,
          confidenceScore: classified.severity === "material" ? 90 : 75,
          actionTaken:
            "Recorded foundation_directory change; queued out-of-cycle re-enrichment (foundation-990-enrichment).",
          actionPayload: { changes: allChanges, severity: classified.severity },
          requiredHumanReview: false,
        }),
      );
    }

    // Chain output: ANY detected foundation_directory change (any
    // severity) re-queues out-of-cycle enrichment — spec's Process step 3.
    await this.queueChainedAgent(
      "foundation-990-enrichment",
      50,
      { foundationId: row.id },
      runId,
    );

    return { changed: true, tokensUsed };
  }

  /** Processes exactly one corporate_prospects row. Only reachable in
   * practice once the corporate_prospects table exists live — see file
   * header. Writes to corporate_monitoring_events (the real output table
   * this data was designed for) rather than foundation_directory's
   * enrichment-jsonb convention. */
  private async processProspectEntity(
    row: ProspectRow,
    runId: string,
    decisions: string[],
    errors: string[],
  ): Promise<{ changed: boolean; tokensUsed: number }> {
    const snapshot = (row.enrichment?.["change_monitor_snapshot"] ?? null) as
      | ChangeMonitorSnapshot
      | null;

    let websiteChange: DetectedChange | null = null;
    let websiteDegraded = false;
    let reachableNow: boolean | undefined;

    if (row.website) {
      reachableNow = await this.checkReachable(row.website);
      if (
        snapshot &&
        typeof snapshot.website_reachable === "boolean" &&
        snapshot.website_reachable !== reachableNow
      ) {
        websiteChange = {
          field: "website_reachable",
          oldValue: snapshot.website_reachable,
          newValue: reachableNow,
        };
        if (snapshot.website_reachable === true && reachableNow === false) {
          websiteDegraded = true;
        }
      }
    }

    const nowIso = new Date().toISOString();
    const newSnapshot: ChangeMonitorSnapshot = {
      ...(reachableNow !== undefined ? { website_reachable: reachableNow } : {}),
    };

    if (!websiteChange) {
      const { error } = await this.supabase
        .from("corporate_prospects")
        .update({
          enrichment: {
            ...(row.enrichment ?? {}),
            change_monitor_snapshot: newSnapshot,
            change_monitor_last_checked_at: nowIso,
          },
        })
        .eq("id", row.id);
      if (error) {
        errors.push(
          `Failed to update change-monitor timestamp for prospect ${row.id}: ${error.message}`,
        );
      }
      return { changed: false, tokensUsed: 0 };
    }

    const classified: ClassifiedChange = websiteDegraded
      ? {
          description: `${row.legal_name}'s website (${row.website}) is no longer reachable — it previously resolved.`,
          severity: "notable",
        }
      : {
          description: `${row.legal_name}'s website (${row.website}) is reachable again after previously failing.`,
          severity: "minor",
        };

    const { error: updateError } = await this.supabase
      .from("corporate_prospects")
      .update({
        enrichment: {
          ...(row.enrichment ?? {}),
          change_monitor_snapshot: newSnapshot,
          change_monitor_last_checked_at: nowIso,
        },
      })
      .eq("id", row.id);
    if (updateError) {
      errors.push(
        `Failed to write change for prospect ${row.id}: ${updateError.message}`,
      );
    }

    const { error: eventError } = await this.supabase
      .from("corporate_monitoring_events")
      .insert({
        prospect_id: row.id,
        event_type: "website_changed",
        description: classified.description,
        change_detected: {
          field: "website_reachable",
          oldValue: websiteChange.oldValue,
          newValue: websiteChange.newValue,
          severity: classified.severity,
        },
      });
    if (eventError) {
      errors.push(
        `Failed to write corporate_monitoring_events for prospect ${row.id}: ${eventError.message}`,
      );
    }

    if (classified.severity === "notable" || classified.severity === "material") {
      decisions.push(
        await this.logDecision({
          decisionType: "entity_change_detected",
          agentRunId: runId,
          entityType: "corporate_prospect",
          entityId: row.id,
          reasoning: classified.description,
          confidenceScore: 75,
          actionTaken:
            "Recorded corporate_prospects website change in corporate_monitoring_events.",
          actionPayload: { change: websiteChange, severity: classified.severity },
          requiredHumanReview: false,
        }),
      );
    }

    // No live chain target exists yet for corporate_prospects
    // re-enrichment (see file header) — stop here for this branch.
    return { changed: true, tokensUsed: 0 };
  }

  override async run(triggerSource: TriggerSource): Promise<AutonomousAgentResult> {
    await this.ensureSystemOrg();
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;
    let changesDetected = 0;

    try {
      const { rows: prospects, tableMissing, cause: prospectScopeCause } =
        await this.loadProspectScope(MAX_ENTITIES_PER_RUN);
      const remainingBudget = MAX_ENTITIES_PER_RUN - prospects.length;
      const foundations = await this.loadFoundationScope(remainingBudget);

      if (tableMissing) {
        errors.push(
          "corporate_prospects query failed — zero corporate prospects in scope " +
            "this run; the foundation_directory half below is unaffected. Cause: " +
            (prospectScopeCause || "unknown (no error detail captured)"),
        );
      }

      const itemsFound = prospects.length + foundations.length;
      let itemsProcessed = 0;

      for (const prospect of prospects) {
        try {
          const { changed, tokensUsed: used } = await this.processProspectEntity(
            prospect,
            runId,
            decisions,
            errors,
          );
          tokensUsed += used;
          itemsProcessed += 1;
          if (changed) changesDetected += 1;
        } catch (err) {
          errors.push(`Prospect ${prospect.id} (${prospect.legal_name}): ${errMsg(err)}`);
        }
      }

      for (const foundation of foundations) {
        try {
          const { changed, tokensUsed: used } = await this.processFoundationEntity(
            foundation,
            runId,
            decisions,
            errors,
          );
          tokensUsed += used;
          itemsProcessed += 1;
          if (changed) changesDetected += 1;
        } catch (err) {
          errors.push(`Foundation ${foundation.id} (${foundation.name}): ${errMsg(err)}`);
        }
      }

      const outputSummary =
        `Checked ${prospects.length} corporate prospect(s) and ${foundations.length} ` +
        `foundation(s); ${changesDetected} change(s) detected.` +
        (tableMissing ? " (corporate_prospects table missing this run.)" : "");

      await this.completeRun(runId, {
        outputSummary,
        itemsFound,
        itemsProcessed,
        itemsQueued: 0,
        tokensUsed,
        outputPayload: {
          corporateProspectsChecked: prospects.length,
          foundationDirectoryChecked: foundations.length,
          changesDetected,
          corporateProspectsTableMissing: tableMissing,
        },
      });

      return {
        success: true,
        itemsFound,
        itemsProcessed,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message = errMsg(err);
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
