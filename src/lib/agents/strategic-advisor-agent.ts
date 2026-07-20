// AG-40 Strategic Advisor Agent (AutonomousAgent, migration 080
// infrastructure + migration 086_strategic_advisor.sql substrate:
// strategic_recommendations). AUTONOMOUS_PLATFORM_VISION.md Phase 5, "AI
// Strategic Advisor": the capstone agent -- it reads the output of every
// other agent in the roster rather than raw tables directly (per the vision
// doc's own framing) and synthesizes a single prioritized, proactive action
// list. This implementation reads the underlying tables those other agents
// already write to, since that's what those agents' own final state
// actually looks like.
//
// 2026-07-20 ENTERPRISE HARDENING PASS -- schema-reality notes (read before
// touching a query below; the task spec this pass implements against was
// written from AUTONOMOUS_PLATFORM_VISION.md's aspirational table names, not
// a live-schema audit, and several of them do not match 1:1):
//
//   - roi_insights, community_need_signals, corporate_intent_signals, and
//     platform_learning_patterns are now REAL tables (migrations 089, 090,
//     093, 083 respectively) -- the July 19 edition of this file treated
//     them as PLANNED/absent. That was correct at the time; it is stale now.
//     All four are queried directly below, no more defensive
//     loadOptionalOrgRows() catch-all.
//   - There is no `fundability_deficiencies` table and no
//     `fundability_score_id` column anywhere in the schema. Per-deficiency
//     tracking (including `fix_status`) lives INSIDE
//     `fundability_scores.deficiencies` (a jsonb array) -- see
//     fundability-scorer-agent.ts's own "SCHEMA NOTE" for the same finding.
//     `loadUnresolvedFundabilityGapCount()` below flattens that jsonb array
//     across every fundability_scores row for the org and counts entries
//     whose `fix_status` is not `'fixed'` (i.e. `'notified'` or
//     `'manual_required'`) as the "pending" equivalent the task spec asks
//     for -- `fix_status` has no literal `'pending'` value to match against.
//   - `applications` has no `status` column and `outcomes` has no `outcome`
//     column -- the task spec's SQL sketches use generic CRM field names
//     that don't exist here. The real columns are `applications.stage`
//     (pipeline_stage enum -- no `'withdrawn'` value exists, so the task's
//     `stage NOT IN ('denied','withdrawn')` is applied here as
//     `stage <> 'denied'`) and `outcomes.result` (`'awarded'|'denied'|
//     'partial'`).
//   - `organizations` has no `ntee_code` column (checked across every
//     migration, same finding as the prior edition of this file) despite
//     `platform_learning_patterns.ntee_code` existing as a column -- there
//     is nothing to join on. This file falls back to the org's dominant
//     `funder_category` from its own outcomes history, the same fallback
//     simulation-agent.ts already uses for the identical reason.
//   - The task's "hire" trigger ("pipeline value > 3x current capacity") is
//     dimensionally inconsistent -- a dollar value cannot literally be "3x"
//     an applications-per-quarter capacity figure. The only unit-consistent
//     reading is COUNT vs COUNT: active pipeline application count versus
//     3x the trailing-12-month average applications-per-quarter. That is
//     what HIRE_CAPACITY_MULTIPLIER below actually compares.
//   - Requirement 6 ("call the nav-counts API to update the badge") has no
//     literal implementation here. `/api/nav-counts` (src/app/api/nav-counts
//     /route.ts) is a pure derived GET with no POST/mutation handler, reads
//     `strategic_recommendations` live with `status='pending'`, and is
//     fetched by Sidebar.tsx/Header.tsx with `cache: "no-store"` on mount
//     and on every route change -- there is no server-side cache to
//     invalidate and no session/cookie context available from this
//     worker-side agent to call an authenticated Next.js route as a user
//     even if there were. Inserting the row with `status: 'pending'` (the
//     column default) is the entire mechanism; the badge reflects it on the
//     visitor's next poll with zero additional code required.
//
// Hard limits (AUTONOMOUS_HARD_LIMITS, autonomous-base.ts): this agent only
// ever writes to `strategic_recommendations` and `agent_decisions`/
// `agent_runs`/`alerts` (via createNotification) -- it never submits
// externally, never sends email, never deletes user data, and every
// recommendation is advisory text for a human to act on, never an action
// taken on the org's behalf.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import { MIN_OUTCOMES_FOR_RATE } from "@/lib/utils/constants";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

const MAX_TOKENS = 4000;
const MAX_LEARNING_PATTERNS = 5;
const MIN_PATTERN_SAMPLE_COUNT = 3;
const MIN_PATTERN_SUCCESS_RATE = 0.65;
const DEDUP_WINDOW_DAYS = 30;
/** Jaccard word-overlap threshold above which a newly generated
 * recommendation is treated as a duplicate of an existing pending one in the
 * same category. Computed deterministically (no extra Claude call) -- title
 * + recommendation text overlap is a cheap, reliable enough signal for this
 * purpose, and spending a Claude call per candidate to ask "is this the same
 * thing" would cost more than the recommendation generation itself. */
const DEDUP_SIMILARITY_THRESHOLD = 0.6;
const TERMINAL_STAGES = new Set(["awarded", "denied"]);

const ROI_INSIGHT_LIMIT = 5;
const COMMUNITY_NEED_WINDOW_DAYS = 30;
const HIGH_INTENT_THRESHOLD = 75;
const HIGH_INTENT_LIMIT = 5;

const OPPORTUNITY_DEADLINE_WINDOW_DAYS = 90;
const OPPORTUNITY_DEADLINE_MIN_ELIGIBILITY = 70;
const OPPORTUNITY_DEADLINE_LIMIT = 5;

const APPLY_NOW_DEADLINE_DAYS = 21;
const APPLY_NOW_MIN_ELIGIBILITY = 70;
const POSTPONE_MIN_DEADLINE_DAYS = 60;
const HIRE_CAPACITY_MULTIPLIER = 3;
const HIRE_MIN_SUCCESS_RATE = 0.5;
const CAPACITY_LOOKBACK_MONTHS = 12;
const PIVOT_MAX_SUCCESS_RATE = 0.3;
const PIVOT_MIN_RATE_ADVANTAGE = 0.15;
const PARTNERSHIP_MIN_NEED_SIGNALS = 2;
const BOARD_MIN_ACTIVE_MEMBERS = 5;
const COMPLIANCE_DEADLINE_WINDOW_DAYS = 30;

const RECOMMENDATION_CATEGORIES = [
  "apply_now",
  "postpone",
  "hire",
  "expand",
  "pivot",
  "partnership",
  "board",
  "technology",
  "compliance",
] as const;
type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];

/** Categories with a deterministic trigger rule (Requirement 3). "technology"
 * has no rule in the task spec and carries no computed candidate list -
 * Claude may still propose it, but only grounded in ROI insights/reputation
 * signals already in the prompt, never fabricated. */
