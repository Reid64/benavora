// Corporate Foundations Research Agent.
//
// IMPORTANT — provenance note (read before trusting any "Agent 13/14 says X"
// claim about this file): the task this file was built from asserted that
// RESEARCH_AGENTS_TRUTH.md already contains a confirmed finding that "SEC
// EDGAR full-text search returned mostly unrelated director-bio mentions for
// corporate foundation names." That finding does NOT appear anywhere in
// RESEARCH_AGENTS_TRUTH.md (checked directly, this session) — the document
// covers Agents 12-21 and says nothing about EDGAR or corporate foundations.
// Rather than repeat an unverified citation, this session ran its own live
// smoke test against SEC EDGAR's full-text search API (efts.sec.gov) before
// writing corroborateWithEdgar() below. That live test (query: "Walmart
// Foundation") returned real hits, but every top hit was a Walmart Inc. DEF
// 14A proxy statement — the kind of filing that mentions a company
// foundation in a director's bio or a corporate-giving disclosure, not a
// dedicated filing that states a legal parent-subsidiary relationship. That
// observation is genuinely consistent with the task's description of EDGAR
// full-text search as noisy/mention-only, which is why corroborateWithEdgar()
// below is written to never do more than append a heavily-hedged, clearly
// labeled sentence — it is never the thing that decides whether an
// opportunity gets created (see the ProPublica-only branch below).
//
// What this file actually does: searches ProPublica for 990-PF grantmaking
// foundations (mirrors foundation-grants.ts's Agent 13 branch — NTEE major
// group 7, "Philanthropy, Voluntarism & Grantmaking Foundations"), narrows
// that list to foundations whose NAME reads as corporate-style (see
// classifyCorporateParentName below), and — for each survivor — verifies
// REAL recent grantmaking activity from the foundation's own IRS Form 990-PF
// filing via fetchLatestFilingGivingSignal, reused as-is from
// propublica-990-client.ts (built this week; not reimplemented here). Only
// ProPublica-sourced facts ever create or populate an opportunity record.
//
// SEC EDGAR full-text search is called only as optional corroboration,
// concurrently with the ProPublica giving-signal check for the same
// candidate (the "parallel source" in this file — mirrors Agent 13/14's
// pattern of running independent external data sources side by side, each
// bounded by its own timeout so a slow/down source can never block the
// other or the run's overall timeout). Unlike Agent 14's three dedicated-API
// branches (which each insert independently), EDGAR here can only ever
// annotate a record ProPublica already decided to create — it can never
// create, gate, or block one on its own (explicit non-goal: never present an
// EDGAR-only result as a real grant opportunity).
//
// After discovery, the same two real filtering stages Agent 13/14 use run
// before eligibility scoring: KB semantic relevance (kb-relevance.ts, fails
// open) and a Claude reflection pass (fails open). Contracts honored: every
// query is organization_id-scoped (§2); opportunities default to status
// 'open'; de-duplication (URL) runs before any insert (§17); the run logs to
// agent_runs with token usage via BaseAgent (§15); nothing is fabricated —
// every field written traces to what ProPublica's own filing data states,
// and the corporate-parent relationship itself is always presented as an
// unverified naming-pattern match, optionally corroborated but never
// confirmed (BEHAVIORAL_CONTRACTS §9).
//
// agentType note: this reuses the existing "foundation_research" AgentType
// (AGENTS.md Agent 13's own type, whose FOUNDATION_CATEGORIES already
// includes "corporate_foundation") rather than introducing a new AgentType
// string. A new value would require a matching Postgres `agent_type` enum
// migration (see project memory: "agent_type enum gap breaks some
// AutonomousAgents") — a live schema change this task did not ask for and
// this session did not apply. Treat this class as a specialized, narrower
// sibling of FoundationGrantsResearchAgent, not an independent registry
// entry; it shares that agent's per-profile "foundation research" toggle by
// design.
//
// timeoutMs is raised to 270s, mirroring Agent 13/14, leaving a 30s buffer
// under the 300s Vercel function ceiling.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import { EligibilityScorer } from "@/lib/agents/eligibility-scorer";
import { checkDuplicate } from "@/lib/agents/research/deduplicator";
import { resolveStateCode } from "@/lib/agents/research/foundation-grants";
import { buildKbScorer, buildOrgFocusText } from "@/lib/agents/research/kb-relevance";
import { fetchWithRetry } from "@/lib/agents/research/http-retry";
import {
  effectiveCategories,
  getActiveProfiles,
  getProfile,
  profileAgentEnabled,
  profileQueryTerms,
  type ResearchSearchProfile,
} from "@/lib/agents/research/scheduler";
import {
  searchOrganizations,
  ProPublicaError,
  type ProPublicaSearchOrg,
} from "@/lib/donor-discovery/adapters/propublica-adapter";
import { fetchLatestFilingGivingSignal } from "@/lib/sources/propublica-990-client";
import { inferSourceType } from "@/lib/opportunities/source-type";
import type { AgentType } from "@/types/agents";
import type { Enums, TablesInsert } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

