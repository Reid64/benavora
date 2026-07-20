// Opportunity Discovery Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 2 (AI
// Opportunity Discovery Engine), AGENTS_v2.md AG-17.
//
// Autonomous rewrite: extends AutonomousAgent (migration 080 infrastructure —
// autonomous_triggers, agent_queue, agent_decisions, org_autonomous_config).
// Sweeps Grants.gov, SAM.gov, and the Federal Register per active search
// profile, dedupes against real `opportunities` rows, and inserts new matches
// directly — every insertion is logged to agent_decisions for audit, and a
// batch of new opportunities chains into AG-15 (Grant Probability) when the
// org has auto-scoring enabled. This replaces the prior non-destructive
// design that only staged candidates in discovery_matches.
//
// Deviations from the task-given spec, per this project's established
// practice of checking real state before applying a literal spec (see
// src/lib/sources/federal-grants-poller.ts's header for a prior instance of
// this pattern):
//   - `opportunities` has no `source_url` column (confirmed absent from
//     every migration and src/types/database.ts) — dedup uses the real
//     `url` column instead, matching the convention already established in
//     src/lib/sources/{grantsgov-sync,federal-grants-poller}.ts.
//   - The repo's current BEHAVIORAL_CONTRACTS.md only numbers sections
//     17-33 (v2.0); it has no section 5. The source-integration contracts
//     relevant to this agent are §17 (Grants.gov) and §18 (SAM.gov).
//
// Foundation matching (added alongside src/lib/intelligence/foundation-matcher.ts):
//   - `findMatchingFoundations()` scores `foundation_directory` against this
//     org's profile (NTEE/geo/asset/prior-giving) independent of the
//     keyword-driven grants.gov/SAM.gov/Federal Register sweep above. There
//     is no per-foundation "recent grants" list anywhere in this schema
//     (foundation_directory is a fund-level record, not a per-grant one —
//     see that file's header) — "query each matched foundation's recent
//     grants as discovery opportunities" is implemented as: synthesize one
//     discovery candidate per matched foundation, using its
//     estimated_grant_range and match_reasons as the opportunity's
//     amount/description, and run it through the same dedup+insert+
//     decision-logging pipeline as the federal sources. Capped at
//     FOUNDATION_MATCH_INSERT_LIMIT per run to bound insert volume, same as
//     every other nightly-batch cap in this codebase.
//
// Agentic upgrade (July 19, 2026) — perception/decision/execution/observation
// loop. `run()` now (1) perceives a state snapshot of the org's discovery
// pipeline before doing anything, (2) picks one of five strategy branches
// from that snapshot and logs the choice with its reasoning, (3) executes the
// chosen branch's distinct source combination, and (4) observes the result
// against the perceived baseline and decides whether to chain into
// downstream scoring agents. Deviations from the task-given spec, checked
// against real state per this file's established practice above:
//   - Neither `searchGrantsGovOpportunities()` nor `searchSamGovOpportunities()`
//     accept NAICS/deadline/award-ceiling filter params (confirmed: both are
//     thin fetch+map layers over their public search endpoints, see
//     src/lib/sources/{grantsgov-client,samgov-client}.ts). Strategy
//     branching instead varies *which* sources run and *how many* keyword
//     terms are tried per profile — the actual levers these clients expose —
//     rather than filter parameters that don't exist on either client.
//   - "Query nonprofits table WHERE asset_amount BETWEEN..." is not how
//     foundation discovery works in this codebase: `nonprofits` (migration
//     098) is a raw IRS BMF import keyed on ein/ntee_code with no
//     asset_amount column, and per project memory
//     (benavora-bmf-ingest-column-bug) its ingest script has a confirmed
//     column-scrambling bug and likely holds ~zero usable rows. The real,
//     already-built foundation-discovery path is
//     `findMatchingFoundations()` (src/lib/intelligence/foundation-matcher.ts)
//     against `foundation_directory`, which already has asset_amount,
//     geographic, and prior-giving scoring — reused here unchanged, varying
//     only the result-insert limit per strategy.
//   - Freshly-discovered opportunities have no `eligibility_score` — that
//     column is written by a separate agent (AG-02 / `eligibility-scorer.ts`)
//     that has not run against them yet at the moment this agent's
//     OBSERVATION PHASE executes. "Average eligibility_score of new
//     opportunities" and "chain if eligibility_score >= 65" are therefore
//     implemented against the closest real, already-available signal: this
//     org's *existing* `opportunity_probability_scores.overall_score`
//     average, captured during PERCEPTION as a pipeline-quality baseline. A
//     null baseline (no scored opportunities yet) is treated as "insufficient
//     data — proceed" rather than a blocking failure.
//   - The CHAIN TRIGGER section's `next_agent='ag-03-probability-scorer'` is
//     not a real agent_id anywhere in this codebase — AGENTS_v2.md §1.4
//     documents `ag-03-deadline-extraction` as DeadlineExtractionAgent, a
//     completely unrelated agent. The real probability-scoring agent_id,
//     already used by this file's pre-upgrade chain call and documented
//     throughout AGENTS_v2.md, is `ag-15-probability` — used here instead.
//   - The immediate "trigger eligibility scorer" observation-phase action
//     chains to `eligibility_scoring` (the live, `routeQueueItem()`-recognized
//     agent_id per AGENTS_v2.md §7 and AG-02's real-implementation notes),
//     queued once per new opportunity with `input_payload.opportunityId`
//     (singular) — matching AG-02's documented on-demand queue contract,
//     not `ag-02` (which is the dead Generation-2 twin's unreachable id).

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import {
  findMatchingFoundations,
  type FoundationMatch,
  type OrgProfile,
} from "@/lib/intelligence/foundation-matcher";
import {
  searchGrantsGovOpportunities,
  type GrantsGovNormalizedOpportunity,
} from "@/lib/sources/grantsgov-client";
import {
  searchSamGovOpportunities,
  type SamGovNormalizedOpportunity,
} from "@/lib/sources/samgov-client";

