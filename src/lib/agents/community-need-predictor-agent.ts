// AG-35 Community Need Predictor Agent (AutonomousAgent, migration 090:
// community_need_signals). Phase 3 per AUTONOMOUS_PLATFORM_VISION.md §7
// ("Community Need Prediction") and AGENTS_v2.md's Phase 2-5 spec section.
//
// Purpose: ingests census, housing-price, employment, health, education, and
// disaster signals for an org's service area and forecasts service demand
// before it materializes - directly extending the Faith Foundation pilot's
// rural Texas emergency/transitional housing use case (BLUEPRINT_v2.md §1)
// named explicitly in this agent's own spec.
//
// ENTERPRISE HARDENING (this revision): the original implementation asked
// Claude for a single merged signal sweep across all seven data sources in
// one call, and trusted Claude's own severity/predicted_demand_increase
// numbers verbatim. This revision:
//   1. Runs the DATA SOURCE MATRIX as distinct, source-specific web searches
//      (one Claude call per applicable category) rather than one combined
//      prompt, so each source gets its own targeted query string and its own
//      grounding check.
//   2. Has Claude classify trend_direction only (increasing/decreasing/
//      stable/spike) against a stated baseline-comparison rule - it never
//      asks Claude to output a demand percentage, matching this file's
//      existing "never estimate a number from general knowledge" principle
//      one step further: predicted_demand_increase is now a deterministic
//      function of trend_direction, computed in code, not asked of the model.
//   3. Deterministically maps signal category -> Faith Foundation program
//      type and specific grant programs to pursue (never left to the model).
//   4. Cross-references newly created signals against this org's own
//      `opportunities` table by funder_category and surfaces a "matching
//      grants" notification when any are found.
//   5. Computes severity from predicted_demand_increase/trend_direction
//      (not from whatever severity string Claude happens to emit) and gates
//      notification urgency on that computed severity.
//
// Per-org scope: like every other AutonomousAgent (see
// roi-optimizer-agent.ts, knowledge-gap-agent.ts), this class operates on
// `this.orgId` only. A multi-org loop belongs in a future
// worker/autonomous-orchestrator.ts registration, not inside this class.
// AG-35 is still PLANNED per AGENTS_v2.md and depends on ingestion adapters
// (census, housing, employment, eviction, weather, school enrollment,
// migration) that mostly don't exist yet - this agent uses Claude's
// web_search tool as a stand-in for those adapters rather than waiting on
// all seven to be built first.
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
// rows and, for critical/high severity or matching-grant discovery, an alert
// - it never touches applications, opportunities, or KB rows.
//
// NTEE deviation note: the task spec gates the health and education search
// categories on the org's "health/human services NTEE" and "education NTEE"
// classification. `organizations` has no ntee_code column (that field only
// exists on `foundation_directory`/`nonprofits`, per SCHEMA_REGISTRY_v2.md) -
// this is a task-spec-vs-real-schema collision, not a bug. This agent infers
// the equivalent focus flags from `mission_statement`, `target_population`,
// and the org's own program_description knowledge base entries via keyword
// matching instead, documented in `inferOrgFocusFlags()` below.
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

/** opportunities.category (funder_category enum, migration 001). Hardcoded
 * locally like every other agent in this directory queries `opportunities` -
 * there is no shared exported type for it. */
type FunderCategory =
  | "corporate_donation"
  | "corporate_sponsorship"
  | "corporate_foundation"
  | "private_foundation"
  | "government_grant"
  | "local_community_grant"
  | "housing_grant"
  | "education_grant"
  | "faith_compatible_grant"
  | "in_kind_donation"
  | "materials_donation"
  | "down_payment_assistance";

type DataSourceKey =
  | "census"
  | "housing"
  | "employment"
  | "health"
  | "education"
  | "disaster";

const TREND_DIRECTIONS: TrendDirection[] = [
  "increasing",
  "decreasing",
  "stable",
  "spike",
];

