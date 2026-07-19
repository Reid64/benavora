// AG-35 Community Need Predictor Agent (AutonomousAgent, migration 090:
// community_need_signals). Phase 3 per AUTONOMOUS_PLATFORM_VISION.md §7
// ("Community Need Prediction") and AGENTS_v2.md's Phase 2-5 spec section.
//
// Purpose: ingests census, housing-price, employment, eviction, disaster,
// and school-enrollment signals for an org's service area and forecasts
// service demand before it materializes - directly extending the Faith
// Foundation pilot's rural Texas emergency/transitional housing use case
// (BLUEPRINT_v2.md §1) named explicitly in this agent's own spec.
//
// Per-org scope: like every other AutonomousAgent (see
// roi-optimizer-agent.ts, knowledge-gap-agent.ts), this class operates on
// `this.orgId` only. AutonomousAgent's constructor requires a single orgId
// and every inherited method (logDecision, getOrgConfig, createNotification)
// scopes itself to that org - a multi-org loop belongs in a future
// worker/autonomous-orchestrator.ts registration, not inside this class.
// Wiring that registration is out of scope here: AG-35 is still PLANNED per
// AGENTS_v2.md and depends on ingestion adapters (census, housing,
// employment, eviction, weather, school enrollment, migration) that mostly
// don't exist yet - this agent uses Claude's web_search tool as a stand-in
// for those adapters rather than waiting on all seven to be built first.
//
// Grounding: uses callClaudeWithWebSearch() (src/lib/ai/claude.ts) rather
// than the plain callClaude() every other agent in this file uses, because
// asking Claude to state specific current housing-price/eviction/employment
// percentages from training data alone would be fabrication (CLAUDE.md Iron
// Law #8, #3) - this task is inherently a "what changed recently" question
// that requires live search grounding, not recall.
//
// Hard limit (AGENTS_v2.md AG-35 spec): never auto-generates a grant
// application from a predicted need - this is intelligence for a human to
// act on, structurally analogous to AG-25 (Disaster Response)'s "surfaces,
// never submits" pattern. This agent only ever inserts community_need_signals
// rows and, for critical severity, an alert - it never touches applications,
// opportunities, or KB rows.
//
// org_autonomous_config has no auto_community_need_enabled toggle (migration
// 080's seven auto_*_enabled booleans don't cover this feature) and no
// nightly cron slot exists for it yet (worker/scheduler.ts has exactly two
// fixed jobs) - like AG-08/AG-09/AG-10/AG-11/AG-12 (renewal tracker, outcome
// analyzer, document expiry, knowledge gap, search optimizer), this agent
// runs whenever a future orchestrator registration instantiates it per org,
// not gated on a toggle that doesn't exist.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaudeWithWebSearch } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

type SignalSource =
  | "census"
  | "housing_prices"
  | "employment"
  | "eviction_data"
  | "weather"
  | "disaster"
  | "school_enrollment"
  | "migration"
  | "economic";

type TrendDirection = "increasing" | "decreasing" | "stable" | "spike";
type Severity = "critical" | "high" | "medium" | "low";

const SIGNAL_SOURCES: SignalSource[] = [
  "census",
  "housing_prices",
  "employment",
  "eviction_data",
  "weather",
  "disaster",
  "school_enrollment",
  "migration",
  "economic",
];
const TREND_DIRECTIONS: TrendDirection[] = [
  "increasing",
  "decreasing",
  "stable",
  "spike",
];
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

/** Maps a signal's severity to the confidence score logged on its decision.
 * Mirrors AUTONOMOUS_HARD_LIMITS.MIN_CONFIDENCE_TO_ACT (60) - only
 * critical/high signals clear the floor and get an agent_decisions row;
 * medium/low are still persisted to community_need_signals but not logged
 * as a decision, matching the "surfaces, never submits" framing above. */
const SEVERITY_CONFIDENCE: Record<Severity, number> = {
  critical: 90,
  high: 70,
  medium: 45,
  low: 25,
};

const MAX_SIGNALS_PER_RUN = 12;
const MAX_TOKENS = 3000;

