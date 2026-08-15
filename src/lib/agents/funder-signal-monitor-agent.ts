// AG-43 Funder Signal Monitor Agent (AutonomousAgent, migration 137:
// funder_relationship_signals). FEATURE_REGISTRY_v2.md row #99 ("Signal
// Monitoring"), Pillar 4 (Autonomous Relationship Builder), Phase 2.
//
// Same underlying pattern as AG-30 Donor Intent Monitor
// (donor-intent-monitor-agent.ts): a per-target grounded web search, forced
// via callClaudeWithWebSearch's maxSearches:1 so the search actually fires,
// Claude extracts structured signals from that search's real results only,
// a deterministic (non-LLM) factor scores real structured data, signals are
// deduped over a rolling window, and every signal produces a recommended
// action for a human, never an autonomous outreach action. Retargeted from
// "will this corporate prospect start giving" (AG-30, corporate_prospects,
// shared pool) to "does this org's own funder show a real, actionable
// relationship-building signal" (this agent, `funders`, org-scoped CRM).
//
// Distinct from AG-18 Reputation Intelligence (reputation-agent.ts): AG-18
// screens funders for RISK (lawsuit, fraud, scandal, leadership scandal).
// This agent screens for RELATIONSHIP OPPORTUNITY (a new decision-maker to
// build rapport with, a funding priority that matches this org's mission, a
// program expansion worth applying into). A funder can trigger both agents
// independently from the same underlying event (e.g. a leadership change is
// a risk signal to AG-18 only if it's abrupt/controversial, and a
// relationship signal to this agent regardless of tone) - that overlap is
// expected, not a duplicate build.
//
// Scope, deliberately narrowed from this row's original "LinkedIn + news +
// 990 watching" description: LinkedIn is EXCLUDED, on purpose, not silently
// dropped. LinkedIn has no public API for monitoring third-party posts/pages
// without a paid partner integration this project doesn't have; scraping
// LinkedIn directly for this would violate LinkedIn's own Terms of Service -
// a real legal/ToS risk, not a technical blocker to route around, and
// consistent with BEHAVIORAL_CONTRACTS.md §21's existing "respect robots.txt
// / never scrape login-protected pages" posture and §27's "NEVER contact
// competitors or scrape their websites" precedent for this same class of
// risk. The two halves actually built:
//
//   1. News (source='news'): 3 targeted, independently-issued web searches
//      per funder (board/leadership, funding priorities/RFPs, program
//      announcements), Claude-extracted into 5 relationship-relevant signal
//      types (see SIGNAL_TYPES below) - the exact AG-30 mechanism, new
//      query templates and signal taxonomy.
//   2. 990 filing (source='990_filing'): a deterministic, non-LLM check
//      against foundation_directory's real ProPublica-sourced 990 data
//      (enrichment.propublica - see AGENT_VERIFICATION_LOG.md's row #66/990
//      pipeline), matched to this org's funder by name+state (funders has
//      no ein/foundation_directory_id FK - the join is best-effort, same
//      posture as geographicRelevanceFactor's own documented fallbacks in
//      AG-30). When a match exists, surfaces the funder's real most-recent
//      total assets/revenue/expenses and fiscal period as one concrete
//      signal - not a guess, not a Claude-invented number. No live
//      time-series exists for a single foundation_directory row (it is one
//      snapshot per EIN, not per-fiscal-year history like
//      funder_giving_history), so this cannot detect a real year-over-year
//      *change* the way AG-42 Change Monitor does for its own tables -
//      stated explicitly rather than fabricating a trend. Funders with no
//      foundation_directory match (most corporate donors - Walmart, Meade
//      Tractor - have no 990-PF at all) simply produce zero 990 signals for
//      that funder, which is correct behavior, not an error.
//
// Hard limits (AUTONOMOUS_HARD_LIMITS): never asserts a signal as fact -
// every row carries its signal_url/signal_date (news) or its real
// foundation_directory fiscal_period (990) as evidence, and only ever
// surfaces a recommended_action for a human. This agent never contacts a
// funder, drafts outreach, or triggers AG-11/AG-24/AG-24-adjacent flows.
// High-scoring signals are additionally bridged into `relationship_memory`
// (migration 127) so AG-19 Relationship Builder can read them - the same
// bridge convention ReputationIntelligenceAgent already established for its
// own HIGH/CRITICAL signals.