const MAX_SIGNALS_PER_RUN = 12;
const MAX_SIGNALS_PER_CATEGORY = 4;
const CATEGORY_MAX_TOKENS = 1200;
const CATEGORY_MAX_SEARCHES = 2;

/** Maps a computed severity to the confidence score logged on its decision.
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

/** Item 3: base_demand_increase = trend_severity_score * 10. */
const TREND_SEVERITY_SCORE: Record<TrendDirection, number> = {
  spike: 10,
  increasing: 5,
  stable: 0,
  decreasing: -3,
};

interface OrgProfile {
  id: string;
  name: string;
  service_area: string | null;
  target_population: string | null;
  mission_statement: string | null;
  tax_status: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface KnowledgeBaseProgramRow {
  title: string;
  content: string;
}

interface OrgFocusFlags {
  isHealthHumanServices: boolean;
  isEducation: boolean;
}

interface DataSourceCategoryConfig {
  key: DataSourceKey;
  label: string;
  defaultSignalSource: SignalSource;
  buildQuery: (cityState: string) => string;
  /** Item 1(d)/1(e): health and education categories only run for orgs whose
   * inferred focus matches. Census/housing/employment/disaster always run. */
  applicable?: (flags: OrgFocusFlags) => boolean;
}

/** Item 1: the data source matrix. Each entry maps 1:1 to one of the six
 * required searches, run as its own grounded Claude call rather than folded
 * into one combined prompt. */
const DATA_SOURCE_MATRIX: DataSourceCategoryConfig[] = [
  {
    key: "census",
    label: "Census",
    defaultSignalSource: "census",
    buildQuery: (cs) => `${cs} population poverty rate 2024 2025 census`,
  },
  {
    key: "housing",
    label: "Housing",
    defaultSignalSource: "housing_prices",
    buildQuery: (cs) =>
      `${cs} housing prices rent increase eviction rate 2025`,
  },
  {
    key: "employment",
    label: "Employment",
    defaultSignalSource: "employment",
    buildQuery: (cs) => `${cs} unemployment rate job losses 2025`,
  },
  {
    key: "health",
    label: "Health",
    // No `health` value on community_need_signals.signal_source's CHECK
    // constraint (migration 090 only allows the 9 values in SignalSource
    // above) - mapped to 'economic' as the closest fit for a social
    // determinant metric rather than widening the enum for this task.
    defaultSignalSource: "economic",
    buildQuery: (cs) => `${cs} health disparities uninsured rate 2025`,
    applicable: (flags) => flags.isHealthHumanServices,
  },
  {
    key: "education",
    label: "Education",
    defaultSignalSource: "school_enrollment",
    buildQuery: (cs) => `${cs} school enrollment dropout rate 2025`,
    applicable: (flags) => flags.isEducation,
  },
  {
    key: "disaster",
    label: "Disaster",
    defaultSignalSource: "disaster",
    buildQuery: (cs) => `${cs} FEMA disaster declaration 2025`,
  },
];

interface RawCategorySignal {
  signal_category?: string;
  signal_description?: string;
  geographic_area?: string;
  trend_direction?: string;
  data_date?: string;
}

interface ValidatedCategorySignal {
  signal_category: string;
  signal_description: string;
  geographic_area: string | null;
  trend_direction: TrendDirection;
  data_date: string | null;
}

interface ClassifiedRecommendation {
  recommendation: string;
  grantPrograms: string;
  focusCategories: FunderCategory[];
}

interface MatchedOpportunity {
  id: string;
  name: string;
  category: string;
  deadline: string | null;
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

/** Validates one of Claude's raw per-category signal objects. Rejects
 * outright (rather than inserting and letting the DB CHECK constraint
 * reject it) anything missing a category/description or carrying an
 * unrecognized trend_direction - trend_direction is required here because
 * item 3's demand-increase formula depends on it. */
function validateCategorySignal(
  raw: RawCategorySignal,
): ValidatedCategorySignal | null {
  if (!raw.signal_category || !raw.signal_description) return null;
  if (
    !raw.trend_direction ||
    !TREND_DIRECTIONS.includes(raw.trend_direction as TrendDirection)
  ) {
    return null;
  }

  const data_date =
    typeof raw.data_date === "string" && isValidDate(raw.data_date)
      ? raw.data_date
      : null;

  return {
    signal_category: raw.signal_category,
    signal_description: raw.signal_description,
    geographic_area: raw.geographic_area ?? null,
    trend_direction: raw.trend_direction as TrendDirection,
    data_date,
  };
}

/** Item 3: predicted_demand_increase = trend_severity_score * 10, capped at
 * 150%. Deterministic - never asked of Claude, see file header. */
function computeDemandIncrease(trend: TrendDirection): number {
  return Math.min(150, TREND_SEVERITY_SCORE[trend] * 10);
}

/** Item 6: severity escalation thresholds. CRITICAL: predicted_demand_increase
 * >= 50 OR a spike trend. HIGH: 20-49. MEDIUM: 5-19. LOW: below 5 (including
 * negative/improving trends). */
function computeSeverity(
  trend: TrendDirection,
  demandIncrease: number,
): Severity {
  if (trend === "spike" || demandIncrease >= 50) return "critical";
  if (demandIncrease >= 20) return "high";
  if (demandIncrease >= 5) return "medium";
  return "low";
}

/** Item 4: program recommendation engine. Cross-cutting matchers (veteran,
 * recovery, housing/eviction, employment) are checked against the signal's
 * own text first regardless of which data source category produced it -
 * e.g. a "housing" search that surfaces a veteran-specific shelter shortage
 * should still recommend Veterans Path Home, not the generic housing line.
 * Falls back to a per-category default for signals that don't match any of
 * the four named program types. */
function classifyRecommendation(
  category: DataSourceKey,
  text: string,
): ClassifiedRecommendation {
  const lower = text.toLowerCase();

  if (/\bveteran/.test(lower) || /\bmilitary\b/.test(lower)) {
    return {
      recommendation: "Expand Veterans Path Home program",
      grantPrograms:
        "VA Supportive Services for Veteran Families (SSVF) grants and veteran-focused housing grants",
      focusCategories: ["government_grant", "faith_compatible_grant"],
    };
  }
  if (/recovery|substance|addiction|opioid|sober/.test(lower)) {
    return {
      recommendation: "Expand Recovery Housing and Cornerstone Communities",
      grantPrograms:
        "SAMHSA recovery housing grants and state opioid response grants",
      focusCategories: ["government_grant", "faith_compatible_grant"],
    };
  }
  if (/housing|eviction|rent|homeless/.test(lower)) {
    return {
      recommendation:
        "Expand Housing Voucher Program and Emergency Bridge Housing",
      grantPrograms:
        "HUD Continuum of Care grants, Emergency Solutions Grants, and state housing trust fund grants",
      focusCategories: [
        "housing_grant",
        "down_payment_assistance",
        "local_community_grant",
      ],
    };
  }
  if (/unemployment|job loss|job losses|workforce|layoff/.test(lower)) {
    return {
      recommendation:
        "Expand Financial Literacy and Second Chance Reentry programs",
      grantPrograms:
        "Department of Labor workforce development grants and state reentry employment grants",
      focusCategories: ["government_grant", "local_community_grant"],
    };
  }

  switch (category) {
    case "census":
      return {
        recommendation:
          "Assess capacity for population growth across core service programs",
        grantPrograms:
          "local community foundation grants and government demographic-response grants",
        focusCategories: ["local_community_grant", "government_grant"],
      };
    case "health":
      return {
        recommendation:
          "Expand health navigation and uninsured support referral services",
        grantPrograms:
          "HRSA community health center grants and state uninsured-assistance grants",
        focusCategories: ["government_grant", "local_community_grant"],
      };
    case "education":
      return {
        recommendation:
          "Expand youth education support and after-school programming",
        grantPrograms:
          "Dept. of Education 21st Century Community Learning Centers grants and local education foundation grants",
        focusCategories: ["education_grant", "local_community_grant"],
      };
    case "disaster":
      return {
        recommendation:
          "Activate disaster response capacity and emergency relief programs",
        grantPrograms:
          "FEMA public assistance grants and disaster relief foundation grants",
        focusCategories: ["government_grant", "local_community_grant"],
      };
    default:
      return {
        recommendation: "Review program capacity against this signal",
        grantPrograms: "local community and government grants",
        focusCategories: ["local_community_grant", "government_grant"],
      };
  }
}

/** NTEE deviation (see file header): keyword-based stand-in for the
 * `ntee_code` classification `organizations` doesn't have. Defaults
 * isHealthHumanServices to true - nearly every direct-service nonprofit
 * (including the Faith Foundation pilot's housing mission) qualifies as
 * "human services" under a broad reading, so the conservative default is to
 * run the health category rather than silently skip it. isEducation stays
 * false unless explicit education keywords are found. */
function inferOrgFocusFlags(
  org: OrgProfile,
  programSummaryText: string,
): OrgFocusFlags {
  const text = [
    org.mission_statement,
    org.target_population,
    org.tax_status,
    programSummaryText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const EDUCATION_KEYWORDS = [
    "education",
    "school",
    "literacy",
    "tutoring",
    "student",
    "after-school",
    "afterschool",
    "dropout",
    "scholarship",
    "youth development",
  ];
  const NON_HUMAN_SERVICES_KEYWORDS = ["arts", "environment", "wildlife"];

  const isEducation = EDUCATION_KEYWORDS.some((k) => text.includes(k));
  const explicitlyNonHumanServices =
    NON_HUMAN_SERVICES_KEYWORDS.some((k) => text.includes(k)) &&
    !/housing|shelter|health|human services|social services|homeless/.test(
      text,
    );

  return {
    isHealthHumanServices: !explicitlyNonHumanServices,
    isEducation,
  };
}

export class CommunityNeedPredictorAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-35-community-need", supabase);
  }

