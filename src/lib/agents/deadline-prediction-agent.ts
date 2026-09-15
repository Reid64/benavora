// Deadline Prediction Agent — AGENTS_v2.md AG-25 (per this task's naming;
// AGENTS_v2.md's own AG-25 slot is Disaster Response — this agent is scoped
// exactly as given in this build's task prompt) — built on AutonomousAgent
// (migration 080 infrastructure: agent_runs, agent_decisions,
// org_autonomous_config).
//
// FULL AGENTIC UPGRADE (July 2026): the prior version of this file only did
// one thing — detect an annual/quarterly cycle across a funder's own closed
// opportunities and, if found within a 90-day window, auto-create a new
// placeholder opportunity for the predicted next cycle. This upgrade adds
// four capabilities on top of that:
//   1. Self-calibration: before predicting anything, the agent reads its own
//      prediction history (deadline_predictions) joined back to whatever
//      real deadline the target opportunity eventually got, and computes how
//      far off its own past guesses ran. That calibration note is injected
//      into the web-search prompt and used to deterministically discount
//      pattern-based confidence when the agent's own track record is poor.
//   2. Multi-source deadline detection for opportunities that don't have a
//      deadline yet at all — not just funders with closed cycles — trying,
//      in order: explicit text in the opportunity description, a SAM.gov
//      lookup for federal opportunities, a bounded Claude+web_search pass,
//      then the same funder-cycle-pattern math the old version used, with a
//      final looser "estimated from typical cycles" fallback for irregular
//      patterns instead of giving up.
//   3. A fixed confidence value per detection source (task's own table),
//      recorded on every prediction row for audit and for the calibration
//      query above to work at all.
//   4. Urgency tiers with source-specific actions (critical alert + draft
//      chain for red, warning alert + probability-scoring chain for amber,
//      bundled notice for yellow, silent tracking for green) applied to
//      every deadline this agent itself detects or predicts — not to every
//      deadline in the org, which is Deadline Extraction Agent's (AG-03)
//      job and already has its own 7/14/30-day reminder machinery via the
//      `deadlines` table. Re-running full-table tiering here every night
//      would duplicate that agent's alerts and re-chain the same
//      opportunities repeatedly with no de-dup signal to stop it.
//   5. Recurrence prediction: any funder with 2+ historical deadlines now
//      always gets `funders.next_predicted_open_date` /
//      `avg_cycle_length_days` updated (not just funders with a clean
//      annual/quarterly pattern) since that's cheap metadata worth having
//      even from noisy data. Creating a full placeholder *opportunity* row
//      — a much bigger, pipeline-visible action — stays reserved for the
//      stricter annual/quarterly pattern match the old version already
//      required, to avoid cluttering the pipeline from noisy history. An
//      org-wide alert fires once per funder per day when the predicted next
//      open date lands within 30 days.
//
// Schema: migration 097 adds `deadline_predictions` (does not exist
// anywhere in SCHEMA_REGISTRY_v2.md's 71-table catalog or any prior
// migration — created from scratch to match this task's own SQL sketch),
// `funders.next_predicted_open_date` / `avg_cycle_length_days`, and the
// `agent_type` enum value this agent's own agentId needs (see that
// migration's header for why `ag-25-deadline-prediction` was never usable
// before now — AGENTS_v2.md §1.2).
//
// Other deviations from the task-given spec, checked against real schema
// (src/types/database.ts) rather than applied literally:
//   - opportunity_status has no 'awarded' value in the real enum (only
//     open/applied/closed/expired — 'awarded' lives on outcomes.result and
//     applications' pipeline_stage instead). Historical opportunities are
//     filtered to status IN ('closed','expired').
//   - `opportunities` has no `notes` column (see Row/Insert types) — the
//     recurrence placeholder's notes text is written into the real
//     `description` column instead, matching the substitution convention
//     already established in opportunity-discovery-agent.ts's file header.
//   - `opportunities.category` is NOT NULL with no natural source for a
//     recurrence placeholder; the qualifying funder's own `category` is
//     reused, same as before.
//   - `opportunities` has no `external_id` column despite
//     SCHEMA_REGISTRY_v2.md documenting one — SAM.gov matching is done by
//     case-insensitive name comparison against `searchSamGovOpportunities()`
//     results instead of a `?noticeId=` lookup, since the real SAM.gov
//     client (src/lib/sources/samgov-client.ts) only wraps the bulk search
//     endpoint and neither `opportunities` nor
//     `SamGovNormalizedOpportunity` carries a URL field to match on.
//   - The self-calibration query compares every prediction's
//     `predicted_deadline` against the linked opportunity's *current*
//     `deadline` — for a prediction that filled in a previously-null
//     deadline and was never since corrected by a firmer source, that
//     current value IS the prediction, so it will show 0 days off and
//     inflate the accuracy stats. This is the literal join the task
//     specifies; flagged here rather than silently filtered, since
//     excluding "unconfirmed" predictions would require tracking
//     provenance this schema doesn't have.

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, differenceInCalendarDays, format } from "date-fns";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaudeWithWebSearch, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  searchSamGovOpportunities,
  type SamGovNormalizedOpportunity,
} from "@/lib/sources/samgov-client";
import type { Enums } from "@/types/database";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";
type FunderCategory = Enums<"funder_category">;
type Pattern = "annual" | "quarterly" | "rolling";
type PredictionSource =
  | "description_text"
  | "sam_gov"
  | "web_search"
  | "cycle_pattern"
  | "estimated_cycle";