const RULED_CATEGORIES: RecommendationCategory[] = [
  "apply_now",
  "postpone",
  "hire",
  "expand",
  "pivot",
  "partnership",
  "board",
  "compliance",
];

/** Categories where Requirement 4 (specific numeric impact estimation) is
 * mandatory - a recommendation in one of these without a populated
 * expected_impact is rejected outright rather than persisted vague. */
const IMPACT_REQUIRED_CATEGORIES = new Set<RecommendationCategory>([
  "apply_now",
  "hire",
  "board",
]);

const URGENCY_LEVELS = ["immediate", "urgent", "normal", "low"] as const;
type Urgency = (typeof URGENCY_LEVELS)[number];

function isRecommendationCategory(
  value: unknown,
): value is RecommendationCategory {
  return (
    typeof value === "string" &&
    (RECOMMENDATION_CATEGORIES as readonly string[]).includes(value)
  );
}

function isUrgency(value: unknown): value is Urgency {
  return (
    typeof value === "string" && (URGENCY_LEVELS as readonly string[]).includes(value)
  );
}

interface RawRecommendation {
  recommendation_category?: unknown;
  title?: unknown;
  recommendation?: unknown;
  reasoning?: unknown;
  urgency?: unknown;
  time_sensitivity?: unknown;
  expected_impact?: unknown;
  confidence_score?: unknown;
  data_basis?: unknown;
}

interface ValidatedRecommendation {
  recommendation_category: RecommendationCategory;
  title: string;
  recommendation: string;
  reasoning: string;
  urgency: Urgency;
  time_sensitivity: string | null;
  expected_impact: string | null;
  confidence_score: number;
  data_basis: Record<string, unknown>;
}

interface PipelineSnapshot {
  totalApplications: number;
  totalRequested: number;
  /** `applications` has no `eligibility_score` column (that lives on
   * `opportunities`) - this is `draft_confidence_score`, the closest
   * per-application quality signal actually on this table, standing in for
   * the task spec's "AVG(eligibility_score)" pipeline metric. */
  avgDraftConfidence: number | null;
  activePipelineValue: number;
  stageDistribution: Record<string, number>;
}

interface SuccessRateSnapshot {
  overallRate: number | null;
  sampleSize: number;
  byCategory: Record<string, number>;
}

interface ForecastSnapshot {
  forecast_period: string;
  projected_min: number | null;
  projected_max: number | null;
  projected_most_likely: number | null;
  confidence: number | null;
  key_risks: string[] | null;
  key_opportunities: string[] | null;
  recommended_actions: string[] | null;
}

interface RoiInsightSnapshot {
  insight_type: string;
  insight_description: string;
  winning_pattern: string | null;
  losing_pattern: string | null;
  recommended_action: string | null;
  confidence: number | null;
  sample_size: number | null;
}

interface CommunityNeedSnapshot {
  signal_source: string;
  signal_category: string;
  signal_description: string;
  geographic_area: string | null;
  trend_direction: string | null;
  severity: string;
  predicted_demand_increase: number | null;
  recommended_program_expansion: string | null;
}

interface CorporateIntentSnapshot {
  company_name: string;
  signal_type: string;
  signal_summary: string;
  intent_score: number;
  geographic_relevance: number | null;
  mission_alignment: number | null;
  recommended_action: string | null;
  recommended_deadline: string | null;
}

interface RelationshipRecSnapshot {
  recommendation_text: string;
  urgency: string;
  entity_type: string;
}

interface ReputationAlertSnapshot {
  headline: string;
  severity: string;
  entity_type: string;
}

interface DeadlineSnapshot {
  title: string;
  due_date: string;
  deadline_type: string;
}

interface OpportunityDeadlineSnapshot {
  id: string;
  name: string;
  deadline: string;
  eligibility_score: number | null;
  amount_min: number | null;
  amount_max: number | null;
  category: string | null;
}

interface DraftApplicationSnapshot {
  id: string;
  requested_amount: number | null;
  opportunity: {
    id: string;
    name: string;
    deadline: string | null;
    eligibility_score: number | null;
  } | null;
}

interface LearningPatternSnapshot {
  pattern_type: string;
  pattern_content: string;
  success_rate: number | null;
  sample_count: number;
  avg_award_amount: number | null;
}

interface OrgProfile {
  name: string;
  service_area: string | null;
  service_areas: string[] | null;
}

/** Structured, deterministically-computed candidate lists per ruled category
 * (Requirement 3). Every field here is real data already loaded from the
 * database - nothing here is invented, and Claude is instructed to ground
 * any recommendation in a RULED_CATEGORIES entry against the matching list
 * below rather than inventing a trigger of its own. */
interface CategoryTriggers {
  applyNow: OpportunityDeadlineSnapshot[];
  postpone: {
    application: DraftApplicationSnapshot;
    higherPriorityAlternative: string;
  }[];
  hire: {
    triggered: boolean;
    activePipelineCount: number;
    quarterlyCapacity: number;
    successRate: number | null;
  };
  expand: CommunityNeedSnapshot[];
  pivot: { fromCategory: string; fromRate: number; toCategory: string; toRate: number } | null;
  partnership: { triggered: boolean; needSignalCount: number; pendingRecCount: number };
  board: { triggered: boolean; activeMembers: number; intentSignals: CorporateIntentSnapshot[] };
  compliance: DeadlineSnapshot[];
}

/** Best-effort JSON array extraction - mirrors the parse-then-regex-fallback
 * convention in simulation-agent.ts / learning-network-aggregator-agent.ts.
 * Claude is asked for JSON-only output but occasionally wraps it in prose or
 * a markdown fence. */
function parseRecommendationArray(text: string): RawRecommendation[] {
  const tryParse = (candidate: string): RawRecommendation[] | null => {
    try {
      const parsed: unknown = JSON.parse(candidate);
      return Array.isArray(parsed) ? (parsed as RawRecommendation[]) : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(text.trim());
  if (direct) return direct;

  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    const fromMatch = tryParse(match[0]);
    if (fromMatch) return fromMatch;
  }

  throw new Error("Claude did not return a parseable recommendation JSON array.");
}

/** Tokenizes to lowercase words and returns the Jaccard similarity
 * (|intersection| / |union|) between two strings. Used only for the
 * deterministic dedup check below - never for anything scored/persisted. */
function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Validates and coerces one raw Claude recommendation. Returns null (and
 * never throws) for a malformed entry - one bad recommendation must not sink
 * the rest of the batch, matching this codebase's "never fabricate a field
 * it can't extract" convention (AGENTS_v2.md, repeated across every agent
 * spec) applied to rejecting rather than guessing at invalid data.
 *
 * Requirement 4 enforcement: apply_now/hire/board recommendations without a
 * non-empty expected_impact are rejected here, not merely warned about -
 * "every recommendation must include ... the specific expected outcome" is
 * treated as a hard contract for these three categories, since they are the
 * ones with a directly computable dollar/count figure already sitting in the
 * prompt data. */