  private async loadOrg(): Promise<OrgProfile> {
    const { data: orgRow, error: orgError } = await this.supabase
      .from("organizations")
      .select(
        "id, name, service_area, target_population, mission_statement, tax_status, city, state, zip",
      )
      .eq("id", this.orgId)
      .maybeSingle();

    if (orgError || !orgRow) {
      throw new Error(
        `Could not load organization ${this.orgId}: ${
          orgError?.message ?? "not found"
        }`,
      );
    }
    return orgRow as OrgProfile;
  }

  private async loadProgramSummary(): Promise<string> {
    const { data: programRows } = await this.supabase
      .from("knowledge_base")
      .select("title, content")
      .eq("organization_id", this.orgId)
      .eq("category", "program_description");

    const programs = (programRows ?? []) as KnowledgeBaseProgramRow[];
    return programs.length > 0
      ? programs.map((p) => `- ${p.title}: ${p.content.slice(0, 300)}`).join("\n")
      : "No program_description knowledge base entries on file.";
  }

  private buildCategoryPrompt(
    cfg: DataSourceCategoryConfig,
    query: string,
    cityState: string,
    org: OrgProfile,
    programSummary: string,
  ): string {
    return (
      `You are researching current, real conditions for a nonprofit's service area using web search. ` +
      `Organization: ${org.name}. Service area: ${cityState}. ` +
      `Target population: ${org.target_population ?? "not specified"}. ` +
      `Mission: ${org.mission_statement ?? "not specified"}.\n\n` +
      `Current programs:\n${programSummary}\n\n` +
      `Search specifically for: "${query}"\n\n` +
      `Only report a signal when you found real, cited evidence via search - never estimate or infer a number from general knowledge. ` +
      `Classify trend as: increasing (metric worsening >5%), decreasing (metric improving >5%), stable (within 5%), or spike (sudden >20% change in under 90 days). ` +
      `Compare against the most recent prior baseline period available (prior year or prior quarter) to make this classification.\n\n` +
      `Respond with ONLY a JSON array (no markdown fences, no prose) of up to ${MAX_SIGNALS_PER_CATEGORY} objects shaped exactly ` +
      `{"signal_category": string, "signal_description": string citing the specific statistic and its source, ` +
      `"geographic_area": string, "trend_direction": one of ${JSON.stringify(TREND_DIRECTIONS)}, ` +
      `"data_date": "YYYY-MM-DD" of the source data if known}. ` +
      `If you find no real evidence for this query, respond with an empty JSON array [].`
    );
  }