type UrgencyTier = "red" | "amber" | "yellow" | "green";

const HISTORICAL_STATUSES = ["closed", "expired"] as const;
const ANNUAL_GAP_MIN = 330;
const ANNUAL_GAP_MAX = 400;
const QUARTERLY_GAP_MIN = 80;
const QUARTERLY_GAP_MAX = 100;
const PREDICTION_WINDOW_DAYS = 90;
const HIGH_CONFIDENCE = 85;
const LOW_CONFIDENCE = 65;

// Task item 3 — fixed confidence per detection source, 0-1 scale to match
// deadline_predictions.confidence's CHECK constraint.
const TEXT_CONFIDENCE = 0.95;
const SAMGOV_CONFIDENCE = 0.98;
const WEB_SEARCH_CONFIDENCE = 0.8;
const CYCLE_PATTERN_CONFIDENCE = 0.65;
const ESTIMATED_CYCLE_CONFIDENCE = 0.45;

const MAX_DETECTION_PER_RUN = 15;
const MAX_WEB_SEARCH_LOOKUPS_PER_RUN = 5;
const OPEN_NO_DEADLINE_QUERY_LIMIT = 100;
const WEB_SEARCH_MAX_TOKENS = 400;

const CALIBRATION_SAMPLE_LIMIT = 100;
const MIN_CALIBRATION_SAMPLES = 5;
const CALIBRATION_DOWNGRADE_THRESHOLD_DAYS = 14;
const CALIBRATION_DOWNGRADE_FACTOR = 0.85;

// Task item 4 — urgency tier boundaries, in days from now.
const RED_TIER_MAX_DAYS = 7;
const AMBER_TIER_MAX_DAYS = 21;
const YELLOW_TIER_MAX_DAYS = 45;

const RECURRENCE_ALERT_WINDOW_DAYS = 30;

// Task item 2a — deadline patterns in free-text descriptions.
const DEADLINE_TEXT_PATTERN =
  /(?:due|deadline|closes?|submit(?:ted)?\s+by|applications?\s+(?:due|accepted)\s+(?:through|until|by))[:\s]+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/gi;

interface FunderRow {
  id: string;
  name: string;
  category: FunderCategory;
}

interface HistoricalOpportunityRow {
  funder_id: string;
  deadline: string;
}

interface OpenNoDeadlineRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  source: string | null;
  funder_id: string | null;
}

interface CalibrationSummary {
  sampleSize: number;
  avgDaysOff: number | null;
  accuracyWithin7Pct: number | null;
  accuracyWithin30Pct: number | null;
}

interface DetectionResult {
  date: Date;
  source: PredictionSource;
  confidence: number;
  detail: string;
  tokensUsed?: number;
}

interface DetectionState {
  samGovHits: SamGovNormalizedOpportunity[] | null;
  webSearchLookupsUsed: number;
}

function parseSortedDates(deadlineStrings: string[]): Date[] {
  return deadlineStrings
    .map((d) => new Date(d))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
}

