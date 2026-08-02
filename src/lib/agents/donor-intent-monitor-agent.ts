// AG-30 Donor Intent Monitor Agent (AutonomousAgent, migration 093:
// corporate_intent_signals). Phase 2 per AUTONOMOUS_PLATFORM_VISION.md
// section "AI Donor Intent Engine" and AGENTS_v2.md's Phase 2-5 spec section
// ("AG-30: Donor Intent Monitor"). Enterprise-hardening rewrite: deterministic
// geographic scoring, weighted multi-factor intent scoring, per-prospect
// 3-query web search, 60-day update-on-conflict dedup, urgent alerting.
//
// Numbering note: AUTONOMOUS_PLATFORM_VISION.md itself numbers this feature
// AG-31 ("New AG-31 (Donor Intent Agent)"), while AGENTS_v2.md's Phase 2-5
// addendum (the doc this build task was scoped from) calls it AG-30 - the two
// governance docs disagree and both flag it as a known mismatch rather than
// an accident (see AGENTS_v2.md section 1.4). This agent's agentId
// ("ag-30-donor-intent") is deliberately suffixed, matching the precedent set
// by fundability-scorer-agent.ts ("ag-29-fundability") and
// community-need-predictor-agent.ts ("ag-35-community-need"), so its
// agent_type enum value can never collide with a future literal
// "ag-30"/"ag-31" build either way.
//
// Deviations from this build task's literal spec, required because the task
// named tables/columns that don't exist in the live schema (see project
// memory `benavora-task-migration-specs-collide`) - each is a deliberate,
// reasoned substitution, not a silent gap:
//
//   1. "supabase.from('notifications').insert(...)" - there is no
//      `notifications` table anywhere in this schema (verified against every
//      migration under src/supabase/migrations/). autonomous-base.ts's own
//      header documents this explicitly: all in-app notices live in `alerts`
//      via createNotification(). Writing to a nonexistent table would throw
//      at runtime on every high-intent signal - the opposite of hardening.
//      `alerts` has no `priority` column either; its equivalent is
//      `severity` (info/warning/error/success) - urgent signals use
//      "warning", the closest real value to "needs attention now" without
//      implying the platform itself is broken (which "error" would).
//   2. "knowledge_base_profiles.geographic_data" - no such table exists.
//      Org geography lives on `organizations` (city, state, service_area -
//      a single free-text column, not a service_areas[] array; that array
//      belongs to organizational_digital_twins, a different table, per a
//      live-schema check documented in AGENT_VERIFICATION_LOG.md) - used
//      directly below.
//   3. "Extract NTEE code from organizations table" - `organizations` has no
//      ntee_code column (NTEE classification lives on `foundation_directory`,
//      a different entity). Substitutes the org fields
//      fundability-scorer-agent.ts and this file's prior version already
//      established as the real available mission-fit signal: tax_status,
//      mission_statement, service_area, target_population.
//   4. "Compare against signal content using Claude classification call" -
//      implemented as a field in the same grounded web-search call rather
//      than a separate round-trip. Claude already has the org's mission
//      fields, the prospect's industry/NAICS data, and the live search
//      results in one turn; a 4th sequential Claude call per prospect would
//      re-send the same context for a classification it can already produce
//      inline, tripling token spend for no accuracy gain.
//
// Web search: every prospect gets exactly 3 targeted, independently-issued
// searches (CSR/giving, ESG/community-investment, press-release/foundation),
// each forced via callClaudeWithWebSearch's maxSearches:1 so the search
// actually fires rather than being left to model discretion. Block-array
// parsing ("never assume content[0] is text") happens inside
// callClaudeWithWebSearch (src/lib/ai/claude.ts) via `.filter(block =>
// block.type === "text")` over the full content array - every other
// web-search-grounded agent in this codebase (community-need-predictor-agent,
// fundability-scorer-agent) goes through that same helper, and no agent file
// constructs the Anthropic SDK client directly (verified: no
// `@anthropic-ai/sdk` import anywhere under src/lib/agents/ except
// src/lib/ai/claude.ts itself). Duplicating client/key bootstrap in this file
// would break that convention for no benefit.
//
// Grounding: a query call that never actually issues a web_search
// (usedWebSearch=false) has its output discarded outright - a model turn
// that didn't search never gets persisted as if it had (CLAUDE.md Iron Law
// #8 / #3).
//
// Geographic relevance is computed deterministically from real address data
// (org city/state/service_area vs corporate_prospects.address_city/
// address_state via a static US state-adjacency table), not asked of the
// model - this is exactly the "compare city/state" instruction in this
// task's own spec, and a structured comparison is strictly more reliable
// than an LLM guess at geographic proximity.
//
// Hard limits (AUTONOMOUS_HARD_LIMITS, AGENTS_v2.md AG-30 spec): never
// asserts intent as fact - every inserted row carries its signal_url/
// signal_date evidence and only ever surfaces a recommended_action for a
// human to act on. NEVER_SEND_EMAIL_WITHOUT_APPROVAL applies structurally -
// this agent never contacts a prospect, drafts outreach, or triggers AG-11/
// AG-24; a "Predicted Intent" signal is a badge for a human, never a trigger.

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, addHours, differenceInCalendarDays, format, subDays } from "date-fns";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaudeWithWebSearch } from "@/lib/ai/claude";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