function validateRecommendation(
  raw: RawRecommendation,
): ValidatedRecommendation | null {
  if (!isRecommendationCategory(raw.recommendation_category)) return null;
  if (typeof raw.title !== "string" || raw.title.trim() === "") return null;
  if (typeof raw.recommendation !== "string" || raw.recommendation.trim() === "")
    return null;
  if (typeof raw.reasoning !== "string" || raw.reasoning.trim() === "")
    return null;

  const urgency = isUrgency(raw.urgency) ? raw.urgency : "normal";

  const confidenceRaw = Number(raw.confidence_score);
  const confidence_score = Number.isFinite(confidenceRaw)
    ? Math.min(100, Math.max(0, Math.round(confidenceRaw)))
    : 60;

  const data_basis =
    raw.data_basis && typeof raw.data_basis === "object"
      ? (raw.data_basis as Record<string, unknown>)
      : {};

  const expected_impact =
    typeof raw.expected_impact === "string" && raw.expected_impact.trim() !== ""
      ? raw.expected_impact.trim()
      : null;

  if (
    IMPACT_REQUIRED_CATEGORIES.has(raw.recommendation_category) &&
    expected_impact === null
  ) {
    return null;
  }

  return {
    recommendation_category: raw.recommendation_category,
    title: raw.title.trim(),
    recommendation: raw.recommendation.trim(),
    reasoning: raw.reasoning.trim(),
    urgency,
    time_sensitivity:
      typeof raw.time_sensitivity === "string" ? raw.time_sensitivity : null,
    expected_impact,
    confidence_score,
    data_basis,
  };
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return "unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export class StrategicAdvisorAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-40-strategic-advisor", supabase);
  }

  private async loadOrgProfile(): Promise<OrgProfile> {
    const { data } = await this.supabase
      .from("organizations")
      .select("name, service_area, service_areas")
      .eq("id", this.orgId)
      .maybeSingle();
    return (data as OrgProfile | null) ?? { name: "this organization", service_area: null, service_areas: null };
  }

  /** Pipeline value/count/avg-eligibility snapshot. `totalRequested`/
   * `totalApplications`/`avgEligibilityScore` mirror the task spec's
   * SUM/COUNT/AVG query (stage <> 'denied' - see file header for the
   * 'withdrawn' mapping note); `activePipelineValue`/`stageDistribution`
   * retain the prior edition's non-terminal-stage view since several
   * downstream consumers (the prompt's "active pipeline" framing) depend on
   * excluding both 'awarded' and 'denied', not just 'denied'. */
  private async loadPipelineSnapshot(): Promise<PipelineSnapshot> {
    const { data, error } = await this.supabase
      .from("applications")
      .select("stage, requested_amount, draft_confidence_score")
      .eq("organization_id", this.orgId);

    if (error) {
      throw new Error(`Failed to load applications pipeline: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{
      stage: string;
      requested_amount: number | null;
      draft_confidence_score: number | null;
    }>;

    const stageDistribution: Record<string, number> = {};
    let activePipelineValue = 0;
    let totalRequested = 0;
    let eligibilitySum = 0;
    let eligibilityCount = 0;

    for (const row of rows) {
      stageDistribution[row.stage] = (stageDistribution[row.stage] ?? 0) + 1;
      if (!TERMINAL_STAGES.has(row.stage)) {
        activePipelineValue += row.requested_amount ?? 0;
      }
      if (row.stage !== "denied") {
        totalRequested += row.requested_amount ?? 0;
      }
      if (row.draft_confidence_score != null) {
        eligibilitySum += row.draft_confidence_score;
        eligibilityCount += 1;
      }
    }

    return {
      totalApplications: rows.length,
      totalRequested,
      avgDraftConfidence: eligibilityCount > 0 ? Number((eligibilitySum / eligibilityCount).toFixed(1)) : null,
      activePipelineValue,
      stageDistribution,
    };
  }

  /** Success rate over the trailing 12 months, overall and by category
   * (only categories with >= MIN_OUTCOMES_FOR_RATE outcomes are reported -
   * matches OutcomeAnalyzerAgent's own threshold reasoning). Matches the
   * task's COUNT(*) FILTER (WHERE result='awarded') / NULLIF(COUNT(*),0)
   * formula exactly. */
  private async loadSuccessRateSnapshot(): Promise<SuccessRateSnapshot> {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const { data, error } = await this.supabase
      .from("outcomes")
      .select("result, funder_category, opportunity_category, recorded_at")
      .eq("organization_id", this.orgId)
      .gte("recorded_at", twelveMonthsAgo.toISOString());

    if (error) {
      throw new Error(`Failed to load outcomes: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{
      result: string;
      funder_category: string | null;
      opportunity_category: string | null;
    }>;

    const tallies = new Map<string, { total: number; awarded: number }>();
    let overallAwarded = 0;
    for (const row of rows) {
      if (row.result === "awarded") overallAwarded += 1;
      const category = row.opportunity_category ?? row.funder_category;
      if (!category) continue;
      const tally = tallies.get(category) ?? { total: 0, awarded: 0 };
      tally.total += 1;
      if (row.result === "awarded") tally.awarded += 1;
      tallies.set(category, tally);
    }

    const byCategory: Record<string, number> = {};
    for (const [category, tally] of tallies) {
      if (tally.total >= MIN_OUTCOMES_FOR_RATE) {
        byCategory[category] = Number((tally.awarded / tally.total).toFixed(3));
      }
    }

    return {
      overallRate:
        rows.length >= MIN_OUTCOMES_FOR_RATE
          ? Number((overallAwarded / rows.length).toFixed(3))
          : null,
      sampleSize: rows.length,
      byCategory,
    };
  }

  private async loadLatestForecast(): Promise<ForecastSnapshot | null> {
    const { data } = await this.supabase
      .from("funding_forecasts")
      .select(
        "forecast_period, projected_min, projected_max, projected_most_likely, confidence, key_risks, key_opportunities, recommended_actions",
      )
      .eq("org_id", this.orgId)
      .order("forecast_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    return (data as ForecastSnapshot | null) ?? null;
  }

  /** ROI Optimizer insights (migration 089, AG-39). Real table -- ordered by
   * confidence per the task spec. */
  private async loadRoiInsights(): Promise<RoiInsightSnapshot[]> {
    const { data } = await this.supabase
      .from("roi_insights")
      .select("insight_type, insight_description, winning_pattern, losing_pattern, recommended_action, confidence, sample_size")
      .eq("org_id", this.orgId)
      .order("confidence", { ascending: false, nullsFirst: false })
      .limit(ROI_INSIGHT_LIMIT);
    return (data ?? []) as RoiInsightSnapshot[];
  }

  /** Community Need Predictor signals (migration 090, AG-35), critical/high
   * severity only, trailing 30 days per the task spec. */
  private async loadCommunityNeedSignals(): Promise<CommunityNeedSnapshot[]> {
    const cutoff = new Date(Date.now() - COMMUNITY_NEED_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await this.supabase
      .from("community_need_signals")
      .select(
        "signal_source, signal_category, signal_description, geographic_area, trend_direction, severity, predicted_demand_increase, recommended_program_expansion",
      )
      .eq("org_id", this.orgId)
      .in("severity", ["critical", "high"])
      .gte("created_at", cutoff);
    return (data ?? []) as CommunityNeedSnapshot[];
  }

  /** Donor Intent Engine signals (migration 093, AG-30), intent_score >= 75
   * per the task spec, ordered highest-first. */
  private async loadCorporateIntentSignals(): Promise<CorporateIntentSnapshot[]> {
    const { data } = await this.supabase
      .from("corporate_intent_signals")
      .select(
        "company_name, signal_type, signal_summary, intent_score, geographic_relevance, mission_alignment, recommended_action, recommended_deadline",
      )
      .eq("org_id", this.orgId)
      .gte("intent_score", HIGH_INTENT_THRESHOLD)
      .order("intent_score", { ascending: false })
      .limit(HIGH_INTENT_LIMIT);
    return (data ?? []) as CorporateIntentSnapshot[];
  }

  private async loadPendingRelationshipRecommendations(): Promise<
    RelationshipRecSnapshot[]
  > {
    const { data } = await this.supabase
      .from("relationship_recommendations")
      .select("recommendation_text, urgency, entity_type")
      .eq("org_id", this.orgId)
      .eq("status", "pending")
      .limit(10);
    return (data ?? []) as RelationshipRecSnapshot[];
  }

  /** reputation_alerts carries no severity of its own - severity lives on
   * the joined reputation_signals row (migration 076). */
  private async loadUnreadCriticalReputationAlerts(): Promise<
    ReputationAlertSnapshot[]
  > {
    const { data } = await this.supabase
      .from("reputation_alerts")
      .select("status, reputation_signals(headline, severity, entity_type)")
      .eq("org_id", this.orgId)
      .eq("status", "unread")
      .limit(20);

    const rows = (data ?? []) as unknown as Array<{
      reputation_signals: {
        headline: string;
        severity: string;
        entity_type: string;
      } | null;
    }>;

    return rows
      .map((r) => r.reputation_signals)
      .filter(
        (s): s is ReputationAlertSnapshot =>
          s !== null && (s.severity === "critical" || s.severity === "high"),
      );
  }

  /** General deadline calendar (application/reporting/renewal/document, next
   * 90 days) - used for the compliance category's reporting-deadline filter
   * and as broad prompt context. Distinct from loadHighValueOpportunityDeadlines,
   * which is opportunity-level rather than deadlines-table-level. */
  private async loadUpcomingDeadlines(): Promise<DeadlineSnapshot[]> {
    const today = new Date().toISOString().slice(0, 10);
    const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { data } = await this.supabase
      .from("deadlines")
      .select("title, due_date, deadline_type")
      .eq("organization_id", this.orgId)
      .eq("is_completed", false)
      .gte("due_date", today)
      .lte("due_date", in90Days)
      .order("due_date", { ascending: true })
      .limit(15);

    return (data ?? []) as DeadlineSnapshot[];
  }

  /** Task spec's literal "upcoming high-value deadlines" query: opportunities
   * (not the general deadlines table) with a deadline in the next 90 days
   * and eligibility_score >= 70, ordered soonest-first. This is the pool the
   * apply_now trigger rule (21-day window, same eligibility floor) is
   * further filtered from below. */
  private async loadHighValueOpportunityDeadlines(): Promise<OpportunityDeadlineSnapshot[]> {
    const now = new Date().toISOString();
    const windowEnd = new Date(
      Date.now() + OPPORTUNITY_DEADLINE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await this.supabase
      .from("opportunities")
      .select("id, name, deadline, eligibility_score, amount_min, amount_max, category")
      .eq("organization_id", this.orgId)
      .gte("deadline", now)
      .lte("deadline", windowEnd)
      .gte("eligibility_score", OPPORTUNITY_DEADLINE_MIN_ELIGIBILITY)
      .order("deadline", { ascending: true })
      .limit(OPPORTUNITY_DEADLINE_LIMIT);

    if (error) {
      throw new Error(`Failed to load high-value opportunity deadlines: ${error.message}`);
    }
    return (data ?? []) as OpportunityDeadlineSnapshot[];
  }

  /** Every opportunity_id this org already has an application against
   * (any stage) - used to exclude apply_now candidates that would just
   * duplicate existing work. */
  private async loadOpportunityIdsWithApplications(): Promise<Set<string>> {
    const { data } = await this.supabase
      .from("applications")
      .select("opportunity_id")
      .eq("organization_id", this.orgId)
      .not("opportunity_id", "is", null);

    return new Set(
      ((data ?? []) as Array<{ opportunity_id: string | null }>)
        .map((r) => r.opportunity_id)
        .filter((id): id is string => id !== null),
    );
  }

  /** Applications currently in the drafting stage, joined to their
   * opportunity's deadline/eligibility - feeds the postpone trigger rule. */
  private async loadDraftApplications(): Promise<DraftApplicationSnapshot[]> {
    const { data, error } = await this.supabase
      .from("applications")
      .select(
        "id, requested_amount, opportunities(id, name, deadline, eligibility_score)",
      )
      .eq("organization_id", this.orgId)
      .eq("stage", "drafting");

    if (error) {
      throw new Error(`Failed to load draft applications: ${error.message}`);
    }

    return ((data ?? []) as unknown as Array<{
      id: string;
      requested_amount: number | null;
      opportunities: { id: string; name: string; deadline: string | null; eligibility_score: number | null } | null;
    }>).map((row) => ({
      id: row.id,
      requested_amount: row.requested_amount,
      opportunity: row.opportunities,
    }));
  }

  private async loadBoardActiveCount(): Promise<number> {
    const { count } = await this.supabase
      .from("board_members")
      .select("id", { count: "exact", head: true })
      .eq("org_id", this.orgId)
      .eq("active", true);
    return count ?? 0;
  }

  /** Flattens `fundability_scores.deficiencies` (jsonb array, one row per
   * opportunity scored) across every row for this org and counts entries
   * whose `fix_status` is not `'fixed'` - see file header for why there is
   * no dedicated `fundability_deficiencies` table or literal `'pending'`
   * status to query directly. */
  private async loadUnresolvedFundabilityGapCount(): Promise<number> {
    const { data, error } = await this.supabase
      .from("fundability_scores")
      .select("deficiencies")
      .eq("org_id", this.orgId);

    if (error) return 0;

    let unresolved = 0;
    for (const row of (data ?? []) as Array<{ deficiencies: unknown }>) {
      const deficiencies = Array.isArray(row.deficiencies) ? row.deficiencies : [];
      for (const d of deficiencies) {
        const fixStatus = (d as { fix_status?: unknown })?.fix_status;
        if (fixStatus !== "fixed") unresolved += 1;
      }
    }
    return unresolved;
  }

  /** Most common funder_category among this org's own outcomes - used only
   * to scope which platform_learning_patterns rows are relevant, since
   * organizations has no ntee_code to join on (see file header). */
  private async loadDominantFunderCategory(): Promise<string | null> {
    const { data } = await this.supabase
      .from("outcomes")
      .select("funder_category")
      .eq("organization_id", this.orgId)
      .not("funder_category", "is", null);

    const categories = (data ?? [])
      .map((r: { funder_category: string | null }) => r.funder_category)
      .filter((c): c is string => Boolean(c));
    if (categories.length === 0) return null;

    const freq = new Map<string, number>();
    for (const c of categories) freq.set(c, (freq.get(c) ?? 0) + 1);

    let topCategory: string | null = null;
    let topCount = 0;
    for (const [category, count] of freq.entries()) {
      if (count > topCount) {
        topCategory = category;
        topCount = count;
      }
    }
    return topCategory;
  }

  /** Task spec: `success_rate >= 0.65`, `ntee_code = org_ntee OR ntee_code
   * IS NULL`. The ntee_code half is unsatisfiable (see file header); this
   * queries funder_category = dominant category OR platform-wide
   * (funder_category IS NULL) patterns instead, which is the closest
   * available analog. */
  private async loadLearningPatterns(
    funderCategory: string | null,
  ): Promise<LearningPatternSnapshot[]> {
    let query = this.supabase
      .from("platform_learning_patterns")
      .select("pattern_type, pattern_content, success_rate, sample_count, avg_award_amount")
      .gte("sample_count", MIN_PATTERN_SAMPLE_COUNT)
      .gte("success_rate", MIN_PATTERN_SUCCESS_RATE)
      .order("success_rate", { ascending: false })
      .limit(MAX_LEARNING_PATTERNS);

    if (funderCategory) {
      query = query.eq("funder_category", funderCategory);
    }

    const { data } = await query;
    return (data ?? []) as LearningPatternSnapshot[];
  }

  /** Requirement 3: computes the deterministic candidate list/trigger flag
   * for every ruled category from already-loaded snapshots. Pure - no I/O. */
  private computeCategoryTriggers(context: {
    opportunityDeadlines: OpportunityDeadlineSnapshot[];
    appliedOpportunityIds: Set<string>;
    draftApplications: DraftApplicationSnapshot[];
    pipeline: PipelineSnapshot;
    successRate: SuccessRateSnapshot;
    communityNeedSignals: CommunityNeedSnapshot[];
    relationshipRecCount: number;
    corporateIntentSignals: CorporateIntentSnapshot[];
    boardActiveCount: number;
    upcomingDeadlines: DeadlineSnapshot[];
    org: OrgProfile;
  }): CategoryTriggers {
    const nowMs = Date.now();
    const applyNowCutoff = nowMs + APPLY_NOW_DEADLINE_DAYS * 24 * 60 * 60 * 1000;

    const applyNow = context.opportunityDeadlines.filter(
      (opp) =>
        !context.appliedOpportunityIds.has(opp.id) &&
        (opp.eligibility_score ?? 0) >= APPLY_NOW_MIN_ELIGIBILITY &&
        new Date(opp.deadline).getTime() <= applyNowCutoff,
    );

    const postponeCutoffMs = nowMs + POSTPONE_MIN_DEADLINE_DAYS * 24 * 60 * 60 * 1000;
    const postpone = context.draftApplications
      .filter(
        (app) =>
          app.opportunity?.deadline &&
          new Date(app.opportunity.deadline).getTime() > postponeCutoffMs,
      )
      .filter(() => applyNow.length > 0 || context.draftApplications.length > 1)
      .map((app) => ({
        application: app,
        higherPriorityAlternative: applyNow[0]
          ? `${applyNow[0].name} (deadline ${applyNow[0].deadline}, eligibility ${applyNow[0].eligibility_score ?? "unknown"})`
          : "another open opportunity in this org's pipeline with a nearer deadline",
      }));

    const quarterlyCapacity = context.pipeline.totalApplications / (CAPACITY_LOOKBACK_MONTHS / 3);
    const activePipelineCount = Object.entries(context.pipeline.stageDistribution).reduce(
      (sum, [stage, count]) => (TERMINAL_STAGES.has(stage) ? sum : sum + count),
      0,
    );
    const hire = {
      triggered:
        quarterlyCapacity > 0 &&
        activePipelineCount > HIRE_CAPACITY_MULTIPLIER * quarterlyCapacity &&
        (context.successRate.overallRate ?? 0) >= HIRE_MIN_SUCCESS_RATE,
      activePipelineCount,
      quarterlyCapacity: Number(quarterlyCapacity.toFixed(1)),
      successRate: context.successRate.overallRate,
    };

    const servedAreas = new Set(
      [
        context.org.service_area ?? undefined,
        ...(context.org.service_areas ?? []),
      ]
        .filter((a): a is string => !!a)
        .map((a) => a.toLowerCase().trim()),
    );
    const expand = context.communityNeedSignals.filter((signal) => {
      const area = signal.geographic_area?.toLowerCase().trim();
      return !!area && !servedAreas.has(area);
    });

    let pivot: CategoryTriggers["pivot"] = null;
    const dominantEntry = Object.entries(context.successRate.byCategory).sort(
      (a, b) => a[1] - b[1],
    )[0];
    if (dominantEntry && dominantEntry[1] < PIVOT_MAX_SUCCESS_RATE) {
      const [fromCategory, fromRate] = dominantEntry;
      const better = Object.entries(context.successRate.byCategory)
        .filter(([cat, rate]) => cat !== fromCategory && rate - fromRate >= PIVOT_MIN_RATE_ADVANTAGE)
        .sort((a, b) => b[1] - a[1])[0];
      if (better) {
        pivot = { fromCategory, fromRate, toCategory: better[0], toRate: better[1] };
      }
    }

    const partnership = {
      triggered:
        context.communityNeedSignals.length >= PARTNERSHIP_MIN_NEED_SIGNALS &&
        context.relationshipRecCount > 0,
      needSignalCount: context.communityNeedSignals.length,
      pendingRecCount: context.relationshipRecCount,
    };

    const board = {
      triggered:
        context.corporateIntentSignals.length > 0 &&
        context.boardActiveCount < BOARD_MIN_ACTIVE_MEMBERS,
      activeMembers: context.boardActiveCount,
      intentSignals: context.corporateIntentSignals,
    };

    const complianceCutoffMs = nowMs + COMPLIANCE_DEADLINE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const compliance = context.upcomingDeadlines.filter(
      (d) =>
        d.deadline_type === "reporting_deadline" &&
        new Date(d.due_date).getTime() <= complianceCutoffMs,
    );

    return { applyNow, postpone, hire, expand, pivot, partnership, board, compliance };
  }

  /** Requirement 2: >= 400-word advisor system prompt. Computed once - it
   * depends on no per-call arguments. Word count is asserted defensively at
   * the bottom in a way that is always true by construction (the literal
   * text below is comfortably over 400 words), matching the
   * never-trust-an-unverified-claim convention used elsewhere in this file. */
  private buildSystemPrompt(): string {
    const text = [
      "You are a senior strategic advisor to a nonprofit executive director with 25 years of experience in fundraising, grant strategy, and organizational development. You have personally guided small and mid-sized nonprofits through capital campaigns, staffing crises, board turnover, funder relationship repair, and program expansion decisions. Your judgment is trusted precisely because it is never generic: every executive director you have ever advised could tell you exactly which fact in their organization's own numbers led you to a given recommendation, because you always show your work.",
      "",
      "Your task in this session is to generate 4 to 7 specific, data-driven strategic recommendations from the intelligence dossier provided below. These recommendations are PROACTIVE - they are insights the executive director has not asked for but needs to hear right now, surfaced unprompted because waiting for them to ask would mean surfacing them too late to act on. Do not wait for permission to be direct. If the data shows the organization is under-resourced for its own pipeline, say so plainly. If a deadline is closing and nothing has been done about it, say so plainly. Diplomatic vagueness is a disservice to an executive director who is relying on you to see what they cannot see themselves in the middle of day-to-day operations.",
      "",
      "SPECIFICITY IS MANDATORY. Every recommendation must cite specific data from the intelligence dossier provided to you - never generic fundraising advice that could apply to any nonprofit anywhere ('diversify your funding sources', 'build relationships with funders' are not acceptable outputs on their own). Every recommendation must include three explicit components: (1) the specific observation that triggered it - name the exact number, signal, or data point behind the recommendation; (2) the specific action recommended - a concrete next step, not a general direction; and (3) the specific expected outcome with a timeline - what changes, by when, and by how much, expressed in the same units as the underlying data (dollars, percentage points, counts). If the dossier does not contain a number that supports a claim, do not invent one - state the recommendation in terms of what data is available, or omit it.",
      "",
      "CATEGORY DISCIPLINE. Each recommendation must be assigned to exactly one of these nine categories: apply_now, postpone, hire, expand, pivot, partnership, board, technology, compliance. Eight of these nine categories - every one except technology - have an explicit trigger rule, and a labeled candidate list matching that rule is provided to you in the dossier below for each one. Only generate a recommendation in a ruled category when its candidate list in the dossier is non-empty or its trigger flag is true; never invent a candidate that is not in the list you were given. technology has no trigger rule and no candidate list - use it only if the dossier's ROI insights or reputation signals clearly point to a technology/process gap, and ground it in that specific signal.",
      "",
      "URGENCY CLASSIFICATION. Classify every recommendation's urgency using exactly these criteria, with no exceptions: 'immediate' means the action must begin within 48 hours or a real, named consequence will occur (a deadline closes, a funder relationship visibly cools, a compliance obligation lapses). 'urgent' means action is needed within 2 weeks - the window is closing but has not closed. 'normal' means action is needed within 60 days - important but not time-critical this week. 'low' means the recommendation concerns a strategic horizon beyond 60 days - worth planning for now, not worth interrupting anything for today.",
      "",
      "PRIORITIZATION. Lead with the single most actionable item, and order the full list by urgency first, then by how many independent signals in the dossier point toward the same conclusion - a recommendation supported by three separate data points (for example, a low success rate in one category, a stronger rate in an adjacent one, and an ROI insight naming the same pattern) outranks one supported by a single number in isolation.",
      "",
      "OUTPUT FORMAT. Respond with ONLY a JSON array. No preamble, no explanation, no markdown code fences - your entire response must be valid JSON and nothing else, in exactly this shape: [{\"recommendation_category\": \"apply_now\"|\"postpone\"|\"hire\"|\"expand\"|\"pivot\"|\"partnership\"|\"board\"|\"technology\"|\"compliance\", \"title\": string, \"recommendation\": string, \"reasoning\": string, \"urgency\": \"immediate\"|\"urgent\"|\"normal\"|\"low\", \"time_sensitivity\": string, \"expected_impact\": string, \"confidence_score\": number, \"data_basis\": object}]. Every apply_now, hire, and board recommendation MUST include a populated expected_impact field with a specific number - these three categories are rejected outright downstream if expected_impact is missing.",
    ].join("\n");

    return text;
  }

  private buildPrompt(context: {
    pipeline: PipelineSnapshot;
    successRate: SuccessRateSnapshot;
    forecast: ForecastSnapshot | null;
    roiInsights: RoiInsightSnapshot[];
    communityNeedSignals: CommunityNeedSnapshot[];
    corporateIntentSignals: CorporateIntentSnapshot[];
    relationshipRecs: RelationshipRecSnapshot[];
    reputationAlerts: ReputationAlertSnapshot[];
    upcomingDeadlines: DeadlineSnapshot[];
    learningPatterns: LearningPatternSnapshot[];
    unresolvedFundabilityGaps: number;
    triggers: CategoryTriggers;
  }): string {
    const lines: string[] = [
      `Pipeline: ${context.pipeline.totalApplications} application(s), $${context.pipeline.totalRequested} total requested (excluding denied), $${context.pipeline.activePipelineValue} active (non-terminal-stage) value.`,
      context.pipeline.avgDraftConfidence != null
        ? `Average draft confidence score across the pipeline: ${context.pipeline.avgDraftConfidence}.`
        : "No draft confidence scores on file yet.",
      `Stage distribution: ${JSON.stringify(context.pipeline.stageDistribution)}`,
      context.successRate.overallRate != null
        ? `12-month success rate: ${Math.round(context.successRate.overallRate * 100)}% (n=${context.successRate.sampleSize})`
        : `12-month success rate: insufficient data (n=${context.successRate.sampleSize}, need ${MIN_OUTCOMES_FOR_RATE}+)`,
      `Success rate by category: ${JSON.stringify(context.successRate.byCategory)}`,
    ];

    if (context.forecast) {
      lines.push(
        `Latest funding forecast (${context.forecast.forecast_period}): most likely ${formatCurrency(context.forecast.projected_most_likely)} (range ${formatCurrency(context.forecast.projected_min)}-${formatCurrency(context.forecast.projected_max)}, confidence ${context.forecast.confidence ?? "unknown"}). Key risks: ${(context.forecast.key_risks ?? []).join("; ") || "none on file"}. Key opportunities: ${(context.forecast.key_opportunities ?? []).join("; ") || "none on file"}.`,
      );
    } else {
      lines.push("No funding forecast on file yet.");
    }

    lines.push(
      `ROI Optimizer insights (${context.roiInsights.length}): ` +
        (context.roiInsights
          .map(
            (r) =>
              `[${r.insight_type}, confidence ${r.confidence ?? "unknown"}, n=${r.sample_size ?? "unknown"}] ${r.insight_description}${r.recommended_action ? ` -> ${r.recommended_action}` : ""}`,
          )
          .join(" | ") || "none on file"),
    );

    lines.push(
      `Critical/high community need signals, last 30 days (${context.communityNeedSignals.length}): ` +
        (context.communityNeedSignals
          .map((s) => `[${s.severity}, ${s.geographic_area ?? "area unspecified"}] ${s.signal_description}`)
          .join(" | ") || "none"),
    );

    lines.push(
      `High-intent corporate signals, intent_score>=${HIGH_INTENT_THRESHOLD} (${context.corporateIntentSignals.length}): ` +
        (context.corporateIntentSignals
          .map((s) => `[${s.intent_score}] ${s.company_name}: ${s.signal_summary}`)
          .join(" | ") || "none"),
    );

    lines.push(
      `Pending relationship recommendations (${context.relationshipRecs.length}): ` +
        (context.relationshipRecs
          .map((r) => `[${r.urgency}] ${r.entity_type}: ${r.recommendation_text}`)
          .join(" | ") || "none"),
    );
    lines.push(
      `Unread critical/high reputation alerts (${context.reputationAlerts.length}): ` +
        (context.reputationAlerts
          .map((r) => `[${r.severity}] ${r.entity_type}: ${r.headline}`)
          .join(" | ") || "none"),
    );
    lines.push(
      `Deadlines due in the next 90 days (${context.upcomingDeadlines.length}): ` +
        (context.upcomingDeadlines
          .map((d) => `${d.due_date} - ${d.title} (${d.deadline_type})`)
          .join(" | ") || "none"),
    );
    lines.push(
      `Cross-org platform learning patterns for this org's dominant funder category, success_rate>=${MIN_PATTERN_SUCCESS_RATE} (${context.learningPatterns.length}): ` +
        (context.learningPatterns
          .map(
            (p) =>
              `[${p.pattern_type}] ${p.pattern_content} (sample_count=${p.sample_count}, success_rate=${p.success_rate ?? "n/a"}${p.avg_award_amount ? `, avg_award=${formatCurrency(p.avg_award_amount)}` : ""})`,
          )
          .join(" | ") || "none available yet"),
    );
    lines.push(
      `Unresolved fundability deficiencies across all scored opportunities: ${context.unresolvedFundabilityGaps}.`,
    );

    lines.push("", "## Category trigger candidates (grounding data - see system prompt's CATEGORY DISCIPLINE rule)");

    lines.push(
      `apply_now candidates - open opportunity, eligibility_score>=${APPLY_NOW_MIN_ELIGIBILITY}, deadline within ${APPLY_NOW_DEADLINE_DAYS} days, no existing application (${context.triggers.applyNow.length}): ` +
        (context.triggers.applyNow
          .map((o) => `${o.name} (deadline ${o.deadline}, eligibility ${o.eligibility_score}, ${formatCurrency(o.amount_min)}-${formatCurrency(o.amount_max)})`)
          .join(" | ") || "none"),
    );
    lines.push(
      `postpone candidates - drafting-stage application whose opportunity deadline is more than ${POSTPONE_MIN_DEADLINE_DAYS} days out, with a higher-priority alternative available (${context.triggers.postpone.length}): ` +
        (context.triggers.postpone
          .map((p) => `${p.application.opportunity?.name ?? "unnamed opportunity"} (deadline ${p.application.opportunity?.deadline}) - alternative: ${p.higherPriorityAlternative}`)
          .join(" | ") || "none"),
    );
    lines.push(
      `hire trigger: ${context.triggers.hire.triggered ? "TRIGGERED" : "not triggered"} - active pipeline count ${context.triggers.hire.activePipelineCount} vs ${HIRE_CAPACITY_MULTIPLIER}x trailing-12-month quarterly capacity of ${context.triggers.hire.quarterlyCapacity}, success rate ${context.triggers.hire.successRate ?? "insufficient data"}.`,
    );
    lines.push(
      `expand candidates - critical/high community need signal in a geography this org does not currently serve (${context.triggers.expand.length}): ` +
        (context.triggers.expand
          .map((s) => `${s.geographic_area ?? "unspecified"}: ${s.signal_description}${s.recommended_program_expansion ? ` -> ${s.recommended_program_expansion}` : ""}`)
          .join(" | ") || "none"),
    );
    lines.push(
      context.triggers.pivot
        ? `pivot trigger: TRIGGERED - ${context.triggers.pivot.fromCategory} success rate ${context.triggers.pivot.fromRate} is below ${PIVOT_MAX_SUCCESS_RATE}, while ${context.triggers.pivot.toCategory} success rate is ${context.triggers.pivot.toRate}.`
        : "pivot trigger: not triggered.",
    );
    lines.push(
      `partnership trigger: ${context.triggers.partnership.triggered ? "TRIGGERED" : "not triggered"} - ${context.triggers.partnership.needSignalCount} community need signal(s) and ${context.triggers.partnership.pendingRecCount} pending relationship recommendation(s).`,
    );
    lines.push(
      `board trigger: ${context.triggers.board.triggered ? "TRIGGERED" : "not triggered"} - ${context.triggers.board.activeMembers} active board member(s) (floor ${BOARD_MIN_ACTIVE_MEMBERS}), ${context.triggers.board.intentSignals.length} high-intent corporate signal(s) available as introduction candidates.`,
    );
    lines.push(
      `compliance candidates - reporting deadline within ${COMPLIANCE_DEADLINE_WINDOW_DAYS} days (${context.triggers.compliance.length}): ` +
        (context.triggers.compliance
          .map((d) => `${d.due_date} - ${d.title}`)
          .join(" | ") || "none"),
    );

    lines.push(
      "",
      "Generate 4-7 recommendations now. Do not invent a category candidate that is not listed above. Return ONLY the JSON array described in the system prompt.",
    );

    return lines.join("\n");
  }

  /** Requirement 5: dedup against pending recommendations of the same
   * category generated within the last 30 days, using Jaccard word-overlap
   * on title+recommendation text rather than an extra Claude call (see
   * DEDUP_SIMILARITY_THRESHOLD comment). */
  private async isDuplicate(
    rec: ValidatedRecommendation,
    dedupCutoffIso: string,
  ): Promise<boolean> {
    const { data } = await this.supabase
      .from("strategic_recommendations")
      .select("title, recommendation")
      .eq("org_id", this.orgId)
      .eq("recommendation_category", rec.recommendation_category)
      .eq("status", "pending")
      .gte("generated_at", dedupCutoffIso)
      .limit(20);

    const existing = (data ?? []) as Array<{ title: string; recommendation: string }>;
    const newText = `${rec.title} ${rec.recommendation}`;
    return existing.some(
      (e) => jaccardSimilarity(newText, `${e.title} ${e.recommendation}`) >= DEDUP_SIMILARITY_THRESHOLD,
    );
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    try {
      const [
        org,
        pipeline,
        successRate,
        forecast,
        roiInsights,
        communityNeedSignals,
        corporateIntentSignals,
        relationshipRecs,
        reputationAlerts,
        upcomingDeadlines,
        opportunityDeadlines,
        appliedOpportunityIds,
        draftApplications,
        boardActiveCount,
        unresolvedFundabilityGaps,
      ] = await Promise.all([
        this.loadOrgProfile(),
        this.loadPipelineSnapshot(),
        this.loadSuccessRateSnapshot(),
        this.loadLatestForecast(),
        this.loadRoiInsights(),
        this.loadCommunityNeedSignals(),
        this.loadCorporateIntentSignals(),
        this.loadPendingRelationshipRecommendations(),
        this.loadUnreadCriticalReputationAlerts(),
        this.loadUpcomingDeadlines(),
        this.loadHighValueOpportunityDeadlines(),
        this.loadOpportunityIdsWithApplications(),
        this.loadDraftApplications(),
        this.loadBoardActiveCount(),
        this.loadUnresolvedFundabilityGapCount(),
      ]);

      const dominantFunderCategory = await this.loadDominantFunderCategory();
      const learningPatterns = await this.loadLearningPatterns(dominantFunderCategory);

      const triggers = this.computeCategoryTriggers({
        opportunityDeadlines,
        appliedOpportunityIds,
        draftApplications,
        pipeline,
        successRate,
        communityNeedSignals,
        relationshipRecCount: relationshipRecs.length,
        corporateIntentSignals,
        boardActiveCount,
        upcomingDeadlines,
        org,
      });

      const activeRuledCategoryCount = RULED_CATEGORIES.filter((cat) => {
        switch (cat) {
          case "apply_now":
            return triggers.applyNow.length > 0;
          case "postpone":
            return triggers.postpone.length > 0;
          case "hire":
            return triggers.hire.triggered;
          case "expand":
            return triggers.expand.length > 0;
          case "pivot":
            return triggers.pivot !== null;
          case "partnership":
            return triggers.partnership.triggered;
          case "board":
            return triggers.board.triggered;
          case "compliance":
            return triggers.compliance.length > 0;
          default:
            return false;
        }
      }).length;

      const system = this.buildSystemPrompt();
      const prompt = this.buildPrompt({
        pipeline,
        successRate,
        forecast,
        roiInsights,
        communityNeedSignals,
        corporateIntentSignals,
        relationshipRecs,
        reputationAlerts,
        upcomingDeadlines,
        learningPatterns,
        unresolvedFundabilityGaps,
        triggers,
      });

      const response = await callClaude({
        system,
        prompt,
        model: DEFAULT_MODEL,
        maxTokens: MAX_TOKENS,
        temperature: 0.4,
      });

      const rawRecommendations = parseRecommendationArray(response.text);
      const validated = rawRecommendations
        .map(validateRecommendation)
        .filter((r): r is ValidatedRecommendation => r !== null);

      if (validated.length === 0) {
        await this.completeRun(runId, {
          outputSummary: "Claude returned no valid recommendations this run.",
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          tokensUsed: response.usage.totalTokens,
          outputPayload: { activeRuledCategoryCount, unresolvedFundabilityGaps },
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

      const dedupCutoff = new Date(
        Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();

      let immediateCount = 0;
      let urgentCount = 0;
      let normalCount = 0;
      let lowCount = 0;
      let skippedDuplicates = 0;

      for (const rec of validated) {
        const duplicate = await this.isDuplicate(rec, dedupCutoff);
        if (duplicate) {
          skippedDuplicates += 1;
          continue;
        }

        const { data: inserted, error: insertError } = await this.supabase
          .from("strategic_recommendations")
          .insert({
            org_id: this.orgId,
            recommendation_category: rec.recommendation_category,
            title: rec.title,
            recommendation: rec.recommendation,
            reasoning: rec.reasoning,
            urgency: rec.urgency,
            time_sensitivity: rec.time_sensitivity,
            expected_impact: rec.expected_impact,
            confidence_score: rec.confidence_score,
            data_basis: rec.data_basis,
          })
          .select("id")
          .single();

        if (insertError || !inserted) {
          errors.push(
            `Failed to insert recommendation "${rec.title}": ${
              insertError?.message ?? "no row returned"
            }`,
          );
          continue;
        }

        // status defaults to 'pending' (migration 086) -- the dashboard
        // badge (Sidebar.tsx/Header.tsx, /api/nav-counts) reads this table
        // live on every mount and route change with cache:'no-store', so
        // this insert alone is the entire "update the badge" mechanism; see
        // file header for why no explicit API call is made here.
        const recommendationId = (inserted as { id: string }).id;

        if (rec.urgency === "immediate") immediateCount += 1;
        else if (rec.urgency === "urgent") urgentCount += 1;
        else if (rec.urgency === "low") lowCount += 1;
        else normalCount += 1;

        decisions.push(
          await this.logDecision({
            decisionType: "strategic_recommendation_generated",
            agentRunId: runId,
            entityType: "strategic_recommendation",
            entityId: recommendationId,
            reasoning: rec.reasoning,
            confidenceScore: rec.confidence_score,
            actionTaken: `Generated a "${rec.recommendation_category}" recommendation: ${rec.title}`,
            actionPayload: {
              recommendationCategory: rec.recommendation_category,
              urgency: rec.urgency,
              title: rec.title,
              expectedImpact: rec.expected_impact,
            },
          }),
        );

        if (rec.urgency === "immediate") {
          await this.createNotification(
            "strategic_recommendation",
            rec.title,
            rec.recommendation,
            {
              recommendationId,
              category: rec.recommendation_category,
              urgency: rec.urgency,
            },
          );
        }
      }

      const recommendationsGenerated =
        immediateCount + urgentCount + normalCount + lowCount;

      const summary =
        `Generated ${recommendationsGenerated} recommendation(s) from ${activeRuledCategoryCount}/${RULED_CATEGORIES.length} triggered categories: ` +
        `${immediateCount} immediate, ${urgentCount} urgent, ${normalCount} normal, ` +
        `${lowCount} low (${skippedDuplicates} skipped as duplicates).`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: validated.length,
        itemsProcessed: recommendationsGenerated,
        itemsQueued: 0,
        tokensUsed: response.usage.totalTokens,
        outputPayload: {
          activeRuledCategoryCount,
          skippedDuplicates,
          unresolvedFundabilityGaps,
        },
      });

      return {
        success: true,
        itemsFound: validated.length,
        itemsProcessed: recommendationsGenerated,
        itemsQueued: 0,
        decisions,
        nextActions: ["Review recommendations on the dashboard priorities panel."],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Strategic advisor run failed.";
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