function computeGaps(dates: Date[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const prev = dates[i - 1];
    const curr = dates[i];
    if (!prev || !curr) continue;
    gaps.push(differenceInCalendarDays(curr, prev));
  }
  return gaps;
}

function detectPattern(gaps: number[]): Pattern {
  if (gaps.every((g) => g >= ANNUAL_GAP_MIN && g <= ANNUAL_GAP_MAX)) {
    return "annual";
  }
  if (gaps.every((g) => g >= QUARTERLY_GAP_MIN && g <= QUARTERLY_GAP_MAX)) {
    return "quarterly";
  }
  return "rolling";
}

/** Task item 4 — red/amber/yellow/green tiering. A negative daysFromNow
 * (already past) is treated as red — most urgent, not excluded. */
function computeUrgencyTier(daysFromNow: number): UrgencyTier {
  if (daysFromNow <= RED_TIER_MAX_DAYS) return "red";
  if (daysFromNow <= AMBER_TIER_MAX_DAYS) return "amber";
  if (daysFromNow <= YELLOW_TIER_MAX_DAYS) return "yellow";
  return "green";
}

/** Task item 2a — first regex match in free text, parsed to a real Date.
 * Returns null on no match or an unparseable date. */
function parseDescriptionDate(
  text: string,
): { date: Date; raw: string } | null {
  DEADLINE_TEXT_PATTERN.lastIndex = 0;
  const match = DEADLINE_TEXT_PATTERN.exec(text);
  const raw = match?.[1];
  if (!raw) return null;
  const date = new Date(raw);
  if (isNaN(date.getTime())) return null;
  return { date, raw };
}

/** Task item 2b — best-effort match by name since neither `opportunities`
 * nor SamGovNormalizedOpportunity carries a URL/noticeId to join on (see
 * file header). */
function matchSamGovDeadline(
  oppName: string,
  hits: SamGovNormalizedOpportunity[],
): SamGovNormalizedOpportunity | null {
  const normalized = oppName.trim().toLowerCase();
  if (!normalized) return null;
  for (const hit of hits) {
    if (!hit.deadline) continue;
    const hitName = hit.name.trim().toLowerCase();
    if (
      hitName === normalized ||
      hitName.includes(normalized) ||
      normalized.includes(hitName)
    ) {
      return hit;
    }
  }
  return null;
}