type SignalType =
  | "press_release"
  | "esg_report"
  | "sec_filing"
  | "hiring_trend"
  | "facility_expansion"
  | "disaster_declaration"
  | "foundation_appointment"
  | "csr_announcement"
  | "executive_interview";

const SIGNAL_TYPES: SignalType[] = [
  "press_release",
  "esg_report",
  "sec_filing",
  "hiring_trend",
  "facility_expansion",
  "disaster_declaration",
  "foundation_appointment",
  "csr_announcement",
  "executive_interview",
];

/** Base weight per signal type. Six of nine are exact values from this
 * feature's build task (facility_expansion, disaster_declaration,
 * csr_announcement, esg_report, hiring_trend, press_release); sec_filing/
 * foundation_appointment/executive_interview are reasoned defaults slotted
 * between the given anchors by relative predictive strength, matching the
 * precedent this file already set for the un-specified three. */
const SIGNAL_TYPE_BASE_SCORE: Record<SignalType, number> = {
  facility_expansion: 90,
  disaster_declaration: 85,
  foundation_appointment: 75,
  csr_announcement: 80,
  esg_report: 70,
  sec_filing: 60,
  hiring_trend: 65,
  executive_interview: 55,
  press_release: 50,
};

/** One concrete, signal-type-specific approach clause for the >=80
 * recommended_action template (build task requirement 5: "Recommended
 * approach: [specific to signal type]"). */
const SIGNAL_TYPE_APPROACH: Record<SignalType, string> = {
  facility_expansion:
    "reference their new or expanding facility and request a site-based partnership meeting",
  disaster_declaration:
    "submit a disaster-relief partnership request citing the active declaration",
  csr_announcement:
    "respond directly to their announced CSR initiative with an aligned funding request",
  esg_report:
    "cite their published ESG community-investment commitments in your outreach",
  hiring_trend:
    "highlight shared community-impact priorities when reaching out to their newly hired sustainability/community roles",
  press_release: "reference the press release directly in your introduction",
  sec_filing: "cite the filing's community-investment disclosure in your outreach",
  foundation_appointment: "reach out to the newly appointed foundation/CSR lead directly",
  executive_interview: "reference the executive's stated giving priorities from the interview",
};

/** Static US state-adjacency table (48 contiguous states + DC; AK/HI have no
 * land borders). Used only for the deterministic geographic_relevance_factor
 * below - a fixed geographic fact, not a live-fetched or model-guessed value. */