/** This agent targets only the corporate-foundation slice of Agent 13's categories. */
export const CORPORATE_FOUNDATION_CATEGORIES: readonly FunderCategory[] = [
  "corporate_foundation",
];

export interface CorporateFoundationsInput {
  /**
   * Restrict the run to specific search profiles (e.g. a single "Run Now").
   * When omitted, every active profile carrying the corporate_foundation
   * category runs.
   */
  profileIds?: string[] | null;
}

export interface CorporateFoundationsResult {
  /** New opportunity rows actually created this run. */
  opportunitiesCreated: number;
  /** New funder rows created to back those opportunities. */
  fundersCreated: number;
  /** ProPublica candidates fetched and evaluated this run. */
  candidatesChecked: number;
  /** Candidates rejected by the corporate-name filter (never fetched from ProPublica's filing endpoint). */
  nameFiltered: number;
  /** Candidates whose EDGAR corroboration lookup found a plausibly matching SEC filer. */
  edgarCorroborated: number;
  /** New opportunities removed by KB semantic-relevance filtering. */
  kbFiltered: number;
  /** New opportunities removed by the Claude reflection pass. */
  reflectionFiltered: number;
  /** Set when the ProPublica search itself failed (not a per-candidate failure). */
  error?: string;
}

export interface CorporateFoundationsOptions extends BaseAgentOptions {
  /** Model override (resolved from platform_config `ai.model` by the caller). */
  model?: string;
  /** Max output tokens (platform_config `ai.max_tokens`). */
  maxTokens?: number;
}

/** ProPublica's NTEE major-group id for grantmaking foundations (mirrors foundation-grants.ts). */
const NTEE_GRANTMAKING_MAJOR_GROUP_ID = 7;
/** Candidate foundations fetched per run from ProPublica's search.json. */
const MAX_PROPUBLICA_CANDIDATES = 10;
/** New opportunities this run will create. */
const MAX_NEW_OPPS = 4;
/** A 990-PF filing is "recent" when its tax year is within this many years of today. */
const GIVING_FRESHNESS_YEARS = 5;
/** Delay between sequential ProPublica organization-detail fetches (courtesy rate limit). */
const PROPUBLICA_DETAIL_DELAY_MS = 350;
/** Below this KB-relevance score (0-100), a fresh discovery is removed. */
const KB_REJECT_THRESHOLD = 15;
/**
 * Whole-branch bound, well under this agent's own 270s timeoutMs, mirroring
 * Agent 13/14's BRANCH_TIMEOUT_MS so KB filtering + reflection + eligibility
 * scoring always have headroom left even if ProPublica/EDGAR are slow.
 */
const BRANCH_TIMEOUT_MS = 190_000;

// ── corporate-parent naming heuristic ───────────────────────────────────────
//
// A pure, exported, independently-testable heuristic. It answers "does this
// 990-PF filer's name read like a corporate-affiliated foundation?" — never
// "is this definitely a corporate subsidiary." Both call sites (the branch
// below and every test) must keep treating "strong"/"weak" as a candidate
// signal only; the opportunity description this agent writes always says so
// explicitly (see describeCandidate below) and never asserts a confirmed
// parent-company relationship (Contracts §9, task non-goal).
//
// Known, accepted false-positive risks (both confirmed live this session
// against real ProPublica data — see this file's test suite and the header
// provenance note above):
//   - A single-surname foundation with no legal-entity suffix (e.g. "Moody
//     Foundation", a real family foundation) is pattern-identical to a real
//     corporate foundation that also dropped its legal suffix from its
//     common name (e.g. "Wal-mart Foundation"). This is why that shape is
//     classified only "weak", not "strong".
//   - A plain nonprofit's own legal incorporation (virtually every 501(c)(3)
//     is itself "Inc") can be mistaken for corporate-parent evidence when the
//     name has no other disambiguating signal, e.g. "Northeast Arkansas
//     Clinic Char Foundation Inc" (a clinic's own charitable foundation, not
//     a corporate one) classifies "strong" here — a live-verified false
//     positive this session. The one sub-case this file DOES resolve is a
//     personal name explicitly joined by "&"/"and" plus a legal suffix (e.g.
//     "Willard And Pat Walker Charitable Foundation Inc") — see
//     PERSONAL_CONJUNCTION_PATTERN below.
// Name text alone cannot fully resolve either ambiguity; that is exactly why
// EDGAR corroboration exists as a second, independent (but still
// non-authoritative) signal rather than a fix for it, and why every
// opportunity description this agent writes says explicitly that the
// parent-company relationship is unverified, regardless of confidence tier.