function buildWebSearchDeadlinePrompt(
  funderName: string,
  opportunityName: string,
  calibration: CalibrationSummary,
): { system: string; prompt: string } {
  const calibrationNote =
    calibration.sampleSize >= MIN_CALIBRATION_SAMPLES &&
    calibration.avgDaysOff != null
      ? `Self-calibration note: across ${calibration.sampleSize} of this organization's own past deadline predictions with a since-recorded actual deadline, this agent has averaged ${calibration.avgDaysOff.toFixed(1)} days off, landing within 7 days ${(calibration.accuracyWithin7Pct ?? 0).toFixed(0)}% of the time and within 30 days ${(calibration.accuracyWithin30Pct ?? 0).toFixed(0)}% of the time. Weigh your own certainty accordingly.`
      : `No self-calibration history is available yet for this organization (fewer than ${MIN_CALIBRATION_SAMPLES} resolved predictions on file). Do not overstate certainty.`;

  const system = [
    "You are a grant-deadline researcher for a nonprofit grant-management platform. Search the web for the specific application deadline of the named grant program.",
    calibrationNote,
    'Respond with ONLY a JSON object: {"deadline": <string YYYY-MM-DD, or null if no reliable date was found>, "reasoning": <string, 1-2 sentences citing what you found>}. Never invent a date — if sources disagree or nothing reliable turns up, return null.',
  ].join("\n");

  const prompt = [
    `Funder: ${funderName}`,
    `Grant program: ${opportunityName}`,
    `Search: "${funderName} ${opportunityName} 2025 2026 deadline application"`,
    "Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}

function parseWebSearchDate(
  text: string,
): { deadline: string; reasoning: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  const obj = (raw ?? {}) as { deadline?: unknown; reasoning?: unknown };
  if (typeof obj.deadline !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(obj.deadline)) return null;

  return {
    deadline: obj.deadline,
    reasoning:
      typeof obj.reasoning === "string" && obj.reasoning.trim() !== ""
        ? obj.reasoning.trim()
        : "Claude web search identified this date.",
  };
}

/** Deterministic self-calibration adjustment — never trust the pattern math
 * blindly if this agent's own track record has been running cold. Only
 * applies to the two derived-from-history sources; direct-evidence sources
 * (description text, SAM.gov, web search) are left alone. */
function applyCalibrationDowngrade(
  confidence: number,
  calibration: CalibrationSummary,
): number {
  if (
    calibration.sampleSize >= MIN_CALIBRATION_SAMPLES &&
    calibration.avgDaysOff != null &&
    calibration.avgDaysOff > CALIBRATION_DOWNGRADE_THRESHOLD_DAYS
  ) {
    return Math.round(confidence * CALIBRATION_DOWNGRADE_FACTOR * 100) / 100;
  }
  return confidence;
}

export class DeadlinePredictionAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-25-deadline-prediction", supabase);
  }

  /** Task item 1 — self-calibration query. Joins this org's own prediction
   * history back to the linked opportunity's current deadline via the FK
   * PostgREST auto-embeds. See file header for the "unconfirmed prediction"
   * caveat this comparison inherits from the task's own SQL sketch. */
  private async loadCalibrationSummary(): Promise<CalibrationSummary> {
    const empty: CalibrationSummary = {
      sampleSize: 0,
      avgDaysOff: null,
      accuracyWithin7Pct: null,
      accuracyWithin30Pct: null,
    };

    const { data, error } = await this.supabase
      .from("deadline_predictions")
      .select("predicted_deadline, opportunities(deadline)")
      .eq("org_id", this.orgId)
      .not("opportunity_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(CALIBRATION_SAMPLE_LIMIT);

    if (error || !data) return empty;

    const daysOffList: number[] = [];
    for (const row of data as Array<{
      predicted_deadline: string;
      opportunities:
        | { deadline: string | null }
        | { deadline: string | null }[]
        | null;
    }>) {
      const embedded = row.opportunities;
      const actual = Array.isArray(embedded)
        ? (embedded[0]?.deadline ?? null)
        : (embedded?.deadline ?? null);
      if (!actual) continue;

      const predicted = new Date(row.predicted_deadline);
      const actualDate = new Date(actual);
      if (isNaN(predicted.getTime()) || isNaN(actualDate.getTime())) continue;

      daysOffList.push(Math.abs(differenceInCalendarDays(actualDate, predicted)));
    }

    if (daysOffList.length === 0) return empty;

    const avgDaysOff =
      daysOffList.reduce((a, b) => a + b, 0) / daysOffList.length;
    const within7 =
      (daysOffList.filter((d) => d <= 7).length / daysOffList.length) * 100;
    const within30 =
      (daysOffList.filter((d) => d <= 30).length / daysOffList.length) * 100;

    return {
      sampleSize: daysOffList.length,
      avgDaysOff,
      accuracyWithin7Pct: within7,
      accuracyWithin30Pct: within30,
    };
  }

  /** Task item 2 — multi-source waterfall for one opportunity that has no
   * deadline yet: description text, SAM.gov, bounded web search, then the
   * funder's own historical cycle (strict pattern or loose estimate). */
  private async detectDeadline(
    opp: OpenNoDeadlineRow,
    funder: FunderRow | null,
    byFunder: Map<string, string[]>,
    calibration: CalibrationSummary,
    state: DetectionState,
  ): Promise<DetectionResult | null> {
    const textMatch = parseDescriptionDate(opp.description ?? "");
    if (textMatch) {
      return {
        date: textMatch.date,
        source: "description_text",
        confidence: TEXT_CONFIDENCE,
        detail: `Matched "${textMatch.raw}" in the opportunity description.`,
      };
    }

    const looksFederal =
      opp.source === "sam_gov" || opp.category === "government_grant";
    if (looksFederal) {
      if (state.samGovHits === null) {
        state.samGovHits = await searchSamGovOpportunities();
      }
      const hit = matchSamGovDeadline(opp.name, state.samGovHits);
      if (hit?.deadline) {
        const parsed = new Date(hit.deadline);
        if (!isNaN(parsed.getTime())) {
          return {
            date: parsed,
            source: "sam_gov",
            confidence: SAMGOV_CONFIDENCE,
            detail: `SAM.gov notice ${hit.externalId} lists this response deadline.`,
          };
        }
      }
    }

    if (funder && state.webSearchLookupsUsed < MAX_WEB_SEARCH_LOOKUPS_PER_RUN) {
      state.webSearchLookupsUsed++;
      try {
        const { system, prompt } = buildWebSearchDeadlinePrompt(
          funder.name,
          opp.name,
          calibration,
        );
        const response = await callClaudeWithWebSearch({
          system,
          prompt,
          model: DEFAULT_MODEL,
          maxTokens: WEB_SEARCH_MAX_TOKENS,
          maxSearches: 3,
        });
        const parsed = parseWebSearchDate(response.text);
        if (parsed) {
          const date = new Date(parsed.deadline);
          if (!isNaN(date.getTime())) {
            return {
              date,
              source: "web_search",
              confidence: WEB_SEARCH_CONFIDENCE,
              detail: parsed.reasoning,
              tokensUsed: response.usage.totalTokens,
            };
          }
        }
      } catch {
        // Fall through to the cycle-based estimate below.
      }
    }

    if (funder) {
      const dates = parseSortedDates(byFunder.get(funder.id) ?? []);
      if (dates.length >= 2) {
        const gaps = computeGaps(dates);
        const pattern = detectPattern(gaps);
        const avgGapDays = Math.round(
          gaps.reduce((a, b) => a + b, 0) / gaps.length,
        );
        const last = dates[dates.length - 1];
        if (last) {
          const predicted = addDays(last, avgGapDays);
          const isStrictPattern = pattern === "annual" || pattern === "quarterly";
          const confidence = applyCalibrationDowngrade(
            isStrictPattern ? CYCLE_PATTERN_CONFIDENCE : ESTIMATED_CYCLE_CONFIDENCE,
            calibration,
          );
          return {
            date: predicted,
            source: isStrictPattern ? "cycle_pattern" : "estimated_cycle",
            confidence,
            detail: `${isStrictPattern ? pattern : "irregular"} cycle across ${dates.length} historical deadlines for ${funder.name}, average ${avgGapDays}-day gap.`,
          };
        }
      }
    }

    return null;
  }

  private async recordPrediction(params: {
    opportunityId: string | null;
    funderId: string | null;
    predictedDeadline: Date;
    source: PredictionSource;
    confidence: number;
    urgencyTier: UrgencyTier;
    detail: string;
  }): Promise<void> {
    const { error } = await this.supabase.from("deadline_predictions").insert({
      org_id: this.orgId,
      opportunity_id: params.opportunityId,
      funder_id: params.funderId,
      predicted_deadline: format(params.predictedDeadline, "yyyy-MM-dd"),
      source: params.source,
      confidence: params.confidence,
      urgency_tier: params.urgencyTier,
      source_detail: params.detail,
    });
    // p5.2b (2026-09-15): was previously unchecked -- unlike every other
    // write in this file, a failed insert here silently discarded the
    // prediction with no signal anywhere (the table itself was missing live
    // until this session's migration 097; now applied, but this guard stays
    // so a future regression is visible instead of silent).
    if (error) {
      console.error(
        `[ag-25-deadline-prediction] Failed to record prediction: ${error.message}`,
      );
    }
  }

  /** Task item 4 — tier-specific actions, scoped to deadlines this agent
   * itself just detected or predicted (see file header for why). Returns
   * the chained agent_id, if any, for the run summary. */
  private async applyUrgencyTier(params: {
    opportunityId: string;
    opportunityName: string;
    deadline: Date;
    tier: UrgencyTier;
  }): Promise<string | null> {
    const { opportunityId, opportunityName, deadline, tier } = params;
    const deadlineStr = format(deadline, "yyyy-MM-dd");

    if (tier === "red") {
      const { data: existingApp } = await this.supabase
        .from("applications")
        .select("id")
        .eq("organization_id", this.orgId)
        .eq("opportunity_id", opportunityId)
        .limit(1)
        .maybeSingle();

      await this.supabase.from("alerts").insert({
        organization_id: this.orgId,
        type: "deadline_due",
        severity: "critical",
        message: `URGENT: "${opportunityName}" deadline is ${deadlineStr} (within 7 days).`,
        opportunity_id: opportunityId,
        dedup_key: `deadline-prediction:red:${opportunityId}:${crypto.randomUUID()}`,
      });

      if (!existingApp) {
        await this.queueChainedAgent("ag-05-draft", 2, {
          opportunityId,
          title: opportunityName,
          reason: "deadline_within_7_days_no_draft",
        });
        return "ag-05-draft";
      }
      return null;
    }

    if (tier === "amber") {
      const { data: existingScore } = await this.supabase
        .from("opportunity_probability_scores")
        .select("id")
        .eq("organization_id", this.orgId)
        .eq("opportunity_id", opportunityId)
        .maybeSingle();

      await this.supabase.from("alerts").insert({
        organization_id: this.orgId,
        type: "deadline_due",
        severity: "warning",
        message: `"${opportunityName}" deadline is ${deadlineStr} (8-21 days out).`,
        opportunity_id: opportunityId,
        dedup_key: `deadline-prediction:amber:${opportunityId}:${crypto.randomUUID()}`,
      });

      if (!existingScore) {
        await this.queueChainedAgent("ag-15-probability", 6, {
          opportunityIds: [opportunityId],
        });
        return "ag-15-probability";
      }
      return null;
    }

    // Yellow is bundled into one digest-style alert by the caller (task item
    // 4's "weekly digest" — this schema has no dedicated weekly-digest cron,
    // so it's folded into the existing alerts stream instead). Green tracks
    // silently, matching AG-25's real spec (surfaces, never acts).
    return null;
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    const nextActions: string[] = [];
    let tokensUsed = 0;

    let fundersAnalyzed = 0;
    let patternsDetected = 0;
    let opportunitiesCreated = 0;
    let deadlinesDetected = 0;
    let recurrenceUpdated = 0;
    let redChained = 0;
    let amberChained = 0;
    const yellowBucket: string[] = [];

    try {
      const [
        { data: funderRows, error: fundersError },
        { data: histRows, error: histError },
        { data: openNoDeadlineRows, error: openError },
      ] = await Promise.all([
        this.supabase
          .from("funders")
          .select("id, name, category")
          .eq("organization_id", this.orgId),
        this.supabase
          .from("opportunities")
          .select("funder_id, deadline")
          .eq("organization_id", this.orgId)
          .in("status", HISTORICAL_STATUSES)
          .not("funder_id", "is", null)
          .not("deadline", "is", null)
          .order("deadline", { ascending: true }),
        this.supabase
          .from("opportunities")
          .select("id, name, description, category, source, funder_id")
          .eq("organization_id", this.orgId)
          .eq("status", "open")
          .is("deadline", null)
          .limit(OPEN_NO_DEADLINE_QUERY_LIMIT),
      ]);

      if (fundersError) {
        throw new Error(`Failed to load funders: ${fundersError.message}`);
      }
      if (histError) {
        throw new Error(
          `Failed to load historical opportunities: ${histError.message}`,
        );
      }
      if (openError) {
        throw new Error(
          `Failed to load undated opportunities: ${openError.message}`,
        );
      }

      const funders = (funderRows ?? []) as FunderRow[];
      const funderById = new Map(funders.map((f) => [f.id, f]));

      const byFunder = new Map<string, string[]>();
      for (const row of (histRows ?? []) as HistoricalOpportunityRow[]) {
        const list = byFunder.get(row.funder_id) ?? [];
        list.push(row.deadline);
        byFunder.set(row.funder_id, list);
      }

      const calibration = await this.loadCalibrationSummary();
      const detectionState: DetectionState = {
        samGovHits: null,
        webSearchLookupsUsed: 0,
      };

      // --- Phase A: multi-source detection for opportunities with no
      // deadline at all (task item 2) -------------------------------------
      const undated = ((openNoDeadlineRows ?? []) as OpenNoDeadlineRow[]).slice(
        0,
        MAX_DETECTION_PER_RUN,
      );

      for (const opp of undated) {
        try {
          const funder = opp.funder_id ? (funderById.get(opp.funder_id) ?? null) : null;
          const detection = await this.detectDeadline(
            opp,
            funder,
            byFunder,
            calibration,
            detectionState,
          );
          if (!detection) continue;
          if (detection.tokensUsed) tokensUsed += detection.tokensUsed;

          const { error: updateError } = await this.supabase
            .from("opportunities")
            .update({ deadline: format(detection.date, "yyyy-MM-dd") })
            .eq("id", opp.id)
            .eq("organization_id", this.orgId);

          if (updateError) {
            errors.push(
              `opportunity ${opp.id}: failed to write detected deadline: ${updateError.message}`,
            );
            continue;
          }

          const daysFromNow = differenceInCalendarDays(detection.date, new Date());
          const tier = computeUrgencyTier(daysFromNow);

          await this.recordPrediction({
            opportunityId: opp.id,
            funderId: opp.funder_id,
            predictedDeadline: detection.date,
            source: detection.source,
            confidence: detection.confidence,
            urgencyTier: tier,
            detail: detection.detail,
          });
          deadlinesDetected++;

          decisions.push(
            await this.logDecision({
              decisionType: "deadline_detected",
              agentRunId: runId,
              entityType: "opportunity",
              entityId: opp.id,
              reasoning: `${detection.detail} Source: ${detection.source} (confidence ${Math.round(detection.confidence * 100)}%). Urgency: ${tier}.`,
              confidenceScore: Math.round(detection.confidence * 100),
              actionTaken: `detected_deadline_via_${detection.source}`,
              requiredHumanReview: detection.confidence < 0.8,
            }),
          );

          if (tier === "yellow") {
            yellowBucket.push(`${opp.name} (${format(detection.date, "yyyy-MM-dd")})`);
          } else if (tier === "red" || tier === "amber") {
            const chainedTo = await this.applyUrgencyTier({
              opportunityId: opp.id,
              opportunityName: opp.name,
              deadline: detection.date,
              tier,
            });
            if (chainedTo === "ag-05-draft") {
              redChained++;
              nextActions.push("ag-05-draft");
            } else if (chainedTo === "ag-15-probability") {
              amberChained++;
              nextActions.push("ag-15-probability");
            }
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to detect deadline.";
          errors.push(`opportunity ${opp.id}: ${message}`);
        }
      }

      // --- Phase B: per-funder recurrence prediction (task item 5,
      // extends the pre-upgrade behavior) -----------------------------------
      const qualifyingFunders = funders.filter(
        (f) => (byFunder.get(f.id)?.length ?? 0) >= 2,
      );

      for (const funder of qualifyingFunders) {
        fundersAnalyzed++;

        try {
          const dates = parseSortedDates(byFunder.get(funder.id) ?? []);
          if (dates.length < 2) continue;

          const dataPointCount = dates.length;
          const gaps = computeGaps(dates);
          const pattern = detectPattern(gaps);
          const avgGapDays = Math.round(
            gaps.reduce((a, b) => a + b, 0) / gaps.length,
          );
          const lastDeadline = dates[dates.length - 1];
          if (!lastDeadline) continue;

          const nextOpenDate = addDays(lastDeadline, avgGapDays);
          const nextOpenStr = format(nextOpenDate, "yyyy-MM-dd");
          const daysUntilOpen = differenceInCalendarDays(nextOpenDate, new Date());

          // Always update the cheap per-funder metadata, even for a noisy
          // ("rolling") pattern — task item 5's "separate field" store.
          const { error: funderUpdateError } = await this.supabase
            .from("funders")
            .update({
              next_predicted_open_date: nextOpenStr,
              avg_cycle_length_days: avgGapDays,
            })
            .eq("id", funder.id)
            .eq("organization_id", this.orgId);

          if (funderUpdateError) {
            errors.push(
              `funder ${funder.id}: failed to update recurrence fields: ${funderUpdateError.message}`,
            );
          } else {
            recurrenceUpdated++;
          }

          if (daysUntilOpen > 0 && daysUntilOpen <= RECURRENCE_ALERT_WINDOW_DAYS) {
            const today = format(new Date(), "yyyy-MM-dd");
            await this.supabase.from("alerts").insert({
              organization_id: this.orgId,
              type: "deadline_due",
              severity: "info",
              message: `${funder.name}'s next funding cycle is predicted to open around ${nextOpenStr} (in ${daysUntilOpen} days), based on ${dataPointCount} historical cycles.`,
              dedup_key: `deadline-prediction:recurrence:${funder.id}:${today}`,
            });
            // Errors here (e.g. a duplicate dedup_key from an earlier run
            // today) are non-fatal — it just means this funder was already
            // alerted on today.
          }

          if (pattern === "rolling") continue;
          patternsDetected++;

          const confidence = dataPointCount >= 3 ? HIGH_CONFIDENCE : LOW_CONFIDENCE;
          const daysFromNow = differenceInCalendarDays(nextOpenDate, new Date());
          if (daysFromNow < 0 || daysFromNow > PREDICTION_WINDOW_DAYS) continue;

          const { data: openOpp } = await this.supabase
            .from("opportunities")
            .select("id")
            .eq("organization_id", this.orgId)
            .eq("funder_id", funder.id)
            .eq("status", "open")
            .maybeSingle();

          if (openOpp) continue;

          const year = nextOpenDate.getFullYear();
          const description =
            `Auto-predicted by Deadline Prediction Agent. ${dataPointCount} ` +
            `historical cycles. Confidence: ${confidence}%. Pattern: ${pattern}.`;

          const { data: inserted, error: insertError } = await this.supabase
            .from("opportunities")
            .insert({
              organization_id: this.orgId,
              funder_id: funder.id,
              name: `${funder.name} -- Predicted ${year} Cycle`,
              category: funder.category,
              status: "open",
              source: "agent",
              deadline: nextOpenStr,
              description,
            })
            .select("id")
            .single();

          if (insertError || !inserted) {
            errors.push(
              `funder ${funder.id}: failed to insert predicted opportunity: ${
                insertError?.message ?? "no row returned"
              }`,
            );
            continue;
          }

          const newOppId = (inserted as { id: string }).id;
          opportunitiesCreated++;
          const tier = computeUrgencyTier(daysFromNow);

          await this.recordPrediction({
            opportunityId: newOppId,
            funderId: funder.id,
            predictedDeadline: nextOpenDate,
            source: "cycle_pattern",
            confidence: confidence / 100,
            urgencyTier: tier,
            detail: `${pattern} pattern across ${dataPointCount} cycles for ${funder.name}.`,
          });

          decisions.push(
            await this.logDecision({
              decisionType: "deadline_predicted",
              agentRunId: runId,
              entityType: "opportunity",
              entityId: newOppId,
              reasoning:
                `${pattern} pattern detected for ${funder.name} across ` +
                `${dataPointCount} cycles. Predicted next deadline: ` +
                `${nextOpenStr}. Avg cycle: ${avgGapDays} days.`,
              confidenceScore: confidence,
              actionTaken: "created_projected_opportunity",
              requiredHumanReview: true,
            }),
          );
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to process funder deadline prediction.";
          errors.push(`funder ${funder.id}: ${message}`);
        }
      }

      if (yellowBucket.length > 0) {
        const shown = yellowBucket.slice(0, 8).join("; ");
        const extra =
          yellowBucket.length > 8 ? ` and ${yellowBucket.length - 8} more` : "";
        await this.createNotification(
          "deadline_digest",
          "Deadlines coming up in 22-45 days",
          `${shown}${extra}`,
        );
      }

      const summary = {
        fundersAnalyzed,
        patternsDetected,
        opportunitiesCreated,
        deadlinesDetected,
        recurrenceUpdated,
        redChained,
        amberChained,
        yellowBundled: yellowBucket.length,
        calibrationSampleSize: calibration.sampleSize,
      };

      const itemsQueued = opportunitiesCreated + redChained + amberChained;

      await this.completeRun(runId, {
        outputSummary: JSON.stringify(summary),
        itemsFound: qualifyingFunders.length + undated.length,
        itemsProcessed: fundersAnalyzed + deadlinesDetected,
        itemsQueued,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: qualifyingFunders.length + undated.length,
        itemsProcessed: fundersAnalyzed + deadlinesDetected,
        itemsQueued,
        decisions,
        nextActions,
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Deadline prediction run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: fundersAnalyzed,
        itemsQueued: opportunitiesCreated,
        decisions,
        nextActions,
        errors: [...errors, message],
      };
    }
  }
}