const STATE_ADJACENCY: Record<string, string[]> = {
  AL: ["GA", "FL", "MS", "TN"],
  AK: [],
  AZ: ["CA", "NV", "UT", "CO", "NM"],
  AR: ["MO", "TN", "MS", "LA", "TX", "OK"],
  CA: ["OR", "NV", "AZ"],
  CO: ["WY", "NE", "KS", "OK", "NM", "AZ", "UT"],
  CT: ["NY", "MA", "RI"],
  DE: ["MD", "PA", "NJ"],
  FL: ["AL", "GA"],
  GA: ["FL", "AL", "TN", "NC", "SC"],
  HI: [],
  ID: ["MT", "WY", "UT", "NV", "OR", "WA"],
  IL: ["IN", "KY", "MO", "IA", "WI"],
  IN: ["MI", "OH", "KY", "IL"],
  IA: ["MN", "WI", "IL", "MO", "NE", "SD"],
  KS: ["NE", "MO", "OK", "CO"],
  KY: ["IN", "OH", "WV", "VA", "TN", "MO", "IL"],
  LA: ["TX", "AR", "MS"],
  ME: ["NH"],
  MD: ["VA", "WV", "PA", "DE", "DC"],
  MA: ["RI", "CT", "NY", "NH", "VT"],
  MI: ["OH", "IN", "WI"],
  MN: ["WI", "IA", "SD", "ND"],
  MS: ["LA", "AR", "TN", "AL"],
  MO: ["IA", "IL", "KY", "TN", "AR", "OK", "KS", "NE"],
  MT: ["ND", "SD", "WY", "ID"],
  NE: ["SD", "IA", "MO", "KS", "CO", "WY"],
  NV: ["CA", "OR", "ID", "UT", "AZ"],
  NH: ["ME", "MA", "VT"],
  NJ: ["NY", "PA", "DE"],
  NM: ["AZ", "UT", "CO", "OK", "TX"],
  NY: ["NJ", "PA", "CT", "MA", "VT"],
  NC: ["VA", "TN", "GA", "SC"],
  ND: ["MN", "SD", "MT"],
  OH: ["MI", "PA", "WV", "KY", "IN"],
  OK: ["KS", "MO", "AR", "TX", "NM", "CO"],
  OR: ["WA", "ID", "NV", "CA"],
  PA: ["NY", "NJ", "DE", "MD", "WV", "OH"],
  RI: ["CT", "MA"],
  SC: ["NC", "GA"],
  SD: ["ND", "MN", "IA", "NE", "WY", "MT"],
  TN: ["KY", "VA", "NC", "GA", "AL", "MS", "AR", "MO"],
  TX: ["NM", "OK", "AR", "LA"],
  UT: ["ID", "WY", "CO", "NM", "AZ", "NV"],
  VT: ["NY", "NH", "MA"],
  VA: ["NC", "TN", "KY", "WV", "MD", "DC"],
  WA: ["ID", "OR"],
  WV: ["OH", "PA", "MD", "VA", "KY"],
  WI: ["MI", "MN", "IA", "IL"],
  WY: ["MT", "ND", "SD", "NE", "CO", "UT", "ID"],
  DC: ["MD", "VA"],
};

const INTENT_SCORE_THRESHOLD = 60;
const HIGH_INTENT_THRESHOLD = 80;
const NOTIFY_GEO_THRESHOLD = 70; // 0.7 on this task's 0-1 scale == 70 on the stored 0-100 column
const MAX_PROSPECTS_PER_RUN = 5;
const MAX_SIGNALS_PER_PROSPECT = 3;
const MAX_TOKENS = 900;
const DEDUP_WINDOW_DAYS = 60;

interface OrgProfile {
  id: string;
  name: string;
  tax_status: string | null;
  mission_statement: string | null;
  service_area: string | null;
  target_population: string | null;
  city: string | null;
  state: string | null;
}

interface ProspectRow {
  id: string;
  legal_name: string;
  website: string | null;
  address_city: string | null;
  address_state: string | null;
  naics_description: string | null;
  industry_category: string | null;
}

interface RawSignal {
  signal_type?: string;
  signal_summary?: string;
  signal_url?: string;
  signal_date?: string;
  mission_alignment?: number;
}

interface ValidatedSignal {
  signal_type: SignalType;
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

/** Validates one of Claude's raw signal objects against
 * corporate_intent_signals' CHECK constraints (migration 093). An invalid
 * signal_type or missing summary is rejected outright rather than inserted
 * and left for a downstream reader to reconcile. */
function validateSignal(raw: RawSignal): ValidatedSignal | null {
  if (!raw.signal_type || !SIGNAL_TYPES.includes(raw.signal_type as SignalType)) {
    return null;
  }
  if (!raw.signal_summary || raw.signal_summary.trim() === "") return null;

  const signal_date =
    typeof raw.signal_date === "string" && isValidDate(raw.signal_date)
      ? raw.signal_date
      : null;

  return {
    signal_type: raw.signal_type as SignalType,
    signal_summary: raw.signal_summary,
    signal_url:
      typeof raw.signal_url === "string" && raw.signal_url.trim() !== ""
        ? raw.signal_url
        : null,
    signal_date,
    mission_alignment: clamp0to100(raw.mission_alignment, 50),
  };
}

function extractJsonArray(text: string): RawSignal[] {
  const jsonText = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    const parsed: unknown = JSON.parse(jsonText);
    return Array.isArray(parsed) ? (parsed as RawSignal[]) : [];
  } catch {
    return [];
  }
}

/** Deterministic geographic_relevance_factor (build task requirement 3):
 * same_city=1.0, same_state=0.7, adjacent_state=0.4, national=0.2. Also
 * treats an explicit match in organizations.service_area as same_state-
 * equivalent, since an org's declared service footprint can extend beyond
 * its own mailing address (e.g. a Texas org whose service_area also names
 * "OK"). organizations has only a single free-text service_area column, not
 * a service_areas[] array (that array lives on organizational_digital_twins,
 * a different table — confirmed against the live schema; the plural column
 * this function used to reference here doesn't exist on organizations at
 * all, see AGENT_VERIFICATION_LOG.md). Insufficient address data on either
 * side falls back to the national floor rather than guessing. */