export type CorporateNameConfidence = "strong" | "weak" | "none";

const FOUNDATION_SHAPE = /\b(foundation|charitable (fund|trust)|giving fund)\b/i;

/** Naming patterns that read as personal/family/community, not corporate. */
const NON_CORPORATE_MARKERS: readonly RegExp[] = [
  /\bfamily\b/i,
  /\bmemorial\b/i,
  /\bcommunity foundation\b/i,
  /\bcommunity fund\b/i,
  /\bscholarship\b/i,
  /\bsupporting foundation\b/i,
  /\bdonor advised\b/i,
];

/**
 * Two-or-more personal names explicitly joined by "&"/"and" directly before
 * "(charitable) foundation" (e.g. "Michael & Susan Dell Foundation", "Rob And
 * Melani Walton Foundation"). Requiring the conjunction (rather than just N
 * capitalized tokens) is deliberate: a generic multi-word institutional name
 * with no conjunction (e.g. "American Online Giving Foundation", a real
 * corporate foundation) must not be caught by this, or a real corporate name
 * would be silently excluded.
 */
const PERSONAL_CONJUNCTION_PATTERN =
  /^(the\s+)?[A-Z][a-zA-Z'.-]*(\s+[A-Z]\.?)?\s+(?:&|and)\s+[A-Z][a-zA-Z'.-]*(?:\s+[A-Z][a-zA-Z'.-]*){0,3}\s+(?:charitable\s+)?foundation$/i;

/** A trailing legal-entity suffix, stripped before the personal-conjunction check below. */
const LEGAL_SUFFIX_AT_END =
  /\s*,?\s*(inc\.?|incorporated|corp\.?|corporation|co\.?|company|llc|l\.l\.c\.?|ltd\.?|plc|holdings|enterprises)\.?\s*$/i;

/** A recognizable corporate legal-entity suffix, or the explicit word "corporate". */
const CORPORATE_LEGAL_SUFFIX =
  /\b(inc\.?|incorporated|corp\.?|corporation|co\.?|company|llc|l\.l\.c\.?|ltd\.?|plc|holdings|enterprises)\b/i;
const CORPORATE_KEYWORD = /\bcorporate\b/i;

/** A single brand-style token immediately before "Foundation" (weak signal only — see header note). */
const BRAND_LIKE_SINGLE_TOKEN = /^(the\s+)?[A-Z][a-zA-Z&.-]{1,24}\s+Foundation$/;

/**
 * Classifies a ProPublica organization name's corporate-parent naming
 * pattern. "none" means the name does not even read as foundation-shaped, or
 * matches a personal/family/community pattern this agent deliberately
 * excludes. "strong" means an explicit legal-entity suffix or the word
 * "corporate" is present. "weak" means only a bare brand-like token before
 * "Foundation" matched — plausible, unconfirmed, see the header note above.
 */
export function classifyCorporateParentName(rawName: string): CorporateNameConfidence {
  const name = rawName.trim();
  if (name === "" || !FOUNDATION_SHAPE.test(name)) return "none";
  if (NON_CORPORATE_MARKERS.some((re) => re.test(name))) return "none";
  // An explicit legal-entity suffix or the word "corporate" is a more
  // specific signal than the generic personal-name shape below, and must win
  // even when it also happens to match that shape (e.g. "Acme Corporate
  // Foundation" is exactly 2 capitalized tokens before "Foundation", the
  // same shape as "John Smith Foundation" - the explicit corporate marker
  // disambiguates it). Checking this first, not after, is the fix.
  if (CORPORATE_KEYWORD.test(name)) return "strong";

  // Two-or-more personal names joined by "&"/"and" right before "Foundation"
  // is a strong signal of a personal/family foundation even when the entity
  // also carries a legal suffix (see the false-positive note above) — checked
  // against the name with any trailing legal suffix stripped, so "Willard And
  // Pat Walker Charitable Foundation Inc" (real ProPublica record,
  // live-verified this session) is still caught.
  const withoutTrailingLegalSuffix = name.replace(LEGAL_SUFFIX_AT_END, "").trim();
  if (PERSONAL_CONJUNCTION_PATTERN.test(withoutTrailingLegalSuffix)) return "none";

  if (CORPORATE_LEGAL_SUFFIX.test(name)) return "strong";
  if (BRAND_LIKE_SINGLE_TOKEN.test(name)) return "weak";
  return "none";
}

/** True for any non-"none" classification — the branch's actual candidate gate. */
export function isCorporateParentCandidate(rawName: string): boolean {
  return classifyCorporateParentName(rawName) !== "none";
}

// ── SEC EDGAR corroboration (thin, optional, never authoritative) ──────────

export interface EdgarCorroboration {
  /** False when no usable query term could be derived from the foundation name (nothing was fetched). */
  attempted: boolean;
  /** True only when EDGAR returned at least one hit with a company display name. */
  matched: boolean;
  queryTerm: string | null;
  companyDisplayName: string | null;
  cik: string | null;
  hitCount: number;
  /** Set on any HTTP/network/parse failure — corroboration is optional, so this never throws. */
  error?: string;
}

const EDGAR_FULLTEXT_SEARCH_URL = "https://efts.sec.gov/LATEST/search-index";
/** SEC's developer FAQ asks for a descriptive User-Agent with contact info. */
const EDGAR_USER_AGENT = "Benavora Grant Research Bot research@benavora.com";
const EDGAR_TIMEOUT_MS = 8_000;

const FOUNDATION_SUFFIX_STRIP: readonly RegExp[] = [
  /\bcorporate\s+foundation\b/i,
  /\bcharitable\s+foundation\b/i,
  /\bfamily\s+foundation\b/i,
  /\bfoundation\b/i,
  /\bcharitable\s+trust\b/i,
  /\bcharitable\s+fund\b/i,
  /\bgiving\s+fund\b/i,
];
const LEGAL_SUFFIX_STRIP = /\b(inc\.?|incorporated|corp\.?|corporation|co\.?|company|llc|l\.l\.c\.?|ltd\.?)\s*$/i;

/**
 * Strips foundation/charitable and legal-entity suffixes to guess the
 * candidate parent company's name, e.g. "Wal-mart Foundation" -> "Wal-mart".
 * Returns null when nothing meaningful remains. Best-effort by construction —
 * a foundation's common name frequently differs from its legal parent's
 * registered name (spacing, hyphenation, abbreviation), so a miss here does
 * not mean no real parent exists, only that this thin lookup can't find it.
 */
export function deriveParentCompanyCandidate(foundationName: string): string | null {
  let name = foundationName.trim().replace(/^the\s+/i, "");
  for (const re of FOUNDATION_SUFFIX_STRIP) name = name.replace(re, " ");
  name = name.replace(LEGAL_SUFFIX_STRIP, "");
  name = name.replace(/[\s,-]+$/, "").trim();
  return name.length >= 3 ? name : null;
}

/**
 * Optional, non-authoritative corroboration: checks whether a company with a
 * similar name to the candidate's derived parent has any SEC EDGAR
 * full-text-search hits. Never throws — any failure (network, timeout, bad
 * JSON) resolves to `matched: false` so the caller's ProPublica-sourced
 * insert is never blocked or altered by this lookup (task non-goal: EDGAR
 * must never produce or feed an opportunity record on its own).
 */
export async function corroborateWithEdgar(
  foundationName: string,
): Promise<EdgarCorroboration> {
  const queryTerm = deriveParentCompanyCandidate(foundationName);
  if (!queryTerm) {
    return {
      attempted: false,
      matched: false,
      queryTerm: null,
      companyDisplayName: null,
      cik: null,
      hitCount: 0,
    };
  }

  const url = `${EDGAR_FULLTEXT_SEARCH_URL}?q=${encodeURIComponent(`"${queryTerm}"`)}`;

  try {
    const response = await fetchWithRetry(
      () =>
        fetch(url, {
          headers: { "User-Agent": EDGAR_USER_AGENT },
          signal: AbortSignal.timeout(EDGAR_TIMEOUT_MS),
        }),
      { attempts: 2, baseDelayMs: 400, maxDelayMs: 2000 },
    );

    if (!response.ok) {
      return {
        attempted: true,
        matched: false,
        queryTerm,
        companyDisplayName: null,
        cik: null,
        hitCount: 0,
        error: `EDGAR full-text search HTTP ${response.status}`,
      };
    }

    const body = (await response.json()) as {
      hits?: {
        total?: { value?: number };
        hits?: Array<{ _source?: { display_names?: string[]; ciks?: string[] } }>;
      };
    };
    const hitCount = body.hits?.total?.value ?? 0;
    const top = body.hits?.hits?.[0]?._source;
    const companyDisplayName = top?.display_names?.[0] ?? null;
    const cik = top?.ciks?.[0] ?? null;

    return {
      attempted: true,
      matched: hitCount > 0 && companyDisplayName != null,
      queryTerm,
      companyDisplayName,
      cik,
      hitCount,
    };
  } catch (err) {
    return {
      attempted: true,
      matched: false,
      queryTerm,
      companyDisplayName: null,
      cik: null,
      hitCount: 0,
      error: err instanceof Error ? err.message : "EDGAR corroboration failed.",
    };
  }
}

/**
 * A heavily-hedged sentence appended to the opportunity description only
 * when EDGAR actually matched. Deliberately states what the match does NOT
 * prove — full-text search surfaces any filing mentioning the term (often a
 * director's bio or a corporate-giving disclosure), not a stated legal
 * parent-subsidiary relationship (see this file's header note; task
 * non-goal: never present this as a confirmed corporate-parent relationship).
 */
export function edgarCorroborationNote(result: EdgarCorroboration): string | null {
  if (!result.matched || !result.companyDisplayName || !result.queryTerm) return null;
  return (
    `SEC EDGAR corroboration (non-authoritative, name-mention only): a filer named ` +
    `"${result.companyDisplayName}"${result.cik ? ` (CIK ${result.cik})` : ""} appears in ` +
    `${result.hitCount} SEC full-text search hit(s) for "${result.queryTerm}". This confirms only ` +
    `that a similarly-named company files with the SEC — it does not confirm this foundation is that ` +
    `company's affiliated foundation, and EDGAR full-text search commonly surfaces incidental mentions ` +
    `rather than a stated corporate-parent relationship.`
  );
}

// ── the agent ────────────────────────────────────────────────────────────────

export class CorporateFoundationsResearchAgent extends BaseAgent<
  CorporateFoundationsInput,
  CorporateFoundationsResult
> {
  // Reuses Agent 13's existing AgentType — see header note on why this file
  // does not introduce a new one.
  readonly agentType: AgentType = "foundation_research";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: CorporateFoundationsOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? 270_000 });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: CorporateFoundationsInput,
  ): Promise<AgentExecution<CorporateFoundationsResult>> {
    const profiles = await this.resolveProfiles(input.profileIds ?? null);

    if (profiles.length === 0) {
      return {
        data: {
          opportunitiesCreated: 0,
          fundersCreated: 0,
          candidatesChecked: 0,
          nameFiltered: 0,
          edgarCorroborated: 0,
          kbFiltered: 0,
          reflectionFiltered: 0,
        },
        outputSummary:
          "No active search profiles target corporate foundations; nothing to research.",
        itemsFound: 0,
        itemsProcessed: 0,
        tokensUsed: 0,
      };
    }

    const branch = await withBranchTimeout(this.runBranch(profiles), BRANCH_TIMEOUT_MS, {
      newOpportunityIds: [] as string[],
      fundersCreated: 0,
      candidatesChecked: 0,
      nameFiltered: 0,
      edgarCorroborated: 0,
      error: "branch timed out" as string | undefined,
    });

    const afterKb = await this.applyKbFilter(branch.newOpportunityIds);
    const afterReflection = await this.applyReflectionFilter(afterKb.kept);

    for (const opportunityId of afterReflection.kept) {
      try {
        const scorer = new EligibilityScorer({
          client: this.client,
          organizationId: this.organizationId,
          triggeredBy: this.triggeredBy,
          model: this.model,
          maxTokens: this.maxTokens,
        });
        await scorer.run({ opportunityId });
      } catch (err) {
        console.error(
          `[corporate-foundations] eligibility scoring failed for ${opportunityId}:`,
          err,
        );
      }
    }

    const opportunitiesCreated =
      branch.newOpportunityIds.length - afterKb.removed.length - afterReflection.removed.length;

    const summary =
      `Corporate foundations research: checked ${branch.candidatesChecked} ProPublica 990-PF ` +
      `candidate(s) (${branch.nameFiltered} rejected by the corporate-name filter before any ` +
      `filing fetch), ${branch.edgarCorroborated} EDGAR-corroborated. ` +
      `${afterKb.removed.length} removed by KB relevance, ${afterReflection.removed.length} removed ` +
      `by reflection. ${Math.max(0, opportunitiesCreated)} new opportunit${opportunitiesCreated === 1 ? "y" : "ies"} ` +
      `and ${branch.fundersCreated} new funder(s) survived.` +
      (branch.error ? ` Branch error: ${branch.error}.` : "");

    return {
      data: {
        opportunitiesCreated: Math.max(0, opportunitiesCreated),
        fundersCreated: branch.fundersCreated,
        candidatesChecked: branch.candidatesChecked,
        nameFiltered: branch.nameFiltered,
        edgarCorroborated: branch.edgarCorroborated,
        kbFiltered: afterKb.removed.length,
        reflectionFiltered: afterReflection.removed.length,
        error: branch.error,
      },
      outputSummary: summary,
      itemsFound: branch.newOpportunityIds.length,
      itemsProcessed: Math.max(0, opportunitiesCreated),
      tokensUsed: 0,
    };
  }

  // --- the ProPublica branch (with EDGAR run in parallel per candidate) -------

  private async runBranch(profiles: ResearchSearchProfile[]): Promise<{
    newOpportunityIds: string[];
    fundersCreated: number;
    candidatesChecked: number;
    nameFiltered: number;
    edgarCorroborated: number;
    error?: string;
  }> {
    const stateCode = resolveStateCode(profiles);

    let candidates: ProPublicaSearchOrg[];
    try {
      candidates = await searchOrganizations({
        state: stateCode,
        nteeId: NTEE_GRANTMAKING_MAJOR_GROUP_ID,
      });
    } catch (err) {
      const message =
        err instanceof ProPublicaError || err instanceof Error
          ? err.message
          : "ProPublica search failed.";
      console.error("[corporate-foundations] ProPublica search failed:", err);
      return {
        newOpportunityIds: [],
        fundersCreated: 0,
        candidatesChecked: 0,
        nameFiltered: 0,
        edgarCorroborated: 0,
        error: message,
      };
    }

    const nameFiltered = candidates.filter(
      (org) => !isCorporateParentCandidate(org.name),
    ).length;
    const shortlist = candidates
      .filter((org) => isCorporateParentCandidate(org.name))
      .slice(0, MAX_PROPUBLICA_CANDIDATES);

    const keywords = Array.from(new Set(profiles.flatMap((p) => p.keywords)));
    const newOpportunityIds: string[] = [];
    let created = 0;
    let fundersCreated = 0;
    let checked = 0;
    let edgarCorroborated = 0;
    const currentYear = new Date().getFullYear();

    for (const org of shortlist) {
      if (created >= MAX_NEW_OPPS) break;
      checked++;

      const profileUrl = `https://projects.propublica.org/nonprofits/organizations/${org.ein}`;

      const dup = await checkDuplicate({
        client: this.client,
        organizationId: this.organizationId,
        url: profileUrl,
        name: org.name,
      });
      if (dup.isDuplicate) continue;

      if (checked > 1) await delay(PROPUBLICA_DETAIL_DELAY_MS);

      // Parallel sources for this one candidate: ProPublica's own filing
      // (authoritative, decides whether/what to insert) and EDGAR
      // corroboration (optional, annotation-only). Neither blocks the other.
      const [signal, edgar] = await Promise.all([
        fetchLatestFilingGivingSignal(org.ein),
        corroborateWithEdgar(org.name),
      ]);

      if (edgar.matched) edgarCorroborated++;

      // No ProPublica filing data, or the fetch failed - skip rather than
      // assume/fabricate a giving amount (Contracts §9).
      if (!signal || signal.taxYear == null) continue;

      const isRecent = signal.taxYear >= currentYear - GIVING_FRESHNESS_YEARS;
      const givingAmount = signal.contributionsPaidPerBooks ?? signal.qualifyingDistributions;
      if (!isRecent || givingAmount == null || givingAmount <= 0) continue;

      const category: FunderCategory = "corporate_foundation";
      const { funderId, created: funderCreated } = await this.resolveFunder(
        org.name,
        category,
        profileUrl,
      );
      if (funderCreated) fundersCreated++;

      const confidence = classifyCorporateParentName(org.name);
      const location = [org.city, org.state].filter(Boolean).join(", ");
      const edgarNote = edgarCorroborationNote(edgar);

      const description =
        `ProPublica lists "${org.name}" (EIN ${org.ein}) as a private foundation with a ` +
        `${confidence === "strong" ? "corporate/legal-entity-style" : "brand-like"} name pattern; ` +
        `Benavora has not independently verified a parent-company relationship. ` +
        `IRS Form 990-PF filing for tax year ${signal.taxYear} reports ` +
        `$${givingAmount.toLocaleString()} in contributions/grants paid` +
        (signal.totalFunctionalExpenses != null
          ? `; total functional expenses $${signal.totalFunctionalExpenses.toLocaleString()}`
          : "") +
        `${location ? `, headquartered in ${location}` : ""}. ` +
        `Source: ProPublica Nonprofit Explorer (public IRS filing data).` +
        (edgarNote ? ` ${edgarNote}` : "");

      const { data: inserted, error: insertError } = await this.client
        .from("opportunities")
        .insert({
          organization_id: this.organizationId,
          funder_id: funderId,
          name: org.name,
          category,
          description,
          amount_min: null,
          amount_max: null,
          deadline: null,
          url: profileUrl,
          // ProPublica states no application process for this funder -
          // leaving these null is the honest answer, not a gap to fill in.
          eligibility_requirements: null,
          required_documents: null,
          application_method: null,
          recurrence: null,
          geographic_restrictions: location || null,
          status: "open",
          source: "propublica_990pf_corporate",
          source_type: inferSourceType({
            category,
            name: org.name,
            funderName: org.name,
            geographicScope: org.state,
            extraText: "IRS Form 990-PF corporate-style foundation",
          }),
        } satisfies TablesInsert<"opportunities">)
        .select("id")
        .single();

      if (insertError || !inserted?.id) {
        console.error("[corporate-foundations] opportunity insert failed:", insertError);
        continue;
      }

      created++;
      const opportunityId = inserted.id as string;
      newOpportunityIds.push(opportunityId);
      await this.createKeywords(opportunityId, keywords);
    }

    return {
      newOpportunityIds,
      fundersCreated,
      candidatesChecked: checked,
      nameFiltered,
      edgarCorroborated,
    };
  }

  // --- post-discovery filtering (verbatim pattern from Agent 13/14) ----------

  private async applyKbFilter(
    ids: string[],
  ): Promise<{ kept: string[]; removed: string[] }> {
    if (ids.length === 0) return { kept: [], removed: [] };

    const scorer = await buildKbScorer({
      client: this.client,
      organizationId: this.organizationId,
    });
    if (!scorer) return { kept: ids, removed: [] };

    const { data, error } = await this.client
      .from("opportunities")
      .select("id, name, description")
      .in("id", ids);
    if (error || !data) {
      console.error("[corporate-foundations:kb-filter] lookup failed:", error);
      return { kept: ids, removed: [] };
    }

    const kept: string[] = [];
    const removed: string[] = [];
    for (const row of data as Array<{ id: string; name: string; description: string | null }>) {
      const score = await scorer.score(`${row.name} ${row.description ?? ""}`);
      if (score < KB_REJECT_THRESHOLD) {
        removed.push(row.id);
      } else {
        kept.push(row.id);
      }
    }

    if (removed.length > 0) {
      await this.deleteOpportunities(removed, "kb-filter");
    }
    return { kept, removed };
  }

  private async applyReflectionFilter(
    ids: string[],
  ): Promise<{ kept: string[]; removed: string[] }> {
    if (ids.length === 0) return { kept: [], removed: [] };

    const { data, error } = await this.client
      .from("opportunities")
      .select("id, name, description, category")
      .in("id", ids);
    if (error || !data || data.length === 0) {
      return { kept: ids, removed: [] };
    }
    const candidates = data as Array<{
      id: string;
      name: string;
      description: string | null;
      category: string;
    }>;

    const focusText = await buildOrgFocusText({
      client: this.client,
      organizationId: this.organizationId,
    });
    if (!focusText) return { kept: ids, removed: [] };

    const listing = candidates
      .map(
        (c, i) =>
          `${i + 1}. id=${c.id} category=${c.category} name="${c.name}"\n   description: ${(c.description ?? "none").slice(0, 300)}`,
      )
      .join("\n");

    const prompt = `An organization's real configured mission/focus (from its own search profiles and knowledge base): ${focusText}

Below is a shortlist of grant opportunities a research agent just discovered for this organization. For each one, judge whether it is plausibly relevant to this organization's actual mission, or whether it is a clear domain mismatch (e.g. the org serves housing/reentry/recovery populations but the opportunity is for unrelated STEM research, defense contracting, agriculture, etc.).

Opportunities:
${listing}

Return ONLY a JSON array, one entry per opportunity, in this exact shape:
[{"id": "<id>", "keep": true|false, "reason": "<one short sentence>"}]

Only mark keep:false for a CLEAR mismatch. When genuinely uncertain, keep:true - never discard a plausible discovery on a guess.`;

    let text: string;
    try {
      const result = await callClaude({ prompt, maxTokens: 1024, temperature: 0 });
      text = result.text;
    } catch (err) {
      console.error("[corporate-foundations:reflection] Claude call failed:", err);
      return { kept: ids, removed: [] };
    }

    let judged: Array<{ id?: unknown; keep?: unknown; reason?: unknown }>;
    try {
      const clean = text
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      const parsed: unknown = JSON.parse(clean);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      judged = parsed;
    } catch (err) {
      console.error("[corporate-foundations:reflection] malformed response:", err);
      return { kept: ids, removed: [] };
    }

    const rejectIds = new Set(
      judged
        .filter((j) => typeof j.id === "string" && j.keep === false)
        .map((j) => j.id as string),
    );

    const kept = ids.filter((id) => !rejectIds.has(id));
    const removed = ids.filter((id) => rejectIds.has(id));
    if (removed.length > 0) {
      for (const id of removed) {
        const reason = judged.find((j) => j.id === id)?.reason;
        console.log(`[corporate-foundations:reflection] removed ${id}: ${String(reason ?? "no reason given")}`);
      }
      await this.deleteOpportunities(removed, "reflection");
    }
    return { kept, removed };
  }

  private async deleteOpportunities(ids: string[], stage: string): Promise<void> {
    const { error } = await this.client
      .from("opportunities")
      .delete()
      .eq("organization_id", this.organizationId)
      .in("id", ids);
    if (error) {
      console.error(`[corporate-foundations:${stage}] delete failed (kept in DB):`, error);
    }
  }

  // --- profile selection -----------------------------------------------------

  private async resolveProfiles(
    profileIds: string[] | null,
  ): Promise<ResearchSearchProfile[]> {
    if (profileIds && profileIds.length > 0) {
      const loaded = await Promise.all(
        profileIds.map((id) =>
          getProfile({ client: this.client, organizationId: this.organizationId }, id),
        ),
      );
      return loaded.filter(
        (p): p is ResearchSearchProfile => p != null && p.isActive,
      );
    }

    const active = await getActiveProfiles({
      client: this.client,
      organizationId: this.organizationId,
    });
    return active.filter(
      (p) => isCorporateFoundationProfile(p) && profileAgentEnabled(p, this.agentType),
    );
  }

  // --- writes -----------------------------------------------------------------

  private async resolveFunder(
    funderName: string | null,
    category: FunderCategory,
    sourceUrl: string,
  ): Promise<{ funderId: string | null; created: boolean }> {
    const name = (funderName ?? "").trim();
    if (name === "") return { funderId: null, created: false };

    try {
      const { data: existing } = await this.client
        .from("funders")
        .select("id")
        .eq("organization_id", this.organizationId)
        .ilike("name", name)
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        return { funderId: existing.id as string, created: false };
      }
    } catch (err) {
      console.error("[corporate-foundations] funder lookup failed:", err);
    }

    const { data: created, error } = await this.client
      .from("funders")
      .insert({
        organization_id: this.organizationId,
        name,
        category,
        website: originOf(sourceUrl),
        notes: "Discovered by the Corporate Foundations Research agent.",
      } satisfies TablesInsert<"funders">)
      .select("id")
      .single();

    if (error || !created?.id) {
      console.error("[corporate-foundations] funder insert failed:", error);
      return { funderId: null, created: false };
    }
    return { funderId: created.id as string, created: true };
  }

  private async createKeywords(
    opportunityId: string,
    keywords: string[],
  ): Promise<void> {
    const unique = Array.from(
      new Set(keywords.map((k) => k.trim()).filter((k) => k !== "")),
    );
    if (unique.length === 0) return;

    const rows: TablesInsert<"opportunity_keywords">[] = unique.map((keyword) => ({
      organization_id: this.organizationId,
      opportunity_id: opportunityId,
      keyword,
    }));

    const { error } = await this.client.from("opportunity_keywords").insert(rows);
    if (error) {
      console.error("[corporate-foundations] keyword insert failed:", error);
    }
  }
}

// --- helpers -----------------------------------------------------------------

function isCorporateFoundationProfile(profile: ResearchSearchProfile): boolean {
  return effectiveCategories(profile).some((c) =>
    CORPORATE_FOUNDATION_CATEGORIES.includes(c),
  );
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Races `work` against a `ms` timer, resolving with `fallback` if the timer
 * wins (mirrors foundation-grants.ts/government-grants.ts's
 * withBranchTimeout). The slow branch's own work keeps running in the
 * background; any rows it eventually inserts are picked up by the next run.
 */
function withBranchTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