const FEDERAL_REGISTER_URL =
  "https://www.federalregister.gov/api/v1/documents.json";

const FOUNDATION_MATCH_INSERT_LIMIT = 10;
const EXPAND_SEARCH_FOUNDATION_LIMIT = FOUNDATION_MATCH_INSERT_LIMIT * 2;
const EXPAND_SEARCH_MAX_KEYWORD_TERMS = 3;

// PERCEPTION PHASE windows/thresholds.
const RECENT_OPPORTUNITIES_WINDOW_DAYS = 7;
const CRITICAL_DEADLINE_WINDOW_DAYS = 14;
const PROFILE_REDUNDANCY_WINDOW_DAYS = 3;
const STAGNANT_RUN_LOOKBACK = 3;

// DECISION PHASE thresholds.
const CRITICAL_DEADLINE_STRATEGY_THRESHOLD = 5;
const LOW_ELIGIBILITY_AVG_THRESHOLD = 50;
const CRITICAL_DEADLINE_FLAG_LIMIT = 10;

// OBSERVATION PHASE / chain-trigger thresholds.
const ELIGIBILITY_CHAIN_TRIGGER_THRESHOLD = 5;
const ELIGIBILITY_CHAIN_MAX_QUEUE = 20;
const PROBABILITY_CHAIN_MIN_NEW_OPPORTUNITIES = 3;
const PROBABILITY_CHAIN_MIN_AVG_SCORE = 60;
const CHAIN_PRIORITY_HIGH = 2;

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";

type DiscoverySource =
  | "grants_gov"
  | "sam_gov"
  | "federal_register"
  | "foundation_match";

type DiscoveryStrategy =
  | "deadline_focus"
  | "expand_search"
  | "federal_shift"
  | "skip_redundant"
  | "standard";

interface DiscoveredOpportunity {
  externalTitle: string;
  externalSource: DiscoverySource;
  externalUrl: string | null;
  description: string | null;
  amount: number | null;
  deadline: string | null;
  /** funder_category value used on insert — federal sources are always
   * "government_grant"; foundation matches use "private_foundation". */
  category: string;
  /** opportunity_source_type value used on insert (migration 010). */
  sourceType: string;
}

interface SearchProfileRow {
  id: string;
  name: string;
  keywords: string[] | null;
  last_run_at: string | null;
}

interface FederalRegisterResult {
  document_number?: unknown;
  title?: unknown;
  abstract?: unknown;
  html_url?: unknown;
}

interface FederalRegisterResponse {
  results?: FederalRegisterResult[];
}

/** State snapshot built by the PERCEPTION PHASE at the start of every run. */
interface DiscoveryStateSnapshot {
  opportunitiesLast7Days: number;
  /** Average `opportunity_probability_scores.overall_score` across this
   * org's already-scored pipeline. Null when nothing has been scored yet. */
  avgProbabilityScore: number | null;
  probabilityScoreDistribution: {
    high: number;
    medium: number;
    low: number;
    totalScored: number;
  };
  /** Open opportunities with a deadline inside the next 14 days that have no
   * `applications` row yet. */
  criticalDeadlineOpportunityIds: string[];
  criticalDeadlineCount: number;
  recentRuns: { itemsFound: number; status: string }[];
  recentRunsFoundZero: boolean;
  recentDiscoverySuccessRate: number | null;
  activeProfiles: SearchProfileRow[];
  allProfilesRanRecently: boolean;
}

interface StrategyDecision {
  strategy: DiscoveryStrategy;
  reasoning: string;
}