function geographicRelevanceFactor(org: OrgProfile, prospect: ProspectRow): number {
  const orgState = org.state?.trim().toUpperCase() || null;
  const orgCity = org.city?.trim().toLowerCase() || null;
  const prospectState = prospect.address_state?.trim().toUpperCase() || null;
  const prospectCity = prospect.address_city?.trim().toLowerCase() || null;

  if (!prospectState) return 0.2;

  if (orgState && prospectState === orgState) {
    if (orgCity && prospectCity && orgCity === prospectCity) return 1.0;
    return 0.7;
  }

  const serviceAreaMatch = (org.service_area ?? "").toUpperCase().includes(prospectState);
  if (serviceAreaMatch) return 0.7;

  if (orgState && (STATE_ADJACENCY[orgState] ?? []).includes(prospectState)) {
    return 0.4;
  }

  return 0.2;
}

/** Composite intent score. Base implements the exact per-type multipliers
 * from this task's spec (facility_expansion's geographic_match_multiplier,
 * disaster_declaration's recency_multiplier, esg_report's mission_match
 * proxy - see file header deviation #3 on why mission_match uses the
 * Claude-classified mission_alignment rather than an NTEE lookup that
 * doesn't exist), then applies:
 *   intent_score = min(100, round(effective_base * geo_factor * mission_factor))
 * exactly as specified. */