import type { SupabaseClient } from "@supabase/supabase-js";
import { differenceInCalendarDays, format, subDays } from "date-fns";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaudeWithWebSearch } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

type NewsSignalType =
  | "leadership_change"
  | "board_appointment"
  | "funding_priority_announcement"
  | "program_expansion"
  | "public_recognition";

type SignalType = NewsSignalType | "990_filing";

const NEWS_SIGNAL_TYPES: NewsSignalType[] = [
  "leadership_change",
  "board_appointment",
  "funding_priority_announcement",
  "program_expansion",
  "public_recognition",
];

/** Base weight per news signal type - a funding priority announcement or a
 * program expansion is directly actionable (there's a real ask to make
 * right now); leadership/board changes are a relationship-building window
 * before priorities are set; public recognition is real but the weakest
 * predictor of near-term action. */
const NEWS_SIGNAL_BASE_SCORE: Record<NewsSignalType, number> = {
  funding_priority_announcement: 90,
  program_expansion: 80,
  leadership_change: 70,
  board_appointment: 65,
  public_recognition: 40,
};

const NEWS_SIGNAL_APPROACH: Record<NewsSignalType, string> = {
  funding_priority_announcement:
    "respond directly to the announced funding priority with an aligned request",
  program_expansion:
    "reference the program expansion and request a conversation about fit for this cycle",
  leadership_change:
    "send a congratulatory introduction to the new leader before their giving priorities are set",
  board_appointment:
    "welcome the newly appointed board/trustee member and offer a short organizational briefing",
  public_recognition:
    "send a congratulatory note referencing the recognition to keep the relationship warm",
};

const RELATIONSHIP_SCORE_THRESHOLD = 60;
const HIGH_SCORE_THRESHOLD = 80;
const MAX_FUNDERS_PER_RUN = 5;
const MAX_NEWS_SIGNALS_PER_FUNDER = 3;
const MAX_TOKENS = 900;
const DEDUP_WINDOW_DAYS = 60;
/** foundation_directory's enrichment.propublica.fiscal_period older than
 * this many years is treated as stale - the underlying 990 datum is still
 * real, but it should not carry the same weight as a recent filing. */
const STALE_FISCAL_YEARS = 3;

interface OrgProfile {
  id: string;
  name: string;
  mission_statement: string | null;
  service_area: string | null;
  target_population: string | null;
  city: string | null;
  state: string | null;
}

interface FunderRow {
  id: string;
  name: string;
  category: string;
  geographic_focus: string | null;
  website: string | null;
}

interface FoundationDirectoryMatch {
  ein: string;
  fiscal_period: number | null;
  total_revenue: number | null;
  total_assets: number | null;
  total_expenses: number | null;
  ntee_code: string | null;
}

interface RawNewsSignal {
  signal_type?: string;
  signal_summary?: string;
  signal_url?: string;
  signal_date?: string;
  mission_alignment?: number;
}

interface ValidatedNewsSignal {
  signal_type: NewsSignalType;
  signal_summary: string;
  signal_url: string | null;
  signal_date: string | null;
  mission_alignment: number; // 0-100, Claude's classification judgment
}