interface OrgProfile {
  id: string;
  name: string;
  service_area: string | null;
  target_population: string | null;
  mission_statement: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface KnowledgeBaseProgramRow {
  title: string;
  content: string;
}

interface RawSignal {
  signal_source?: string;
  signal_category?: string;
  signal_description?: string;
  geographic_area?: string;
  trend_direction?: string;
  severity?: string;
  predicted_demand_increase?: number;
  recommended_program_expansion?: string;
  data_date?: string;
}

interface ValidatedSignal {
  signal_source: SignalSource;
  signal_category: string;
  signal_description: string;
  geographic_area: string | null;
  trend_direction: TrendDirection | null;
  severity: Severity | null;
  predicted_demand_increase: number | null;
  recommended_program_expansion: string | null;
  data_date: string | null;
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

/** Validates and coerces one of Claude's raw signal objects against
 * community_need_signals' CHECK constraints (migration 090). Invalid
 * source/category/description is rejected outright rather than inserted and
 * left to the database to reject - matching roi-optimizer-agent.ts's
 * client-side significance filter before insert. */
function validateSignal(raw: RawSignal): ValidatedSignal | null {
  if (
    !raw.signal_source ||
    !SIGNAL_SOURCES.includes(raw.signal_source as SignalSource)
  ) {
    return null;
  }
  if (!raw.signal_category || !raw.signal_description) {
    return null;
  }

  const trend_direction =
    raw.trend_direction &&
    TREND_DIRECTIONS.includes(raw.trend_direction as TrendDirection)
      ? (raw.trend_direction as TrendDirection)
      : null;

  const severity =
    raw.severity && SEVERITIES.includes(raw.severity as Severity)
      ? (raw.severity as Severity)
      : null;

  const predicted_demand_increase =
    typeof raw.predicted_demand_increase === "number" &&
    Number.isFinite(raw.predicted_demand_increase)
      ? Math.round(raw.predicted_demand_increase)
      : null;

  const data_date =
    typeof raw.data_date === "string" && isValidDate(raw.data_date)
      ? raw.data_date
      : null;

  return {
    signal_source: raw.signal_source as SignalSource,
    signal_category: raw.signal_category,
    signal_description: raw.signal_description,
    geographic_area: raw.geographic_area ?? null,
    trend_direction,
    severity,
    predicted_demand_increase,
    recommended_program_expansion: raw.recommended_program_expansion ?? null,
    data_date,
  };
}

export class CommunityNeedPredictorAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-35-community-need", supabase);
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;