function computeIntentScore(
  signalType: SignalType,
  geoFactor: number,
  missionFactor: number,
  signalDate: string | null,
): number {
  const base = SIGNAL_TYPE_BASE_SCORE[signalType];
  let effectiveBase = base;

  if (signalType === "facility_expansion") {
    effectiveBase = geoFactor >= 0.7 ? base * 1.3 : base;
  } else if (signalType === "disaster_declaration") {
    const daysSince = signalDate
      ? differenceInCalendarDays(new Date(), new Date(signalDate))
      : null;
    const recencyMultiplier =
      daysSince === null || daysSince < 0
        ? 1.0
        : daysSince <= 30
          ? 1.5
          : daysSince <= 90
            ? 1.2
            : 1.0;
    effectiveBase = base * recencyMultiplier;
  } else if (signalType === "esg_report") {
    effectiveBase = base * (0.8 + 0.4 * missionFactor);
  }

  const raw = effectiveBase * geoFactor * missionFactor;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function buildRecommendedAction(
  companyName: string,
  intentScore: number,
  signalType: SignalType,
): string {
  if (intentScore >= HIGH_INTENT_THRESHOLD) {
    return (
      `Schedule introduction within 48 hours. ${companyName} signal indicates ` +
      `active giving window. Recommended approach: ${SIGNAL_TYPE_APPROACH[signalType]}.`
    );
  }
  return "Monitor and prepare proposal. Target submission in 30 days.";
}

const SEARCH_QUERY_TEMPLATES: Array<(company: string) => string> = [
  (company) => `${company} CSR donations giving 2025 2026`,
  (company) => `${company} ESG report community investment`,
  (company) => `${company} press release grant foundation`,
];

export class DonorIntentMonitorAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-30-donor-intent", supabase);
  }

  private async loadOrgProfile(): Promise<OrgProfile | null> {
    const { data } = await this.supabase
      .from("organizations")
      .select(
        "id, name, tax_status, mission_statement, service_area, target_population, city, state",
      )
      .eq("id", this.orgId)
      .maybeSingle();
    return (data ?? null) as OrgProfile | null;
  }

  /** corporate_prospects is a shared, non-org-scoped pool (project memory
   * `benavora-corporate-prospects-no-org-id`). Prefer prospects in the org's
   * own state when known so geographic scoring has a real anchor; fall back
   * to the most recently added prospects overall otherwise.
   *
   * As of 2026-07-20, corporate_prospects does not exist in the live
   * production schema at all (confirmed via direct PostgREST introspection:
   * PGRST205, "Could not find the table 'public.corporate_prospects' in the
   * schema cache" - consistent with SCHEMA_REGISTRY_v2.md's own "Live
   * Database Audit" section, which lists corporate_prospects among tables
   * documented here but never shipped to prod). This must degrade the run to
   * "zero prospects found" with a clear reason rather than throw and fail
   * the whole agent run - the same fail-open posture every zero-signal path
   * in this file already takes. */
  private async loadProspects(
    org: OrgProfile,
  ): Promise<{ prospects: ProspectRow[]; loadError: string | null }> {
    const baseSelect =
      "id, legal_name, website, address_city, address_state, naics_description, industry_category";

    if (org.state) {
      const { data, error } = await this.supabase
        .from("corporate_prospects")
        .select(baseSelect)
        .eq("address_state", org.state)
        .order("created_at", { ascending: false })
        .limit(MAX_PROSPECTS_PER_RUN * 3);

      if (!error && data && data.length > 0) {
        return {
          prospects: (data as ProspectRow[]).slice(0, MAX_PROSPECTS_PER_RUN),
          loadError: null,
        };
      }
    }

    const { data, error } = await this.supabase
      .from("corporate_prospects")
      .select(baseSelect)
      .order("created_at", { ascending: false })
      .limit(MAX_PROSPECTS_PER_RUN);

    if (error) {
      return {
        prospects: [],
        loadError:
          `corporate_prospects is unavailable in this environment (${error.message}) - ` +
          "this table does not exist in production as of 2026-07-20; no prospects to " +
          "analyze this run. Seed corporate_intent_signals directly (scripts/seed-intent-signals.ts) " +
          "for test data, or build/apply a migration creating corporate_prospects before relying " +
          "on live discovery.",
      };
    }
    return { prospects: (data ?? []) as ProspectRow[], loadError: null };
  }

  /** org_autonomous_config.auto_autoapply_enabled / max_nightly_autoapply_submissions
   * (migration 092_autoapply_autonomous_orchestrator.sql, src/supabase/migrations/)
   * are not live in every environment - confirmed absent from production as of
   * 2026-07-20 (42703 "column does not exist"), consistent with the project's
   * two-parallel-migration-tracks gap (root supabase/migrations/ vs
   * src/supabase/migrations/; see project memory
   * `benavora-two-parallel-migrations-directories`). Degrade to "AutoApply
   * wiring disabled" instead of failing the run over an unrelated column gap -
   * once migration 092 is actually applied here, this starts working with no
   * code change required. */
  private async loadAutoApplyConfig(): Promise<{
    enabled: boolean;
    maxNightly: number;
    unavailable: boolean;
  }> {
    const { data, error } = await this.supabase
      .from("org_autonomous_config")
      .select("auto_autoapply_enabled, max_nightly_autoapply_submissions")
      .eq("org_id", this.orgId)
      .maybeSingle();

    if (error) {
      return { enabled: false, maxNightly: 0, unavailable: true };
    }
    const row = data as {
      auto_autoapply_enabled: boolean | null;
      max_nightly_autoapply_submissions: number | null;
    } | null;
    return {
      enabled: Boolean(row?.auto_autoapply_enabled),
      maxNightly: row?.max_nightly_autoapply_submissions ?? 50,
      unavailable: false,
    };
  }

  private async countQueuedToday(): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count } = await this.supabase
      .from("submission_queue")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", this.orgId)
      .gte("created_at", todayStart.toISOString());
    return count ?? 0;
  }

  /** A "known portal" for AutoApply queueing means the org already tracks
   * this company as a funder with a giving_portal_url on file - this agent
   * never invents a portal URL for a company it only has a free-text
   * company_name for (corporate_intent_signals has no prospect_id/company_id
   * FK - see file header). This mirrors the real, already-shipped convention
   * in worker/autoapply-autonomous-orchestrator.ts's resolveFunderId(), which
   * only queues when a donation form is already confirmed - the difference
   * here is this agent never auto-creates a funders row, since an intent
   * signal alone is not confirmation of a giving portal's existence. */
  private async findKnownPortalFunder(companyName: string): Promise<string | null> {
    const { data } = await this.supabase
      .from("funders")
      .select("id, giving_portal_url")
      .eq("organization_id", this.orgId)
      .ilike("name", companyName)
      .not("giving_portal_url", "is", null)
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  /** Same 30-day dedup window as worker/autoapply-autonomous-orchestrator.ts's
   * ranRecently() - a funder already submitted to recently, or already sitting
   * in submission_queue, is never re-queued. */
  private async alreadyQueuedOrSubmitted(funderId: string): Promise<boolean> {
    const since = subDays(new Date(), 30).toISOString();
    const { data: recentSubmission } = await this.supabase
      .from("autoapply_submissions")
      .select("id")
      .eq("organization_id", this.orgId)
      .eq("funder_id", funderId)
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    if (recentSubmission) return true;

    const { data: pendingItem } = await this.supabase
      .from("submission_queue")
      .select("id")
      .eq("organization_id", this.orgId)
      .eq("funder_id", funderId)
      .in("status", ["pending", "processing"])
      .limit(1)
      .maybeSingle();
    return Boolean(pendingItem);
  }

  /** HARD LIMIT: this only ever inserts into submission_queue (status=
   * 'pending') - it never submits externally. The existing AutoApply human
   * approval checkpoint (AGENTS_v2.md AG-12 spec) still gates the actual
   * submission downstream; queueing is not submitting. */
  private async queueForAutoApply(
    prospect: ProspectRow,
    intentScore: number,
    runId: string,
    decisions: string[],
    errors: string[],
  ): Promise<void> {
    try {
      const funderId = await this.findKnownPortalFunder(prospect.legal_name);
      if (!funderId) return;
      if (await this.alreadyQueuedOrSubmitted(funderId)) return;

      const { error: insertError } = await this.supabase.from("submission_queue").insert({
        organization_id: this.orgId,
        funder_id: funderId,
        priority: Math.min(100, Math.max(1, 101 - intentScore)),
        status: "pending",
        automation_mode: "autonomous",
      });

      if (insertError) {
        errors.push(
          `AutoApply queue insert failed for "${prospect.legal_name}": ${insertError.message}`,
        );
        return;
      }

      decisions.push(
        await this.logDecision({
          decisionType: "autoapply_queued",
          agentRunId: runId,
          entityType: "funder",
          entityId: funderId,
          reasoning:
            `${prospect.legal_name} intent_score ${intentScore} >= ${HIGH_INTENT_THRESHOLD} and ` +
            "org has auto_autoapply_enabled; a known giving portal is already on file for this funder.",
          confidenceScore: intentScore,
          actionTaken:
            "Queued for AutoApply (submission_queue, status=pending) - final submission still " +
            "requires the existing human approval checkpoint (AUTONOMOUS_HARD_LIMITS.NEVER_SUBMIT_EXTERNALLY).",
          actionPayload: { funder_id: funderId, intent_score: intentScore },
          requiredHumanReview: true,
        }),
      );
    } catch (err) {
      errors.push(
        `AutoApply wiring failed for "${prospect.legal_name}": ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
    }
  }

  /** Dedup key is (org_id, company_name, signal_type) within a 60-day
   * window (build task requirement 6). corporate_intent_signals has no
   * unique constraint on that tuple (migration 093 predates this
   * requirement), so this is an explicit select-then-write rather than a
   * database-level upsert. */
  private async findExistingSignal(
    companyName: string,
    signalType: SignalType,
  ): Promise<string | null> {
    const since = subDays(new Date(), DEDUP_WINDOW_DAYS).toISOString();
    const { data } = await this.supabase
      .from("corporate_intent_signals")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("company_name", companyName)
      .eq("signal_type", signalType)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  private buildPrompt(
    org: OrgProfile,
    prospect: ProspectRow,
    query: string,
  ): { system: string; prompt: string } {
    const system = [
      "You are a corporate giving intelligence analyst. Your job is to run ONE specific web search and extract REAL, CURRENTLY VERIFIABLE public signals that predict whether a company is likely to announce a charitable giving initiative in the next 30-90 days.",
      "",
      "RULES:",
      "1. You MUST issue exactly one web_search call for the exact query given below before answering. Only report a signal when you found real, cited evidence in that search - never estimate, infer, or recall a signal from training data alone. If the search finds nothing relevant, return an empty array.",
      "2. signal_type must be exactly one of: " + SIGNAL_TYPES.join(", ") + ".",
      "3. mission_alignment (0-100) rates how well this company's apparent giving priorities (from what you find, or its industry if nothing giving-specific is found) align with the nonprofit's mission and target population given below. 100 means a direct, obvious fit.",
      `4. Report at most ${MAX_SIGNALS_PER_PROSPECT} signals, only the strongest ones you can actually substantiate from this search's results.`,
      "5. Respond with ONLY a JSON array (no markdown fences, no prose) of objects shaped exactly:",
      '{"signal_type": "...", "signal_summary": "one to two sentences", "signal_url": "source URL", "signal_date": "YYYY-MM-DD if known", "mission_alignment": <integer 0-100>}',
    ].join("\n");

    const orgLines = [
      `- Name: ${org.name}`,
      org.tax_status ? `- Tax status: ${org.tax_status}` : null,
      org.mission_statement ? `- Mission: ${org.mission_statement}` : null,
      org.service_area
        ? `- Service area: ${org.service_area}`
        : org.city || org.state
          ? `- Service area: ${[org.city, org.state].filter(Boolean).join(", ")}`
          : null,
      org.target_population ? `- Target population: ${org.target_population}` : null,
    ].filter((line): line is string => line !== null);

    const prospectLines = [
      `- Company: ${prospect.legal_name}`,
      prospect.website ? `- Website: ${prospect.website}` : null,
      prospect.address_city || prospect.address_state
        ? `- Known location: ${[prospect.address_city, prospect.address_state].filter(Boolean).join(", ")}`
        : null,
      prospect.industry_category
        ? `- Industry: ${prospect.industry_category}`
        : prospect.naics_description
          ? `- Industry (NAICS): ${prospect.naics_description}`
          : null,
    ].filter((line): line is string => line !== null);

    const prompt = [
      "## Nonprofit (the org looking for donor intent signals)",
      orgLines.join("\n"),
      "",
      "## Company to research",
      prospectLines.join("\n"),
      "",
      `Search for exactly this query: "${query}"`,
      "Return ONLY the JSON array described above, based solely on that search's results.",
    ].join("\n");

    return { system, prompt };
  }

  /** Runs this prospect's 3 targeted searches (build task requirement 1) and
   * returns every validated signal that actually came from a real search. */
  private async searchProspect(
    org: OrgProfile,
    prospect: ProspectRow,
  ): Promise<{ signals: ValidatedSignal[]; tokensUsed: number; errors: string[] }> {
    const errors: string[] = [];
    let tokensUsed = 0;

    const results = await Promise.all(
      SEARCH_QUERY_TEMPLATES.map(async (template) => {
        const query = template(prospect.legal_name);
        const { system, prompt } = this.buildPrompt(org, prospect, query);
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
          errors.push(`${prospect.legal_name} (${query}): ${message}`);
          return null;
        }
      }),
    );

    const signals: ValidatedSignal[] = [];
    for (const result of results) {
      if (!result) continue;
      tokensUsed += result.response.usage.totalTokens;

      if (!result.response.usedWebSearch) {
        errors.push(
          `${prospect.legal_name} (${result.query}): Claude did not issue a web_search call - discarded rather than persist an ungrounded signal.`,
        );
        continue;
      }

      const rawSignals = extractJsonArray(result.response.text);
      for (const raw of rawSignals) {
        const validated = validateSignal(raw);
        if (validated) signals.push(validated);
      }
    }

    return { signals: signals.slice(0, MAX_SIGNALS_PER_PROSPECT), tokensUsed, errors };
  }

  override async run(triggerSource: TriggerSource): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;
    let itemsFound = 0;
    let itemsProcessed = 0;
    let itemsQueued = 0;

    try {
      const org = await this.loadOrgProfile();
      if (!org) throw new Error(`Could not load organization ${this.orgId}.`);

      const { prospects, loadError } = await this.loadProspects(org);
      itemsFound = prospects.length;
      if (loadError) errors.push(loadError);

      const autoApplyConfig = await this.loadAutoApplyConfig();
      if (autoApplyConfig.unavailable) {
        errors.push(
          "AutoApply wiring skipped: org_autonomous_config.auto_autoapply_enabled is not present " +
            "in this environment (migration 092 not applied here) - queueing will activate automatically " +
            "once that migration is applied.",
        );
      }
      let autoApplyBudgetRemaining = autoApplyConfig.enabled
        ? Math.max(0, autoApplyConfig.maxNightly - (await this.countQueuedToday()))
        : 0;

      for (const prospect of prospects) {
        try {
          const geoFactor = geographicRelevanceFactor(org, prospect);
          const { signals, tokensUsed: prospectTokens, errors: prospectErrors } =
            await this.searchProspect(org, prospect);
          tokensUsed += prospectTokens;
          errors.push(...prospectErrors);
          itemsProcessed += 1;

          for (const signal of signals) {
            const missionFactor = signal.mission_alignment / 100;
            const intentScore = computeIntentScore(
              signal.signal_type,
              geoFactor,
              missionFactor,
              signal.signal_date,
            );
            if (intentScore < INTENT_SCORE_THRESHOLD) continue;

            const isHighIntent = intentScore >= HIGH_INTENT_THRESHOLD;
            const recommendedDeadline = format(
              isHighIntent ? addHours(new Date(), 48) : addDays(new Date(), 7),
              "yyyy-MM-dd",
            );
            const recommendedAction = buildRecommendedAction(
              prospect.legal_name,
              intentScore,
              signal.signal_type,
            );
            const geographicRelevance = Math.round(geoFactor * 100);
            const missionAlignment = Math.round(missionFactor * 100);

            const signalRow = {
              org_id: this.orgId,
              company_name: prospect.legal_name,
              signal_type: signal.signal_type,
              signal_summary: signal.signal_summary,
              signal_url: signal.signal_url,
              signal_date: signal.signal_date,
              intent_score: intentScore,
              geographic_relevance: geographicRelevance,
              mission_alignment: missionAlignment,
              recommended_action: recommendedAction,
              recommended_deadline: recommendedDeadline,
            };

            const existingId = await this.findExistingSignal(
              prospect.legal_name,
              signal.signal_type,
            );

            let signalId: string | null = null;
            if (existingId) {
              const { error: updateError } = await this.supabase
                .from("corporate_intent_signals")
                .update(signalRow)
                .eq("id", existingId);
              if (updateError) {
                errors.push(
                  `Failed to update intent signal for "${prospect.legal_name}": ${updateError.message}`,
                );
                continue;
              }
              signalId = existingId;
            } else {
              const { data: inserted, error: insertError } = await this.supabase
                .from("corporate_intent_signals")
                .insert(signalRow)
                .select("id")
                .single();
              if (insertError || !inserted) {
                errors.push(
                  `Failed to save intent signal for "${prospect.legal_name}": ${
                    insertError?.message ?? "no row returned"
                  }`,
                );
                continue;
              }
              signalId = (inserted as { id: string }).id;
            }

            itemsQueued += 1;

            decisions.push(
              await this.logDecision({
                decisionType: "donor_intent_detected",
                agentRunId: runId,
                entityType: "corporate_intent_signal",
                entityId: signalId,
                reasoning:
                  `${prospect.legal_name}: ${signal.signal_summary} ` +
                  `(type=${signal.signal_type}, geo=${geographicRelevance}, mission=${missionAlignment}) ` +
                  `-> intent_score ${intentScore}/100.`,
                confidenceScore: intentScore,
                actionTaken: existingId
                  ? `Updated existing intent signal (${DEDUP_WINDOW_DAYS}-day window match).`
                  : isHighIntent
                    ? `Recorded HIGH-intent signal (>=${HIGH_INTENT_THRESHOLD}); recommended action due within 48 hours.`
                    : `Recorded intent signal; recommended action due within 7 days.`,
                actionPayload: {
                  signal_type: signal.signal_type,
                  signal_url: signal.signal_url,
                  intent_score: intentScore,
                  geographic_relevance: geographicRelevance,
                  mission_alignment: missionAlignment,
                  recommended_action: recommendedAction,
                  recommended_deadline: recommendedDeadline,
                },
                requiredHumanReview: true,
              }),
            );

            // Build task requirement 7: notify immediately for high-intent,
            // geographically relevant signals. Real equivalent of
            // "notifications insert priority='urgent'" - see file header
            // deviation #1 (no `notifications` table; `alerts` + severity is
            // the real mechanism every other agent in this codebase uses).
            if (isHighIntent && geographicRelevance >= NOTIFY_GEO_THRESHOLD) {
              await this.createNotification(
                "donor_intent_high",
                `High donor intent: ${prospect.legal_name}`,
                recommendedAction,
                undefined,
                "warning",
              );
            }

            // AutoApply wiring: only high-intent signals, only when the org
            // has opted in, only within the nightly budget, and only when a
            // known giving portal already exists on file (see
            // queueForAutoApply / findKnownPortalFunder above).
            if (isHighIntent && autoApplyConfig.enabled && autoApplyBudgetRemaining > 0) {
              const beforeCount = decisions.length;
              await this.queueForAutoApply(prospect, intentScore, runId, decisions, errors);
              if (decisions.length > beforeCount) autoApplyBudgetRemaining -= 1;
            }
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to analyze prospect for donor intent.";
          errors.push(`${prospect.legal_name}: ${message}`);
        }
      }

      const summary =
        itemsQueued > 0
          ? `Analyzed ${itemsProcessed} of ${itemsFound} prospect(s); recorded ${itemsQueued} donor intent signal(s) at or above ${INTENT_SCORE_THRESHOLD}/100.`
          : `Analyzed ${itemsProcessed} of ${itemsFound} prospect(s); no signal reached the ${INTENT_SCORE_THRESHOLD}/100 intent threshold.`;

      await this.completeRun(runId, {
        outputSummary: summary,
        itemsFound,
        itemsProcessed,
        itemsQueued,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound,
        itemsProcessed,
        itemsQueued,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Donor intent monitoring run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound,
        itemsProcessed,
        itemsQueued,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