function clamp0to100(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

function validateNewsSignal(raw: RawNewsSignal): ValidatedNewsSignal | null {
  if (!raw.signal_type || !NEWS_SIGNAL_TYPES.includes(raw.signal_type as NewsSignalType)) {
    return null;
  }
  if (!raw.signal_summary || raw.signal_summary.trim() === "") return null;

  const signal_date =
    typeof raw.signal_date === "string" && isValidDate(raw.signal_date)
      ? raw.signal_date
      : null;

  return {
    signal_type: raw.signal_type as NewsSignalType,
    signal_summary: raw.signal_summary,
    signal_url:
      typeof raw.signal_url === "string" && raw.signal_url.trim() !== ""
        ? raw.signal_url
        : null,
    signal_date,
    mission_alignment: clamp0to100(raw.mission_alignment, 50),
  };
}

function extractJsonArray(text: string): RawNewsSignal[] {
  const jsonText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    const parsed: unknown = JSON.parse(jsonText);
    return Array.isArray(parsed) ? (parsed as RawNewsSignal[]) : [];
  } catch {
    return [];
  }
}

/** News signal score: base weight * mission-alignment factor, with a
 * recency boost for time-sensitive types (a funding priority announcement
 * or program expansion found within the last 30 days is more actionable
 * than one from a year ago) - same recency-multiplier shape AG-30 already
 * established for disaster_declaration. */