interface SourceSweepResult {
  duplicatesSkipped: number;
  sweptProfileIds: string[];
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function mapGrantsGov(
  hit: GrantsGovNormalizedOpportunity,
): DiscoveredOpportunity {
  return {
    externalTitle: hit.name,
    externalSource: "grants_gov",
    externalUrl: hit.externalId
      ? `https://www.grants.gov/search-grants?opp=${hit.externalId}`
      : null,
    description: hit.description,
    amount: hit.amount,
    deadline: hit.deadline,
    category: "government_grant",
    sourceType: "government_federal",
  };
}

function mapSamGov(hit: SamGovNormalizedOpportunity): DiscoveredOpportunity {
  return {
    externalTitle: hit.name,
    externalSource: "sam_gov",
    externalUrl: hit.externalId
      ? `https://sam.gov/opp/${hit.externalId}/view`
      : null,
    description: hit.description,
    amount: hit.amount,
    deadline: hit.deadline,
    category: "government_grant",
    sourceType: "government_federal",
  };
}

/** Synthesizes a discovery candidate from a foundation match — there is no
 * per-grant list to query (see file header), so the match itself becomes
 * the opportunity, using its estimated ask range and scoring reasons. */
function mapFoundationMatch(match: FoundationMatch): DiscoveredOpportunity {
  const rangeText =
    match.estimated_grant_range.max > 0
      ? `Estimated grant range: $${match.estimated_grant_range.min.toLocaleString()}-$${match.estimated_grant_range.max.toLocaleString()}. `
      : "";
  return {
    externalTitle: `${match.foundation_name} — Foundation Grant Opportunity`,
    externalSource: "foundation_match",
    externalUrl: null,
    description: `${rangeText}Match score ${Math.round(match.match_score * 100)}/100. ${match.match_reasons.join("; ")}.`,
    amount: match.estimated_grant_range.max > 0 ? match.estimated_grant_range.max : null,
    deadline: null,
    category: "private_foundation",
    sourceType: "private_foundation",
  };
}

/**
 * Polls the Federal Register for grant-funding notices. Returns an empty
 * array on any HTTP/parse failure (non-fatal — mirrors the grants.gov/SAM.gov
 * source clients' behavior so one dead source never aborts the whole run).
 * `term` is exposed (rather than hardcoded) so the expand_search strategy can
 * try more than one query phrase when the default term has stopped
 * surfacing anything new.
 */
async function fetchFederalRegister(
  term: string = "grant funding",
): Promise<DiscoveredOpportunity[]> {
  const params = new URLSearchParams();
  params.append("conditions[type][]", "NOTICE");
  params.set("conditions[term]", term);
  params.set("per_page", "20");
  params.set("order", "newest");

  let response: Response;
  try {
    response = await fetch(`${FEDERAL_REGISTER_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return [];
  }

  if (!response.ok) return [];

  let body: FederalRegisterResponse;
  try {
    body = (await response.json()) as FederalRegisterResponse;
  } catch {
    return [];
  }

  const results = Array.isArray(body.results) ? body.results : [];
  const mapped: DiscoveredOpportunity[] = [];
  for (const item of results) {
    const title = toStr(item.title);
    if (!title) continue;
    mapped.push({
      externalTitle: title,
      externalSource: "federal_register",
      externalUrl: toStr(item.html_url) || null,
      description: toStr(item.abstract) || null,
      amount: null,
      deadline: null,
      category: "government_grant",
      sourceType: "government_federal",
    });
  }
  return mapped;
}

/**
 * True if an opportunity with this url or name already exists for the org.
 * `opportunities` has no `source_url` column (see file header) — dedup uses
 * the real `url` column (exact match) plus an exact name match, matching the
 * task's dedup rule with the real schema's column name substituted in.
 */
async function existsInOpportunities(
  supabase: SupabaseClient,
  orgId: string,
  title: string,
  url: string | null,
): Promise<boolean> {
  if (url) {
    const { data: byUrl } = await supabase
      .from("opportunities")
      .select("id")
      .eq("organization_id", orgId)
      .eq("url", url)
      .maybeSingle();
    if (byUrl) return true;
  }

  const { data: byName } = await supabase
    .from("opportunities")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", title)
    .maybeSingle();
  return Boolean(byName);
}

function formatAmount(amount: number | null): string {
  return amount === null ? "unknown" : `$${amount.toLocaleString()}`;
}

function formatDeadline(deadline: string | null): string {
  return deadline ?? "none published";
}

/** Single joined-keyword phrase used by strategies that make one Grants.gov
 * call per profile (standard/deadline_focus/federal_shift). */
function buildProfileKeyword(profile: SearchProfileRow): string {
  return (
    (profile.keywords ?? []).join(" ").slice(0, 50).trim() ||
    profile.name ||
    "nonprofit grant"
  );
}

/** Up to EXPAND_SEARCH_MAX_KEYWORD_TERMS individual keyword terms, used by
 * the expand_search strategy in place of one joined phrase — a single
 * 50-char joined string is a narrower query surface than searching each
 * keyword independently, which is the whole point when the joined-phrase
 * approach has stopped returning anything new. */
function buildExpandedKeywordTerms(profile: SearchProfileRow): string[] {
  const raw = (profile.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (raw.length === 0) return [profile.name || "nonprofit grant"];
  return raw.slice(0, EXPAND_SEARCH_MAX_KEYWORD_TERMS);
}

/** Dedupes a single run's own combined source results before insertion —
 * distinct from `existsInOpportunities`, which checks against already-
 * persisted rows. Needed because expand_search issues multiple overlapping
 * queries (several keyword terms, two Federal Register phrasings) that can
 * legitimately return the same hit more than once in one batch. */
function dedupeWithinBatch(
  items: DiscoveredOpportunity[],
): DiscoveredOpportunity[] {
  const seen = new Set<string>();
  const result: DiscoveredOpportunity[] = [];
  for (const item of items) {
    const key = item.externalUrl ?? `${item.externalSource}:${item.externalTitle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * DECISION PHASE — pure function over the perceived state snapshot. Checked
 * in priority order: an at-risk pipeline (critical deadlines) outranks a
 * stagnant one (zero recent finds), which outranks a low-quality one (poor
 * average eligibility), which outranks simple redundancy avoidance. Falls
 * through to the standard full sweep when none of those signals fire.
 */
function decideStrategy(snapshot: DiscoveryStateSnapshot): StrategyDecision {
  if (snapshot.criticalDeadlineCount > CRITICAL_DEADLINE_STRATEGY_THRESHOLD) {
    return {
      strategy: "deadline_focus",
      reasoning:
        `${snapshot.criticalDeadlineCount} opportunities have a deadline within ` +
        `${CRITICAL_DEADLINE_WINDOW_DAYS} days and no application started yet ` +
        `(threshold: >${CRITICAL_DEADLINE_STRATEGY_THRESHOLD}). Prioritizing deadline-bearing ` +
        `sources (Grants.gov, SAM.gov) and flagging the at-risk opportunities directly, ` +
        `skipping the Federal Register and foundation-match sweep this run since neither ` +
        `carries real deadline data.`,
    };
  }

  if (snapshot.recentRunsFoundZero) {
    return {
      strategy: "expand_search",
      reasoning:
        `The last ${snapshot.recentRuns.length} discovery run(s) found 0 new opportunities. ` +
        `Expanding search surface: individual keyword terms per profile instead of one joined ` +
        `phrase, two Federal Register query phrasings instead of one, and a doubled foundation-` +
        `match batch (${EXPAND_SEARCH_FOUNDATION_LIMIT} instead of ${FOUNDATION_MATCH_INSERT_LIMIT}).`,
    };
  }

  if (
    snapshot.avgProbabilityScore !== null &&
    snapshot.avgProbabilityScore < LOW_ELIGIBILITY_AVG_THRESHOLD
  ) {
    return {
      strategy: "federal_shift",
      reasoning:
        `Average opportunity probability score across this org's scored pipeline is ` +
        `${snapshot.avgProbabilityScore.toFixed(1)} (below ${LOW_ELIGIBILITY_AVG_THRESHOLD}). ` +
        `Federal sources carry firmer eligibility signals (award ceilings, published deadlines, ` +
        `agency-level eligibility text) than a foundation-match heuristic does — skipping ` +
        `foundation matching this run to concentrate discovery on Grants.gov/SAM.gov/Federal Register.`,
    };
  }

  if (snapshot.allProfilesRanRecently) {
    return {
      strategy: "skip_redundant",
      reasoning:
        `All ${snapshot.activeProfiles.length} active search profile(s) already ran within the ` +
        `last ${PROFILE_REDUNDANCY_WINDOW_DAYS} days. Skipping the redundant Grants.gov/Federal ` +
        `Register/foundation-match sweep and checking only SAM.gov, whose result set changes ` +
        `fastest, for new postings.`,
    };
  }

  return {
    strategy: "standard",
    reasoning:
      "No deadline-pressure, stagnation, low-eligibility, or redundancy signal in the state " +
      "snapshot. Running the standard full sweep (Grants.gov, SAM.gov, Federal Register, and " +
      "foundation matching) across all active search profiles.",
  };
}

export class OpportunityDiscoveryAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-17-discovery", supabase);
  }

  private async loadOrgProfile(): Promise<OrgProfile | null> {
    const { data } = await this.supabase
      .from("organizations")
      .select("name, ein, mission_statement, target_population, service_area, annual_budget, city, state")
      .eq("id", this.orgId)
      .maybeSingle();

    if (!data) return null;
    return {
      name: data.name as string,
      ein: (data.ein as string | null) ?? null,
      missionStatement: (data.mission_statement as string | null) ?? null,
      targetPopulation: (data.target_population as string | null) ?? null,
      serviceArea: (data.service_area as string | null) ?? null,
      annualBudget: (data.annual_budget as number | null) ?? null,
      city: (data.city as string | null) ?? null,
      state: (data.state as string | null) ?? null,
    };
  }

  /**
   * PERCEPTION PHASE — builds the state snapshot the DECISION PHASE branches
   * on: recent discovery volume, this org's existing eligibility/probability
   * quality baseline, at-risk deadlines with no application started, this
   * agent's own last 3 runs' success rate, and how recently each active
   * search profile last ran. Excludes the just-opened run (`runId`) from the
   * "last 3 runs" query so the in-progress row never counts against itself.
   */
  private async perceiveState(runId: string): Promise<DiscoveryStateSnapshot> {
    const nowMs = Date.now();
    const sevenDaysAgoIso = new Date(
      nowMs - RECENT_OPPORTUNITIES_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const nowIso = new Date(nowMs).toISOString();
    const deadlineWindowIso = new Date(
      nowMs + CRITICAL_DEADLINE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const redundancyWindowMs =
      nowMs - PROFILE_REDUNDANCY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    const [
      { count: opportunitiesLast7DaysRaw },
      { data: scoreRows },
      { data: profileRows, error: profilesError },
      { data: recentRunRows },
    ] = await Promise.all([
      this.supabase
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", this.orgId)
        .gte("created_at", sevenDaysAgoIso),
      this.supabase
        .from("opportunity_probability_scores")
        .select("overall_score")
        .eq("org_id", this.orgId),
      this.supabase
        .from("search_profiles")
        .select("id, name, keywords, last_run_at")
        .eq("organization_id", this.orgId)
        .eq("is_active", true),
      this.supabase
        .from("agent_runs")
        .select("items_found, status")
        .eq("organization_id", this.orgId)
        .eq("agent_type", this.agentId)
        .neq("id", runId)
        .order("created_at", { ascending: false })
        .limit(STAGNANT_RUN_LOOKBACK),
    ]);

    if (profilesError) {
      throw new Error(
        `Failed to load active search profiles: ${profilesError.message}`,
      );
    }

    const activeProfiles = (profileRows ?? []) as SearchProfileRow[];

    const scores = ((scoreRows ?? []) as { overall_score: number | null }[])
      .map((r) => r.overall_score)
      .filter((v): v is number => typeof v === "number");
    const avgProbabilityScore =
      scores.length > 0
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length
        : null;
    const probabilityScoreDistribution = {
      high: scores.filter((s) => s >= 70).length,
      medium: scores.filter((s) => s >= 40 && s < 70).length,
      low: scores.filter((s) => s < 40).length,
      totalScored: scores.length,
    };

    const { data: deadlineRows } = await this.supabase
      .from("opportunities")
      .select("id")
      .eq("organization_id", this.orgId)
      .eq("status", "open")
      .not("deadline", "is", null)
      .gte("deadline", nowIso)
      .lte("deadline", deadlineWindowIso);

    const deadlineOpportunityIds = ((deadlineRows ?? []) as { id: string }[]).map(
      (r) => r.id,
    );

    let criticalDeadlineOpportunityIds: string[] = [];
    if (deadlineOpportunityIds.length > 0) {
      const { data: appRows } = await this.supabase
        .from("applications")
        .select("opportunity_id")
        .eq("organization_id", this.orgId)
        .in("opportunity_id", deadlineOpportunityIds);
      const appliedIds = new Set(
        ((appRows ?? []) as { opportunity_id: string | null }[])
          .map((r) => r.opportunity_id)
          .filter((v): v is string => Boolean(v)),
      );
      criticalDeadlineOpportunityIds = deadlineOpportunityIds.filter(
        (id) => !appliedIds.has(id),
      );
    }

    const recentRuns = (
      (recentRunRows ?? []) as { items_found: number | null; status: string }[]
    ).map((r) => ({ itemsFound: r.items_found ?? 0, status: r.status }));
    const recentRunsFoundZero =
      recentRuns.length > 0 && recentRuns.every((r) => r.itemsFound === 0);
    const recentDiscoverySuccessRate =
      recentRuns.length > 0
        ? recentRuns.filter((r) => r.itemsFound > 0).length / recentRuns.length
        : null;

    const allProfilesRanRecently =
      activeProfiles.length > 0 &&
      activeProfiles.every(
        (p) =>
          p.last_run_at !== null &&
          new Date(p.last_run_at).getTime() >= redundancyWindowMs,
      );

    return {
      opportunitiesLast7Days: opportunitiesLast7DaysRaw ?? 0,
      avgProbabilityScore,
      probabilityScoreDistribution,
      criticalDeadlineOpportunityIds,
      criticalDeadlineCount: criticalDeadlineOpportunityIds.length,
      recentRuns,
      recentRunsFoundZero,
      recentDiscoverySuccessRate,
      activeProfiles,
      allProfilesRanRecently,
    };
  }

  /** Shared dedup+insert+decision-log path for every source (federal sweep,
   * expanded sweep, foundation-match batch). Mutates newOpportunityIds/
   * decisions/errors in place and returns how many of `opportunities` were
   * duplicates. */
  private async insertDiscoveredOpportunities(
    opportunities: DiscoveredOpportunity[],
    runId: string,
    sourceLabel: string,
    newOpportunityIds: string[],
    decisions: string[],
    errors: string[],
  ): Promise<number> {
    let duplicatesSkipped = 0;

    for (const opp of opportunities) {
      if (!opp.externalTitle) continue;

      const alreadyExists = await existsInOpportunities(
        this.supabase,
        this.orgId,
        opp.externalTitle,
        opp.externalUrl,
      );

      if (alreadyExists) {
        duplicatesSkipped++;
        continue;
      }

      const { data: inserted, error: insertError } = await this.supabase
        .from("opportunities")
        .insert({
          organization_id: this.orgId,
          name: opp.externalTitle,
          category: opp.category,
          description: opp.description,
          amount_max: opp.amount,
          deadline: opp.deadline,
          url: opp.externalUrl,
          source: "agent",
          source_type: opp.sourceType,
          status: "open",
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        errors.push(
          `Failed to insert "${opp.externalTitle}": ${
            insertError?.message ?? "no row returned"
          }`,
        );
        continue;
      }

      const newOppId = (inserted as { id: string }).id;
      newOpportunityIds.push(newOppId);

      const decisionId = await this.logDecision({
        decisionType: "opportunity_discovered",
        agentRunId: runId,
        entityType: "opportunity",
        entityId: newOppId,
        reasoning:
          `New opportunity matching ${sourceLabel}: ` +
          `${opp.externalTitle}. Amount: ${formatAmount(opp.amount)}. ` +
          `Deadline: ${formatDeadline(opp.deadline)}.`,
        confidenceScore: 85,
        actionTaken: "inserted_opportunity",
      });
      decisions.push(decisionId);
    }

    return duplicatesSkipped;
  }

  /** Runs the foundation-match batch and inserts up to `limit` candidates.
   * Shared by every strategy that includes foundation matching — only the
   * limit varies (doubled under expand_search, skipped entirely under
   * federal_shift/deadline_focus/skip_redundant). */
  private async runFoundationMatchBatch(
    limit: number,
    runId: string,
    newOpportunityIds: string[],
    decisions: string[],
    errors: string[],
  ): Promise<number> {
    try {
      const orgProfile = await this.loadOrgProfile();
      if (!orgProfile) return 0;

      const foundationMatches = await findMatchingFoundations(
        orgProfile,
        this.supabase,
      );
      const foundationOpportunities = foundationMatches
        .slice(0, limit)
        .map(mapFoundationMatch);

      return await this.insertDiscoveredOpportunities(
        foundationOpportunities,
        runId,
        "foundation matcher",
        newOpportunityIds,
        decisions,
        errors,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Foundation matching failed.";
      errors.push(`foundation matching: ${message}`);
      return 0;
    }
  }

  /** One profile's federal-source sweep, parameterized so
   * standard/federal_shift/deadline_focus can share it while still varying
   * whether the Federal Register is included and how the insert is labeled
   * for audit. */
  private async sweepProfile(
    profile: SearchProfileRow,
    runId: string,
    newOpportunityIds: string[],
    decisions: string[],
    errors: string[],
    options: { includeFederalRegister: boolean; sourceLabelSuffix: string },
  ): Promise<number> {
    const keyword = buildProfileKeyword(profile);
    const calls: Promise<DiscoveredOpportunity[]>[] = [
      searchGrantsGovOpportunities(keyword).then((hits) => hits.map(mapGrantsGov)),
      searchSamGovOpportunities().then((hits) => hits.map(mapSamGov)),
    ];
    if (options.includeFederalRegister) {
      calls.push(fetchFederalRegister());
    }

    const results = await Promise.all(calls);
    const discovered = dedupeWithinBatch(results.flat());

    return this.insertDiscoveredOpportunities(
      discovered,
      runId,
      `profile ${profile.name} (${options.sourceLabelSuffix})`,
      newOpportunityIds,
      decisions,
      errors,
    );
  }

  /** EXECUTION — standard strategy: full sweep (Grants.gov + SAM.gov +
   * Federal Register) per active profile, plus a normal-sized foundation
   * match batch. This is the default when no branching signal fires. */
  private async executeStandard(
    profiles: SearchProfileRow[],
    runId: string,
    newOpportunityIds: string[],
    decisions: string[],
    errors: string[],
  ): Promise<SourceSweepResult> {
    let duplicatesSkipped = 0;
    const sweptProfileIds: string[] = [];

    for (const profile of profiles) {
      duplicatesSkipped += await this.sweepProfile(
        profile,
        runId,
        newOpportunityIds,
        decisions,
        errors,
        { includeFederalRegister: true, sourceLabelSuffix: "standard sweep" },
      );
      sweptProfileIds.push(profile.id);
    }

    duplicatesSkipped += await this.runFoundationMatchBatch(
      FOUNDATION_MATCH_INSERT_LIMIT,
      runId,
      newOpportunityIds,
      decisions,
      errors,
    );

    return { duplicatesSkipped, sweptProfileIds };
  }

  /** EXECUTION — expand_search strategy: multiple individual keyword terms
   * per profile (instead of one joined phrase), two Federal Register query
   * phrasings, and a doubled foundation-match batch. Fires when the last
   * STAGNANT_RUN_LOOKBACK runs all found nothing — the joined-phrase query
   * and single Federal Register phrasing have plausibly exhausted their
   * surface area against this org's existing opportunities. */
  private async executeExpandSearch(
    profiles: SearchProfileRow[],
    runId: string,
    newOpportunityIds: string[],
    decisions: string[],
    errors: string[],
  ): Promise<SourceSweepResult> {
    let duplicatesSkipped = 0;
    const sweptProfileIds: string[] = [];

    for (const profile of profiles) {
      const terms = buildExpandedKeywordTerms(profile);
      const [grantsGovBatches, samGovHits, federalRegisterA, federalRegisterB] =
        await Promise.all([
          Promise.all(terms.map((t) => searchGrantsGovOpportunities(t))),
          searchSamGovOpportunities(),
          fetchFederalRegister("grant funding"),
          fetchFederalRegister("funding opportunity"),
        ]);

      const discovered = dedupeWithinBatch([
        ...grantsGovBatches.flat().map(mapGrantsGov),
        ...samGovHits.map(mapSamGov),
        ...federalRegisterA,
        ...federalRegisterB,
      ]);

      duplicatesSkipped += await this.insertDiscoveredOpportunities(
        discovered,
        runId,
        `profile ${profile.name} (expanded search, ${terms.length} keyword term(s))`,
        newOpportunityIds,
        decisions,
        errors,
      );
      sweptProfileIds.push(profile.id);
    }

    duplicatesSkipped += await this.runFoundationMatchBatch(
      EXPAND_SEARCH_FOUNDATION_LIMIT,
      runId,
      newOpportunityIds,
      decisions,
      errors,
    );

    return { duplicatesSkipped, sweptProfileIds };
  }

  /** EXECUTION — federal_shift strategy: same federal sweep as standard, but
   * foundation matching is skipped entirely. Fires when this org's existing
   * scored pipeline is averaging below LOW_ELIGIBILITY_AVG_THRESHOLD —
   * federal sources carry firmer eligibility signals than the foundation
   * heuristic, so this run concentrates there instead. */
  private async executeFederalShift(
    profiles: SearchProfileRow[],
    runId: string,
    newOpportunityIds: string[],
    decisions: string[],
    errors: string[],
  ): Promise<SourceSweepResult> {
    let duplicatesSkipped = 0;
    const sweptProfileIds: string[] = [];

    for (const profile of profiles) {
      duplicatesSkipped += await this.sweepProfile(
        profile,
        runId,
        newOpportunityIds,
        decisions,
        errors,
        {
          includeFederalRegister: true,
          sourceLabelSuffix:
            "federal-shift sweep, foundation matching skipped this run",
        },
      );
      sweptProfileIds.push(profile.id);
    }

    return { duplicatesSkipped, sweptProfileIds };
  }

  /** EXECUTION — deadline_focus strategy: Grants.gov + SAM.gov only (both
   * carry real deadlines), Federal Register and foundation matching skipped
   * (neither has deadline data), plus an explicit flag-for-human decision on
   * every existing at-risk opportunity. Fires when more than
   * CRITICAL_DEADLINE_STRATEGY_THRESHOLD opportunities are already sitting
   * with a near deadline and no application started. */
  private async executeDeadlineFocus(
    profiles: SearchProfileRow[],
    runId: string,
    newOpportunityIds: string[],
    decisions: string[],
    errors: string[],
    criticalDeadlineOpportunityIds: string[],
  ): Promise<SourceSweepResult> {
    let duplicatesSkipped = 0;
    const sweptProfileIds: string[] = [];

    for (const profile of profiles) {
      duplicatesSkipped += await this.sweepProfile(
        profile,
        runId,
        newOpportunityIds,
        decisions,
        errors,
        {
          includeFederalRegister: false,
          sourceLabelSuffix:
            "deadline-focus sweep (Federal Register and foundation matching skipped -- neither source carries real deadline data)",
        },
      );
      sweptProfileIds.push(profile.id);
    }

    await this.flagCriticalDeadlineOpportunities(
      criticalDeadlineOpportunityIds,
      runId,
      decisions,
      errors,
    );

    return { duplicatesSkipped, sweptProfileIds };
  }

  /** EXECUTION — skip_redundant strategy: every active profile already ran
   * within PROFILE_REDUNDANCY_WINDOW_DAYS, so this run makes exactly one
   * profile-agnostic SAM.gov call (its result set changes fastest of the
   * three federal sources) rather than repeating Grants.gov/Federal
   * Register/foundation matching against data that was just re-fetched. */
  private async executeSkipRedundant(
    runId: string,
    newOpportunityIds: string[],
    decisions: string[],
    errors: string[],
  ): Promise<SourceSweepResult> {
    const samGovHits = await searchSamGovOpportunities();
    const discovered = dedupeWithinBatch(samGovHits.map(mapSamGov));

    const duplicatesSkipped = await this.insertDiscoveredOpportunities(
      discovered,
      runId,
      "SAM.gov new-postings sweep (skip-redundant strategy)",
      newOpportunityIds,
      decisions,
      errors,
    );

    // No profile-scoped source ran this branch, so no profile's
    // last_run_at should be bumped -- that would falsely mark a profile as
    // "recently swept" when its actual sources were skipped.
    return { duplicatesSkipped, sweptProfileIds: [] };
  }

  /** Logs a required-human-review decision on each existing opportunity
   * whose deadline is inside the critical window and has no application
   * started, capped at CRITICAL_DEADLINE_FLAG_LIMIT per run. This is the
   * deadline_focus strategy's "decide what to do" action distinct from
   * fetching more data — surfacing what already needs attention. */
  private async flagCriticalDeadlineOpportunities(
    opportunityIds: string[],
    runId: string,
    decisions: string[],
    errors: string[],
  ): Promise<void> {
    const toFlag = opportunityIds.slice(0, CRITICAL_DEADLINE_FLAG_LIMIT);
    for (const oppId of toFlag) {
      try {
        const decisionId = await this.logDecision({
          decisionType: "critical_deadline_flagged",
          agentRunId: runId,
          entityType: "opportunity",
          entityId: oppId,
          reasoning:
            `Deadline falls within ${CRITICAL_DEADLINE_WINDOW_DAYS} days and no application ` +
            `has been started. Flagged for immediate human attention as part of this run's ` +
            `deadline-focus strategy.`,
          confidenceScore: 90,
          actionTaken: "flagged_for_application",
          requiredHumanReview: true,
        });
        decisions.push(decisionId);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to flag critical-deadline opportunity.";
        errors.push(`deadline flag ${oppId}: ${message}`);
      }
    }
  }

  /** Bumps `last_run_at` for every profile actually swept this run — closes
   * the loop for the skip_redundant signal in PERCEPTION on future runs. */
  private async touchSearchProfiles(profileIds: string[]): Promise<void> {
    if (profileIds.length === 0) return;
    await this.supabase
      .from("search_profiles")
      .update({ last_run_at: new Date().toISOString() })
      .in("id", profileIds);
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    const newOpportunityIds: string[] = [];

    try {
      // ---- PERCEPTION PHASE ----
      const snapshot = await this.perceiveState(runId);

      // ---- DECISION PHASE ----
      const { strategy, reasoning } = decideStrategy(snapshot);
      const strategyDecisionId = await this.logDecision({
        decisionType: "discovery_strategy_selected",
        agentRunId: runId,
        reasoning,
        confidenceScore: 90,
        actionTaken: `strategy:${strategy}`,
        actionPayload: {
          strategy,
          opportunitiesLast7Days: snapshot.opportunitiesLast7Days,
          avgProbabilityScore: snapshot.avgProbabilityScore,
          probabilityScoreDistribution: snapshot.probabilityScoreDistribution,
          criticalDeadlineCount: snapshot.criticalDeadlineCount,
          recentRunItemsFound: snapshot.recentRuns.map((r) => r.itemsFound),
          recentDiscoverySuccessRate: snapshot.recentDiscoverySuccessRate,
          activeProfileCount: snapshot.activeProfiles.length,
          allProfilesRanRecently: snapshot.allProfilesRanRecently,
        },
      });
      decisions.push(strategyDecisionId);

      // ---- EXECUTION PHASE ----
      let sweepResult: SourceSweepResult;
      switch (strategy) {
        case "deadline_focus":
          sweepResult = await this.executeDeadlineFocus(
            snapshot.activeProfiles,
            runId,
            newOpportunityIds,
            decisions,
            errors,
            snapshot.criticalDeadlineOpportunityIds,
          );
          break;
        case "expand_search":
          sweepResult = await this.executeExpandSearch(
            snapshot.activeProfiles,
            runId,
            newOpportunityIds,
            decisions,
            errors,
          );
          break;
        case "federal_shift":
          sweepResult = await this.executeFederalShift(
            snapshot.activeProfiles,
            runId,
            newOpportunityIds,
            decisions,
            errors,
          );
          break;
        case "skip_redundant":
          sweepResult = await this.executeSkipRedundant(
            runId,
            newOpportunityIds,
            decisions,
            errors,
          );
          break;
        case "standard":
        default:
          sweepResult = await this.executeStandard(
            snapshot.activeProfiles,
            runId,
            newOpportunityIds,
            decisions,
            errors,
          );
          break;
      }

      if (sweepResult.sweptProfileIds.length > 0) {
        await this.touchSearchProfiles(sweepResult.sweptProfileIds);
      }

      // ---- OBSERVATION PHASE ----
      const newCount = newOpportunityIds.length;
      const baselineText =
        snapshot.recentDiscoverySuccessRate === null
          ? "no prior run history to compare against"
          : `${Math.round(snapshot.recentDiscoverySuccessRate * 100)}% of the last ${snapshot.recentRuns.length} run(s) found something`;
      const observationDecisionId = await this.logDecision({
        decisionType: "discovery_observation",
        agentRunId: runId,
        reasoning:
          `Strategy "${strategy}" produced ${newCount} new opportunity(ies) and skipped ` +
          `${sweepResult.duplicatesSkipped} duplicate(s). Baseline: ${baselineText}.`,
        confidenceScore: 80,
        actionTaken: "observed_results",
        actionPayload: {
          strategy,
          newCount,
          duplicatesSkipped: sweepResult.duplicatesSkipped,
          errorCount: errors.length,
        },
      });
      decisions.push(observationDecisionId);

      // Immediate eligibility-scoring chain when this run's batch is large
      // enough that waiting for the nightly sweep would sit on it too long.
      let eligibilityChainQueued = 0;
      if (newCount > ELIGIBILITY_CHAIN_TRIGGER_THRESHOLD) {
        const toQueue = newOpportunityIds.slice(0, ELIGIBILITY_CHAIN_MAX_QUEUE);
        for (const oppId of toQueue) {
          await this.queueChainedAgent(
            "eligibility_scoring",
            CHAIN_PRIORITY_HIGH,
            { opportunityId: oppId },
            runId,
          );
          eligibilityChainQueued++;
        }
        const eligibilityDecisionId = await this.logDecision({
          decisionType: "eligibility_scoring_chained",
          agentRunId: runId,
          reasoning:
            `${newCount} new opportunities found (threshold: >${ELIGIBILITY_CHAIN_TRIGGER_THRESHOLD}). ` +
            `Queued ${eligibilityChainQueued} for immediate eligibility scoring instead of waiting ` +
            `for the nightly sweep.`,
          confidenceScore: 85,
          actionTaken: "queued_eligibility_scoring",
          actionPayload: { queuedCount: eligibilityChainQueued },
        });
        decisions.push(eligibilityDecisionId);
      }

      // Probability-scoring chain — org must have auto-scoring enabled, this
      // run must have found at least PROBABILITY_CHAIN_MIN_NEW_OPPORTUNITIES,
      // and the org's existing pipeline-quality baseline (the closest real
      // proxy for "new opportunities' eligibility" — see file header) must
      // not already be known-poor. A null baseline (nothing scored yet) does
      // not block the chain.
      const config = await this.getOrgConfig();
      const probabilityGateOk =
        snapshot.avgProbabilityScore === null ||
        snapshot.avgProbabilityScore >= PROBABILITY_CHAIN_MIN_AVG_SCORE;
      let didChainProbability = false;
      if (
        config.auto_score_enabled &&
        newCount >= PROBABILITY_CHAIN_MIN_NEW_OPPORTUNITIES &&
        probabilityGateOk
      ) {
        await this.queueChainedAgent(
          "ag-15-probability",
          CHAIN_PRIORITY_HIGH,
          { opportunityIds: newOpportunityIds },
          runId,
        );
        didChainProbability = true;
        const probabilityDecisionId = await this.logDecision({
          decisionType: "probability_scoring_chained",
          agentRunId: runId,
          reasoning:
            `${newCount} new opportunities (>= ${PROBABILITY_CHAIN_MIN_NEW_OPPORTUNITIES}) and ` +
            `pipeline baseline ${
              snapshot.avgProbabilityScore === null
                ? "unscored (treated as pass)"
                : `${snapshot.avgProbabilityScore.toFixed(1)} (>= ${PROBABILITY_CHAIN_MIN_AVG_SCORE})`
            }. Chaining to ag-15-probability at high priority.`,
          confidenceScore: 85,
          actionTaken: "queued_probability_scoring",
          actionPayload: { opportunityCount: newCount },
        });
        decisions.push(probabilityDecisionId);
      }

      const nextActions: string[] = [];
      if (eligibilityChainQueued > 0) nextActions.push("eligibility_scoring");
      if (didChainProbability) nextActions.push("ag-15-probability");

      await this.completeRun(runId, {
        outputSummary: JSON.stringify({
          strategy,
          newOpportunities: newCount,
          duplicatesSkipped: sweepResult.duplicatesSkipped,
          eligibilityChainQueued,
          chainedToProbabilityScoring: didChainProbability,
          opportunityIds: newOpportunityIds,
        }),
        itemsFound: newCount,
        itemsProcessed: newCount + sweepResult.duplicatesSkipped,
        itemsQueued: nextActions.length,
        nextAction: nextActions[0],
      });

      return {
        success: true,
        itemsFound: newCount,
        itemsProcessed: newCount + sweepResult.duplicatesSkipped,
        itemsQueued: nextActions.length,
        decisions,
        nextActions,
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Opportunity discovery failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: newOpportunityIds.length,
        itemsProcessed: newOpportunityIds.length,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}

/**
 * Thin functional wrapper preserving the pre-existing call site
 * (src/app/api/agents/discovery/route.ts): constructs and runs the agent.
 */
export async function runOpportunityDiscovery(
  orgId: string,
  supabase: SupabaseClient,
  triggerSource: TriggerSource = "manual",
): Promise<AutonomousAgentResult> {
  const agent = new OpportunityDiscoveryAgent(orgId, supabase);
  return agent.run(triggerSource);
}