  private async researchCategory(
    cfg: DataSourceCategoryConfig,
    cityState: string,
    org: OrgProfile,
    programSummary: string,
    errors: string[],
  ): Promise<{ signals: ValidatedCategorySignal[]; tokensUsed: number }> {
    const query = cfg.buildQuery(cityState);
    const prompt = this.buildCategoryPrompt(cfg, query, cityState, org, programSummary);

    const response = await callClaudeWithWebSearch({
      prompt,
      maxTokens: CATEGORY_MAX_TOKENS,
      maxSearches: CATEGORY_MAX_SEARCHES,
    });

    if (!response.usedWebSearch) {
      errors.push(
        `${cfg.label}: Claude did not issue a web_search call - discarded ungrounded response rather than persist fabricated signals.`,
      );
      return { signals: [], tokensUsed: response.usage.totalTokens };
    }

    let rawSignals: RawCategorySignal[] = [];
    try {
      const jsonText = response.text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "");
      const parsed: unknown = JSON.parse(jsonText);
      if (Array.isArray(parsed)) rawSignals = parsed as RawCategorySignal[];
    } catch (parseErr) {
      errors.push(
        `${cfg.label}: could not parse Claude's response as JSON: ${
          parseErr instanceof Error ? parseErr.message : "unknown parse error"
        }`,
      );
    }