function computeNewsScore(
  signalType: NewsSignalType,
  missionFactor: number,
  signalDate: string | null,
): number {
  const base = NEWS_SIGNAL_BASE_SCORE[signalType];
  let recencyMultiplier = 1.0;
  if (
    (signalType === "funding_priority_announcement" || signalType === "program_expansion") &&
    signalDate
  ) {
    const daysSince = differenceInCalendarDays(new Date(), new Date(signalDate));
    if (daysSince >= 0 && daysSince <= 30) recencyMultiplier = 1.2;
  }
  const raw = base * recencyMultiplier * missionFactor;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** Deterministic capacity factor from real 990 data - a fixed, documented
 * bucketing of total assets, not a model guess. Mirrors AG-30's
 * geographicRelevanceFactor in spirit: a structured comparison over real
 * fields is more reliable than asking Claude to eyeball a dollar figure. */
function capacityFactorFromAssets(totalAssets: number | null): number {
  if (totalAssets === null) return 0.4;
  if (totalAssets >= 50_000_000) return 0.9;
  if (totalAssets >= 10_000_000) return 0.7;
  if (totalAssets >= 1_000_000) return 0.5;
  return 0.3;
}

function computeFilingScore(match: FoundationDirectoryMatch): number {
  const capacity = capacityFactorFromAssets(match.total_assets);
  const currentYear = new Date().getFullYear();
  const stale =
    match.fiscal_period !== null && currentYear - match.fiscal_period > STALE_FISCAL_YEARS;
  const staleFactor = stale ? 0.7 : 1.0;
  return Math.max(0, Math.min(100, Math.round(capacity * 100 * staleFactor)));
}

function formatCurrency(value: number | null): string {
  if (value === null) return "not reported";
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function buildFilingSummary(funderName: string, match: FoundationDirectoryMatch): string {
  const periodText = match.fiscal_period ? `FY${match.fiscal_period}` : "its most recent filing";
  return (
    `${funderName}'s most recent IRS 990 data on file (${periodText}, EIN ${match.ein}): ` +
    `total assets ${formatCurrency(match.total_assets)}, total revenue ${formatCurrency(match.total_revenue)}, ` +
    `total functional expenses ${formatCurrency(match.total_expenses)}.`
  );
}

function buildRecommendedAction(
  funderName: string,
  score: number,
  signalType: SignalType,
): string {
  if (score >= HIGH_SCORE_THRESHOLD) {
    if (signalType === "990_filing") {
      return (
        `Review ${funderName}'s current giving capacity before your next ask - real IRS 990 data ` +
        "indicates a substantial, well-resourced foundation. Recommended approach: size your request " +
        "against their reported assets and confirm alignment with any known focus areas."
      );
    }
    return (
      `Act within 7 days. ${funderName} signal indicates an active relationship-building window. ` +
      `Recommended approach: ${NEWS_SIGNAL_APPROACH[signalType]}.`
    );
  }
  return "Note in relationship record and monitor for follow-up signals.";
}

const NEWS_SEARCH_QUERY_TEMPLATES: Array<(funder: string) => string> = [
  (funder) => `${funder} foundation new executive director president board chair 2025 2026`,
  (funder) => `${funder} foundation new board members trustees appointed 2025 2026`,
  (funder) => `${funder} foundation grant funding priorities RFP program announcement 2025 2026`,
];

export class FunderSignalMonitorAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-43-funder-signals", supabase);
  }

  private async loadOrgProfile(): Promise<OrgProfile | null> {
    const { data } = await this.supabase
      .from("organizations")
      .select("id, name, mission_statement, service_area, target_population, city, state")
      .eq("id", this.orgId)
      .maybeSingle();
    return (data ?? null) as OrgProfile | null;
  }

  /** Prefers funders whose category typically carries real board/leadership/
   * 990 activity (private and corporate foundations) over plain corporate
   * donation relationships (e.g. Walmart, a straight corporate-giving
   * program with no foundation entity of its own) - falls back to all
   * funders if none of the preferred categories are on file. */
  private async loadFunders(): Promise<FunderRow[]> {
    const baseSelect = "id, name, category, geographic_focus, website";

    const { data: preferred, error: preferredError } = await this.supabase
      .from("funders")
      .select(baseSelect)
      .eq("organization_id", this.orgId)
      .in("category", ["private_foundation", "corporate_foundation"])
      .order("created_at", { ascending: false })
      .limit(MAX_FUNDERS_PER_RUN);

    if (!preferredError && preferred && preferred.length > 0) {
      return preferred as FunderRow[];
    }

    const { data } = await this.supabase
      .from("funders")
      .select(baseSelect)
      .eq("organization_id", this.orgId)
      .order("created_at", { ascending: false })
      .limit(MAX_FUNDERS_PER_RUN);
    return (data ?? []) as FunderRow[];
  }

  /** Best-effort name+state join against foundation_directory's real,
   * ProPublica-sourced 990 data (funders has no ein/FK to join on directly -
   * same documented gap as AG-30's corporate_prospects join). Only matches
   * when enrichment.propublica is actually present - a foundation_directory
   * row with no 990 enrichment yet produces no match, not a fabricated one. */
  private async matchFoundationDirectory(
    funder: FunderRow,
  ): Promise<FoundationDirectoryMatch | null> {
    const state = (funder.geographic_focus ?? "").match(/\b([A-Z]{2})\b/)?.[1] ?? null;

    let query = this.supabase
      .from("foundation_directory")
      .select("ein, enrichment")
      .ilike("name", funder.name)
      .limit(3);
    if (state) query = query.eq("state", state);

    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;

    for (const row of data as { ein: string; enrichment: unknown }[]) {
      const enrichment = row.enrichment as
        | { propublica?: Record<string, unknown> }
        | null
        | undefined;
      const pp = enrichment?.propublica;
      if (!pp) continue;
      return {
        ein: row.ein,
        fiscal_period: typeof pp.fiscal_period === "number" ? pp.fiscal_period : null,
        total_revenue: typeof pp.totrevenue === "number" ? pp.totrevenue : null,
        total_assets: typeof pp.totassetsend === "number" ? pp.totassetsend : null,
        total_expenses: typeof pp.totfuncexpns === "number" ? pp.totfuncexpns : null,
        ntee_code: typeof pp.ntee_code === "string" ? pp.ntee_code : null,
      };
    }
    return null;
  }

  private buildNewsPrompt(
    org: OrgProfile,
    funder: FunderRow,
    query: string,
  ): { system: string; prompt: string } {
    const system = [
      "You are a nonprofit funder-relationship analyst. Your job is to run ONE specific web search and extract REAL, CURRENTLY VERIFIABLE public signals that indicate a genuine relationship-building opportunity with a specific foundation or corporate funder, for a nonprofit that already tracks this funder.",
      "",
      "RULES:",
      "1. You MUST issue exactly one web_search call for the exact query given below before answering. Only report a signal when you found real, cited evidence in that search - never estimate, infer, or recall from training data alone. If the search finds nothing relevant, return an empty array.",
      "2. signal_type must be exactly one of: " + NEWS_SIGNAL_TYPES.join(", ") + ".",
      "3. mission_alignment (0-100) rates how well this signal (and what you can tell of the funder's apparent priorities) aligns with the nonprofit's mission and target population given below. 100 means a direct, obvious fit.",
      `4. Report at most ${MAX_NEWS_SIGNALS_PER_FUNDER} signals, only the strongest ones you can actually substantiate from this search's results.`,
      "5. Respond with ONLY a JSON array (no markdown fences, no prose) of objects shaped exactly:",
      '{"signal_type": "...", "signal_summary": "one to two sentences", "signal_url": "source URL", "signal_date": "YYYY-MM-DD if known", "mission_alignment": <integer 0-100>}',
    ].join("\n");

    const orgLines = [
      `- Name: ${org.name}`,
      org.mission_statement ? `- Mission: ${org.mission_statement}` : null,
      org.service_area
        ? `- Service area: ${org.service_area}`
        : org.city || org.state
          ? `- Service area: ${[org.city, org.state].filter(Boolean).join(", ")}`
          : null,
      org.target_population ? `- Target population: ${org.target_population}` : null,
    ].filter((line): line is string => line !== null);

    const funderLines = [
      `- Funder: ${funder.name}`,
      funder.website ? `- Website: ${funder.website}` : null,
      funder.geographic_focus ? `- Known geographic focus: ${funder.geographic_focus}` : null,
      `- Category on file: ${funder.category}`,
    ].filter((line): line is string => line !== null);

    const prompt = [
      "## Nonprofit (the org already tracking this funder)",
      orgLines.join("\n"),
      "",
      "## Funder to research",
      funderLines.join("\n"),
      "",
      `Search for exactly this query: "${query}"`,
      "Return ONLY the JSON array described above, based solely on that search's results.",
    ].join("\n");

    return { system, prompt };
  }

  private async searchFunderNews(
    org: OrgProfile,
    funder: FunderRow,
  ): Promise<{ signals: ValidatedNewsSignal[]; tokensUsed: number; errors: string[] }> {
    const errors: string[] = [];
    let tokensUsed = 0;

    const results = await Promise.all(
      NEWS_SEARCH_QUERY_TEMPLATES.map(async (template) => {
        const query = template(funder.name);
        const { system, prompt } = this.buildNewsPrompt(org, funder, query);
        try {
          const response = await callClaudeWithWebSearch({
            system,
            prompt,
            maxTokens: MAX_TOKENS,
            maxSearches: 1,
          });
          return { response, query };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Claude call failed.";
          errors.push(`${funder.name} (${query}): ${message}`);
          return null;
        }
      }),
    );

    const signals: ValidatedNewsSignal[] = [];
    for (const result of results) {
      if (!result) continue;
      tokensUsed += result.response.usage.totalTokens;

      if (!result.response.usedWebSearch) {
        errors.push(
          `${funder.name} (${result.query}): Claude did not issue a web_search call - discarded rather than persist an ungrounded signal.`,
        );
        continue;
      }

      const rawSignals = extractJsonArray(result.response.text);
      for (const raw of rawSignals) {
        const validated = validateNewsSignal(raw);
        if (validated) signals.push(validated);
      }
    }

    return { signals: signals.slice(0, MAX_NEWS_SIGNALS_PER_FUNDER), tokensUsed, errors };
  }

  /** Dedup key is (org_id, funder_id, signal_type) within a 60-day window,
   * matching AG-30's convention - funder_relationship_signals has no unique
   * constraint on that tuple, so this is an explicit select-then-write. */
  private async findExistingSignal(
    funderId: string,
    signalType: SignalType,
  ): Promise<string | null> {
    const since = subDays(new Date(), DEDUP_WINDOW_DAYS).toISOString();
    const { data } = await this.supabase
      .from("funder_relationship_signals")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("funder_id", funderId)
      .eq("signal_type", signalType)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  private async persistSignal(
    funder: FunderRow,
    runId: string,
    decisions: string[],
    errors: string[],
    params: {
      source: "news" | "990_filing";
      signalType: SignalType;
      signalSummary: string;
      signalUrl: string | null;
      signalDate: string | null;
      score: number;
      missionAlignment: number;
    },
  ): Promise<boolean> {
    const isHigh = params.score >= HIGH_SCORE_THRESHOLD;
    const recommendedDeadline = format(
      new Date(Date.now() + (isHigh ? 7 : 30) * 24 * 60 * 60 * 1000),
      "yyyy-MM-dd",
    );
    const recommendedAction = buildRecommendedAction(funder.name, params.score, params.signalType);

    const signalRow = {
      org_id: this.orgId,
      funder_id: funder.id,
      source: params.source,
      signal_type: params.signalType,
      signal_summary: params.signalSummary,
      signal_url: params.signalUrl,
      signal_date: params.signalDate,
      relationship_score: params.score,
      mission_alignment: params.missionAlignment,
      recommended_action: recommendedAction,
      recommended_deadline: recommendedDeadline,
    };

    const existingId = await this.findExistingSignal(funder.id, params.signalType);

    let signalId: string | null = null;
    if (existingId) {
      const { error: updateError } = await this.supabase
        .from("funder_relationship_signals")
        .update(signalRow)
        .eq("id", existingId);
      if (updateError) {
        errors.push(`Failed to update signal for "${funder.name}": ${updateError.message}`);
        return false;
      }
      signalId = existingId;
    } else {
      const { data: inserted, error: insertError } = await this.supabase
        .from("funder_relationship_signals")
        .insert(signalRow)
        .select("id")
        .single();
      if (insertError || !inserted) {
        errors.push(
          `Failed to save signal for "${funder.name}": ${insertError?.message ?? "no row returned"}`,
        );
        return false;
      }
      signalId = (inserted as { id: string }).id;
    }

    decisions.push(
      await this.logDecision({
        decisionType: "funder_signal_detected",
        agentRunId: runId,
        entityType: "funder_relationship_signal",
        entityId: signalId,
        reasoning:
          `${funder.name}: ${params.signalSummary} (source=${params.source}, type=${params.signalType}, ` +
          `mission=${params.missionAlignment}) -> relationship_score ${params.score}/100.`,
        confidenceScore: params.score,
        actionTaken: existingId
          ? `Updated existing signal (${DEDUP_WINDOW_DAYS}-day window match).`
          : isHigh
            ? `Recorded HIGH relationship signal (>=${HIGH_SCORE_THRESHOLD}); recommended action due within 7 days.`
            : "Recorded relationship signal; recommended action due within 30 days.",
        actionPayload: {
          source: params.source,
          signal_type: params.signalType,
          signal_url: params.signalUrl,
          relationship_score: params.score,
          mission_alignment: params.missionAlignment,
          recommended_action: recommendedAction,
          recommended_deadline: recommendedDeadline,
        },
        requiredHumanReview: true,
      }),
    );

    if (isHigh) {
      await this.createNotification(
        "funder_relationship_signal_high",
        `Relationship opportunity: ${funder.name}`,
        recommendedAction,
        undefined,
        "info",
      );

      // Bridge into relationship_memory (migration 127) for AG-19
      // Relationship Builder to read - same convention
      // ReputationIntelligenceAgent already established for its own
      // HIGH/CRITICAL signals (see reputation-agent.ts).
      const { error: memoryError } = await this.supabase.from("relationship_memory").insert({
        org_id: this.orgId,
        entity_id: funder.id,
        entity_type: "funder",
        memory_type: params.source === "990_filing" ? "990_signal" : "news_signal",
        content: params.signalSummary,
        signal_date: params.signalDate,
      });
      if (memoryError) {
        errors.push(
          `Failed to record relationship memory for funder ${funder.id}: ${memoryError.message}`,
        );
      }
    }

    return true;
  }

  override async run(triggerSource: TriggerSource): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    return this.runAgainstFunders(await this.loadFunders(), runId);
  }

  /** Single-funder entry point, mirroring ReputationIntelligenceAgent's
   * runForFunder() - used for enrollment-on-add and for direct verification
   * without waiting on the whole-org sweep's funder selection. */
  async runForFunder(
    funderId: string,
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const { data } = await this.supabase
      .from("funders")
      .select("id, name, category, geographic_focus, website")
      .eq("id", funderId)
      .eq("organization_id", this.orgId)
      .maybeSingle();

    const runId = await this.startRun(triggerSource, { funderId });
    if (!data) {
      await this.failRun(runId, `Funder ${funderId} not found for this organization.`);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions: [],
        nextActions: [],
        errors: [`Funder ${funderId} not found for this organization.`],
      };
    }
    return this.runAgainstFunders([data as FunderRow], runId);
  }

  private async runAgainstFunders(
    funders: FunderRow[],
    runId: string,
  ): Promise<AutonomousAgentResult> {
    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;
    let itemsProcessed = 0;
    let itemsQueued = 0;

    try {
      const org = await this.loadOrgProfile();
      if (!org) throw new Error(`Could not load organization ${this.orgId}.`);

      for (const funder of funders) {
        try {
          itemsProcessed += 1;

          // --- News half -------------------------------------------------
          const { signals, tokensUsed: funderTokens, errors: newsErrors } =
            await this.searchFunderNews(org, funder);
          tokensUsed += funderTokens;
          errors.push(...newsErrors);

          for (const signal of signals) {
            const missionFactor = signal.mission_alignment / 100;
            const score = computeNewsScore(signal.signal_type, missionFactor, signal.signal_date);
            if (score < RELATIONSHIP_SCORE_THRESHOLD) continue;

            const persisted = await this.persistSignal(funder, runId, decisions, errors, {
              source: "news",
              signalType: signal.signal_type,
              signalSummary: signal.signal_summary,
              signalUrl: signal.signal_url,
              signalDate: signal.signal_date,
              score,
              missionAlignment: signal.mission_alignment,
            });
            if (persisted) itemsQueued += 1;
          }

          // --- 990 filing half --------------------------------------------
          const filingMatch = await this.matchFoundationDirectory(funder);
          if (filingMatch) {
            const filingScore = computeFilingScore(filingMatch);
            if (filingScore >= RELATIONSHIP_SCORE_THRESHOLD) {
              const persisted = await this.persistSignal(funder, runId, decisions, errors, {
                source: "990_filing",
                signalType: "990_filing",
                signalSummary: buildFilingSummary(funder.name, filingMatch),
                signalUrl: null,
                signalDate: filingMatch.fiscal_period
                  ? `${filingMatch.fiscal_period}-12-31`
                  : null,
                score: filingScore,
                // No mission-fit signal from raw financials alone - reported
                // neutrally rather than inventing a Claude-style judgment for
                // a deterministic, non-LLM code path.
                missionAlignment: 50,
              });
              if (persisted) itemsQueued += 1;
            }
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to analyze funder for relationship signals.";
          errors.push(`${funder.name}: ${message}`);
        }
      }

      const summary =
        itemsQueued > 0
          ? `Analyzed ${itemsProcessed} of ${funders.length} funder(s); recorded ${itemsQueued} relationship signal(s) at or above ${RELATIONSHIP_SCORE_THRESHOLD}/100.`
          : `Analyzed ${itemsProcessed} of ${funders.length} funder(s); no signal reached the ${RELATIONSHIP_SCORE_THRESHOLD}/100 threshold.`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound: funders.length,
        itemsProcessed,
        itemsQueued,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: funders.length,
        itemsProcessed,
        itemsQueued,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Funder signal monitoring run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: funders.length,
        itemsProcessed,
        itemsQueued,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