    try {
      const { data: orgRow, error: orgError } = await this.supabase
        .from("organizations")
        .select("id, name, service_area, target_population, mission_statement, city, state, zip")
        .eq("id", this.orgId)
        .maybeSingle();

      if (orgError || !orgRow) {
        throw new Error(
          `Could not load organization ${this.orgId}: ${
            orgError?.message ?? "not found"
          }`,
        );
      }
      const org = orgRow as OrgProfile;

      const { data: programRows } = await this.supabase
        .from("knowledge_base")
        .select("title, content")
        .eq("organization_id", this.orgId)
        .eq("category", "program_description");

      const programs = (programRows ?? []) as KnowledgeBaseProgramRow[];

      const serviceAreaDescription =
        org.service_area ||
        [org.city, org.state, org.zip].filter(Boolean).join(", ") ||
        "not specified in the org profile";

      const programSummary =
        programs.length > 0
          ? programs.map((p) => `- ${p.title}: ${p.content.slice(0, 300)}`).join("\n")
          : "No program_description knowledge base entries on file.";

      const prompt =
        `You are researching current, real conditions for a nonprofit's service area using web search. ` +
        `Organization: ${org.name}. Service area: ${serviceAreaDescription}. ` +
        `Target population: ${org.target_population ?? "not specified"}. ` +
        `Mission: ${org.mission_statement ?? "not specified"}.\n\n` +
        `Current programs:\n${programSummary}\n\n` +
        `Use web search to find recent, specific data for this service area covering as many of these as you can find real evidence for: ` +
        `(1) census population/demographic trends, (2) housing price or rent trends, (3) unemployment/employment trends, ` +
        `(4) eviction filing trends, (5) recent FEMA/state disaster declarations, (6) school enrollment changes, (7) migration/relocation trends. ` +
        `Only report a signal when you found real, cited evidence via search - never estimate or infer a percentage from general knowledge. ` +
        `For each significant signal found, assess severity (critical/high/medium/low) based on how sharply it changes near-term service demand, ` +
        `and recommend a specific program expansion tied to this org's actual programs listed above (not a generic suggestion).\n\n` +
        `Respond with ONLY a JSON array (no markdown fences, no prose) of up to ${MAX_SIGNALS_PER_RUN} objects shaped exactly ` +
        `{"signal_source": one of ${JSON.stringify(SIGNAL_SOURCES)}, "signal_category": string, "signal_description": string, ` +
        `"geographic_area": string, "trend_direction": one of ${JSON.stringify(TREND_DIRECTIONS)}, ` +
        `"severity": one of ${JSON.stringify(SEVERITIES)}, "predicted_demand_increase": integer percent (can be negative), ` +
        `"recommended_program_expansion": string, "data_date": "YYYY-MM-DD" of the source data if known}. ` +
        `If you find no real evidence for a category, omit it entirely rather than inventing a signal.`;

      const response = await callClaudeWithWebSearch({
        prompt,
        maxTokens: MAX_TOKENS,
        maxSearches: 8,
      });
      tokensUsed += response.usage.totalTokens;

      if (!response.usedWebSearch) {
        errors.push(
          "Claude did not issue a web_search call for this run - any signals returned are not grounded in live data and were discarded.",
        );
        await this.completeRun(runId, {
          outputSummary:
            "No web_search call was made; discarded ungrounded response rather than persist fabricated signals.",
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          tokensUsed,
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

      let rawSignals: RawSignal[] = [];
      try {
        const jsonText = response.text
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/```\s*$/i, "");
        const parsed: unknown = JSON.parse(jsonText);
        if (Array.isArray(parsed)) rawSignals = parsed as RawSignal[];
      } catch (parseErr) {
        errors.push(
          `Could not parse Claude's signal research as JSON: ${
            parseErr instanceof Error ? parseErr.message : "unknown parse error"
          }`,
        );
      }

      const validated = rawSignals
        .map(validateSignal)
        .filter((s): s is ValidatedSignal => s !== null)
        .slice(0, MAX_SIGNALS_PER_RUN);

      let itemsQueued = 0;
      for (const signal of validated) {
        const { data: inserted, error: insertError } = await this.supabase
          .from("community_need_signals")
          .insert({
            org_id: this.orgId,
            signal_source: signal.signal_source,
            signal_category: signal.signal_category,
            signal_description: signal.signal_description,
            geographic_area: signal.geographic_area,
            trend_direction: signal.trend_direction,
            severity: signal.severity,
            predicted_demand_increase: signal.predicted_demand_increase,
            recommended_program_expansion: signal.recommended_program_expansion,
            data_date: signal.data_date,
          })
          .select("id")
          .single();

        if (insertError || !inserted) {
          errors.push(
            `Failed to save signal "${signal.signal_category}": ${
              insertError?.message ?? "no row returned"
            }`,
          );
          continue;
        }

        itemsQueued += 1;
        const signalId = (inserted as { id: string }).id;

        if (signal.severity === "critical" || signal.severity === "high") {
          decisions.push(
            await this.logDecision({
              decisionType: "community_need_signal_detected",
              agentRunId: runId,
              entityType: "community_need_signal",
              entityId: signalId,
              reasoning: signal.signal_description,
              confidenceScore: SEVERITY_CONFIDENCE[signal.severity],
              actionTaken: `Recorded ${signal.severity} community need signal: ${signal.signal_category}`,
              actionPayload: signal as unknown as Record<string, unknown>,
              requiredHumanReview: true,
            }),
          );
        }

        if (signal.severity === "critical") {
          await this.createNotification(
            "community_need_critical",
            `Critical community need signal: ${signal.signal_category}`,
            signal.recommended_program_expansion ?? signal.signal_description,
          );
        }
      }

      const summary =
        validated.length > 0
          ? `Researched ${org.name}'s service area (${serviceAreaDescription}); recorded ${itemsQueued} community need signal(s).`
          : `Researched ${org.name}'s service area (${serviceAreaDescription}); no signal met validation against real search evidence.`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: rawSignals.length,
        itemsProcessed: validated.length,
        itemsQueued,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: rawSignals.length,
        itemsProcessed: validated.length,
        itemsQueued,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Community need prediction run failed.";
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