    const signals = rawSignals
      .map(validateCategorySignal)
      .filter((s): s is ValidatedCategorySignal => s !== null)
      .slice(0, MAX_SIGNALS_PER_CATEGORY);

    return { signals, tokensUsed: response.usage.totalTokens };
  }

  /** Item 5: grant opportunity linkage. Queries this org's own open
   * opportunities for a category match against the signal's recommended
   * focus categories. Read-only - never creates or modifies an opportunity
   * or application (hard limit, see file header). */
  private async findMatchingOpportunities(
    focusCategories: FunderCategory[],
  ): Promise<MatchedOpportunity[]> {
    if (focusCategories.length === 0) return [];

    const { data } = await this.supabase
      .from("opportunities")
      .select("id, name, category, deadline")
      .eq("organization_id", this.orgId)
      .eq("status", "open")
      .in("category", focusCategories)
      .order("deadline", { ascending: true, nullsFirst: false })
      .limit(5);

    return (data ?? []) as MatchedOpportunity[];
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;

    try {
      const org = await this.loadOrg();
      const programSummary = await this.loadProgramSummary();

      const cityState =
        [org.city, org.state].filter(Boolean).join(", ") ||
        org.service_area ||
        `${org.name}'s service area`;

      const focusFlags = inferOrgFocusFlags(org, programSummary);

      const applicableCategories = DATA_SOURCE_MATRIX.filter(
        (cfg) => !cfg.applicable || cfg.applicable(focusFlags),
      );

      let rawFoundCount = 0;
      const allSignals: Array<{
        cfg: DataSourceCategoryConfig;
        signal: ValidatedCategorySignal;
      }> = [];

      for (const cfg of applicableCategories) {
        const { signals, tokensUsed: catTokens } = await this.researchCategory(
          cfg,
          cityState,
          org,
          programSummary,
          errors,
        );
        tokensUsed += catTokens;
        rawFoundCount += signals.length;
        for (const signal of signals) {
          if (allSignals.length >= MAX_SIGNALS_PER_RUN) break;
          allSignals.push({ cfg, signal });
        }
      }

      let itemsQueued = 0;
      let grantMatchesLinked = 0;

      for (const { cfg, signal } of allSignals) {
        const demandIncrease = computeDemandIncrease(signal.trend_direction);
        const severity = computeSeverity(signal.trend_direction, demandIncrease);

        const combinedText = `${signal.signal_category} ${signal.signal_description}`;
        const isEvictionSpecific =
          cfg.key === "housing" && /eviction/i.test(combinedText);
        const signalSource: SignalSource = isEvictionSpecific
          ? "eviction_data"
          : cfg.defaultSignalSource;

        const classification = classifyRecommendation(cfg.key, combinedText);
        const recommendedProgramExpansion = `${classification.recommendation}. Apply for: ${classification.grantPrograms}.`;

        const { data: inserted, error: insertError } = await this.supabase
          .from("community_need_signals")
          .insert({
            org_id: this.orgId,
            signal_source: signalSource,
            signal_category: signal.signal_category,
            signal_description: signal.signal_description,
            geographic_area: signal.geographic_area,
            trend_direction: signal.trend_direction,
            severity,
            predicted_demand_increase: demandIncrease,
            recommended_program_expansion: recommendedProgramExpansion,
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

        // Item 6: severity escalation. CRITICAL logs a decision AND fires an
        // immediate notification. HIGH logs a decision (daily digest
        // inclusion rides on agent_decisions/agent_runs, same as every other
        // agent's digest-eligible output). MEDIUM/LOW are persisted only -
        // they surface through the existing weekly digest path.
        if (severity === "critical" || severity === "high") {
          decisions.push(
            await this.logDecision({
              decisionType: "community_need_signal_detected",
              agentRunId: runId,
              entityType: "community_need_signal",
              entityId: signalId,
              reasoning: signal.signal_description,
              confidenceScore: SEVERITY_CONFIDENCE[severity],
              actionTaken: `Recorded ${severity} community need signal: ${signal.signal_category} (predicted demand +${demandIncrease}%)`,
              actionPayload: {
                ...signal,
                signal_source: signalSource,
                severity,
                predicted_demand_increase: demandIncrease,
                recommended_program_expansion: recommendedProgramExpansion,
              },
              requiredHumanReview: true,
            }),
          );
        }

        if (severity === "critical") {
          await this.createNotification(
            "community_need_critical",
            `Critical community need signal: ${signal.signal_category}`,
            `${signal.signal_description} Predicted demand increase: ${demandIncrease}%. ${recommendedProgramExpansion}`,
            undefined,
            "error",
          );
        }

        // Item 5: grant opportunity linkage.
        const matches = await this.findMatchingOpportunities(
          classification.focusCategories,
        );
        if (matches.length > 0) {
          grantMatchesLinked += 1;
          const matchNames = matches
            .slice(0, 3)
            .map((m) => m.name)
            .join(", ");
          await this.createNotification(
            "community_need_grant_match",
            `${matches.length} open opportunit${matches.length === 1 ? "y" : "ies"} match a community need signal`,
            `"${signal.signal_category}" (${severity}) matches: ${matchNames}${
              matches.length > 3 ? `, and ${matches.length - 3} more` : ""
            }.`,
            undefined,
            severity === "critical" ? "warning" : "info",
          );
        }
      }

      const summary =
        itemsQueued > 0
          ? `Researched ${org.name}'s service area (${cityState}) across ${applicableCategories.length} data source${
              applicableCategories.length === 1 ? "" : "s"
            }; recorded ${itemsQueued} community need signal(s), linked ${grantMatchesLinked} to matching opportunities.`
          : `Researched ${org.name}'s service area (${cityState}) across ${applicableCategories.length} data source${
              applicableCategories.length === 1 ? "" : "s"
            }; no signal met validation against real search evidence.`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: rawFoundCount,
        itemsProcessed: allSignals.length,
        itemsQueued,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: rawFoundCount,
        itemsProcessed: allSignals.length,
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
