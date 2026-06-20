// Grants.gov Research Agent — AGENTS.md Agent 15.
//
// Polls the public Grants.gov API (no auth required) for federal grant
// opportunities matching search profile keywords (BEHAVIORAL_CONTRACTS §17).
//
// Per-run behaviour:
//   1. Runs multiple keyword searches (housing-focused phrases + any caller-
//      supplied keywords) to maximise coverage — typically 150+ results vs
//      the old single-query 25.
//   2. Deduplicates by oppNumber in memory across all searches before touching
//      the database.
//   3. Parses synopsis.awardCeiling/Floor and synopsis.closeDate (MMDDYYYY)
//      from the nested synopsis object where the API actually puts them.
//   4. Deduplicates against existing opportunities by name OR url before
//      inserting new records into the opportunities table.
//   5. Returns the full list of discovered opportunities and a count of newly
//      created rows so callers can poll without fetching the whole table.
//
// Error handling: per-query HTTP failures are skipped (non-fatal). A total
// fetch failure wraps in AgentError so BaseAgent can log status="failed".

import { callClaude } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const GRANTS_GOV_URL =
  "https://apply07.grants.gov/grantsws/rest/opportunities/search/";

// Second pass: the per-opportunity detail endpoint returns a fuller object than
// the listing (full description, eligibility, geographic scope, documents).
const GRANTS_GOV_DETAIL_URL =
  "https://apply07.grants.gov/grantsws/rest/opportunity/details";
// Cap detail fetches per run. A wall-clock budget also stops the pass early so
// the agent stays within BaseAgent's hard run timeout even if a fetch is slow.
const MAX_DETAIL_FETCHES = 50;
const DETAIL_DELAY_MS = 500;
// Wall-clock budgets measured from run start, kept under the agent's 270s
// timeout: discovery detail fetching first, then a backfill pass that enriches
// existing sparse rows (resolve opp-number -> numeric id -> detail).
const DISCOVERY_BUDGET_MS = 120_000;
const BACKFILL_BUDGET_MS = 220_000;
const MAX_BACKFILL = 50;

// Focused keyword phrases for Faith Foundation: emergency/transitional housing
// in rural Texas, reentry, addiction recovery, and federal housing programs.
const HOUSING_KEYWORD_QUERIES = [
  "homeless housing",
  "transitional housing",
  "emergency shelter",
  "reentry housing",
  "recovery housing",
  "rural housing",
  "community development block grant",
  "HOME Investment Partnership",
  "Emergency Solutions Grant",
  "Continuum of Care",
  "faith-based community",
  "substance abuse recovery housing",
];

export interface GrantsGovInput {
  keywords: string[];
  categories?: string[];
  dateRange?: { from?: string; to?: string };
}

export interface OpportunityDocument {
  title: string;
  url: string;
}

export interface GrantsGovOpportunity {
  title: string;
  agency: string;
  opportunity_number: string;
  close_date: string | null;
  award_ceiling: number | null;
  award_floor: number | null;
  description: string | null;
  eligibility_requirements: string | null;
  geographic_restrictions: string | null;
  opportunity_documents: OpportunityDocument[];
  url: string | null;
  source: "grants.gov";
}

export interface GrantsGovResult {
  opportunities: GrantsGovOpportunity[];
  count: number;
  opportunitiesCreated: number;
  /** Existing sparse rows enriched by the backfill pass this run. */
  backfilledRows: number;
}

// The API nests financial and date fields inside synopsis.
interface RawSynopsis {
  awardCeiling?: unknown;
  awardFloor?: unknown;
  closeDate?: unknown;
  postDate?: unknown;
  archiveDate?: unknown;
  description?: unknown;
}

interface RawHit {
  title?: unknown;
  id?: unknown;
  agency?: unknown;
  agencyName?: unknown;
  number?: unknown;
  oppNumber?: unknown;
  synopsis?: RawSynopsis;
  description?: unknown;
  // Search listings carry the close date at the top level (no synopsis object).
  closeDate?: unknown;
}

interface GrantsGovResponse {
  oppHits?: RawHit[];
  opportunities?: RawHit[];
  items?: RawHit[];
}

// Shape of the per-opportunity detail response (verified against the live API).
// The fuller fields live under `synopsis`; the listing has none of these.
interface RawDetailSynopsis {
  synopsisDesc?: unknown;
  applicantEligibilityDesc?: unknown;
  awardCeiling?: unknown;
  awardFloor?: unknown;
  responseDate?: unknown;
  responseDateStr?: unknown;
  costSharing?: unknown;
}

interface RawDetailAttachment {
  id?: unknown;
  fileName?: unknown;
  fileDescription?: unknown;
}

interface RawDetailFolder {
  synopsisAttachments?: RawDetailAttachment[];
}

interface RawDetail {
  synopsis?: RawDetailSynopsis;
  // PDFs live in nested attachment folders, not a flat documents[] array.
  synopsisAttachmentFolders?: RawDetailFolder[];
}

/** Parse the detail responseDateStr ("YYYY-MM-DD-HH-MM-SS") or responseDate. */
function normaliseDetailDate(val: unknown): string | null {
  const raw = toStr(val);
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

/** Merged values from the detail endpoint, used to enrich the listing data. */
interface DetailData {
  description: string | null;
  eligibility: string | null;
  geographic: string | null;
  awardCeiling: number | null;
  awardFloor: number | null;
  closeDate: string | null;
  documents: OpportunityDocument[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse "MM/DD/YYYY" or compact "MMDDYYYY" dates to ISO-8601 (YYYY-MM-DD).
// The Grants.gov synopsis.closeDate field uses the compact 8-digit form.
function parseMDYDate(raw: string): string | null {
  const trimmed = raw.trim();

  // "MM/DD/YYYY" with slashes
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slash) {
    const month = slash[1] ?? "01";
    const day = slash[2] ?? "01";
    const year = slash[3] ?? "1970";
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // "MMDDYYYY" compact (Grants.gov synopsis.closeDate)
  const compact = /^(\d{2})(\d{2})(\d{4})$/.exec(trimmed);
  if (compact) {
    const month = compact[1] ?? "01";
    const day = compact[2] ?? "01";
    const year = compact[3] ?? "1970";
    return `${year}-${month}-${day}`;
  }

  return null;
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function toNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

// Convert 0 or non-positive amounts to null (0 means "not specified").
function toPositiveNumber(val: unknown): number | null {
  const n = toNumber(val);
  return n !== null && n > 0 ? n : null;
}

function truncate(val: unknown, maxLen: number): string | null {
  const s = toStr(val);
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normaliseCloseDate(val: unknown): string | null {
  const raw = toStr(val);
  if (!raw) return null;
  const mdy = parseMDYDate(raw);
  if (mdy) return mdy;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

function extractHits(body: GrantsGovResponse): RawHit[] {
  if (Array.isArray(body.oppHits)) return body.oppHits;
  if (Array.isArray(body.opportunities)) return body.opportunities;
  if (Array.isArray(body.items)) return body.items;
  return [];
}

function isHudAgency(agencyName: string): boolean {
  const lower = agencyName.toLowerCase();
  return lower.includes("hud") || lower.includes("housing and urban development");
}

function hitKey(hit: RawHit): string {
  const oppNum = toStr(hit.oppNumber ?? hit.number);
  if (oppNum) return `num:${oppNum}`;
  const title = toStr(hit.title);
  return title ? `title:${title}` : "";
}

/** Pull the opportunity number out of a stored search-grants url (?opp=...). */
function extractOppNumber(url: string | null): string {
  if (!url) return "";
  const m = /[?&]opp=([^&]+)/.exec(url);
  return m && m[1] ? decodeURIComponent(m[1]) : "";
}

// Keywords that increase relevance score for Faith Foundation's mission.
const RELEVANCE_KEYWORDS = [
  "housing",
  "homeless",
  "shelter",
  "reentry",
  "recovery",
  "rural",
  "community development",
  "faith",
  "texas",
  "nonprofit",
];

// Titles/descriptions matching any of these terms are immediately rejected.
const REJECT_LIST = [
  "disability",
  "veteran education",
  "criminal alien",
  "stem",
  "defense",
  "agriculture",
  "farmers",
  "fisheries",
  "nih",
  "cdc",
  "nasa",
  "dod research",
  "clinical trial",
];

/**
 * Score an opportunity 0–100 based on keyword overlap with Faith Foundation's
 * mission. Returns { score, rejected } — rejected is the first REJECT_LIST term
 * found in the text (non-null means the opportunity must be discarded).
 */
function scoreRelevance(
  title: string,
  description: string | null,
): { score: number; rejected: string | null } {
  const text = `${title} ${description ?? ""}`.toLowerCase();

  for (const term of REJECT_LIST) {
    if (text.includes(term)) {
      return { score: 0, rejected: term };
    }
  }

  let score = 0;
  for (const kw of RELEVANCE_KEYWORDS) {
    if (text.includes(kw)) score += 10;
  }
  return { score: Math.min(score, 100), rejected: null };
}

export class GrantsGovResearchAgent extends BaseAgent<
  GrantsGovInput,
  GrantsGovResult
> {
  readonly agentType: AgentType = "grants_gov_research";

  constructor(options: BaseAgentOptions) {
    // The two-pass detail fetch needs far more than the 60s default. Cap at 270s
    // to leave a 30s buffer under the 300s Vercel function limit.
    super({ ...options, timeoutMs: options.timeoutMs ?? 270_000 });
  }

  protected async execute(
    input: GrantsGovInput,
  ): Promise<AgentExecution<GrantsGovResult>> {
    const runStart = Date.now();

    // Build query list: always run all housing-focused phrases; append the
    // caller's keywords as one extra search if they differ from the defaults.
    const userQuery = input.keywords.filter(Boolean).join(" ").trim();
    const queries: string[] = [...HOUSING_KEYWORD_QUERIES];
    if (
      userQuery &&
      !HOUSING_KEYWORD_QUERIES.some((q) =>
        q.toLowerCase().includes(userQuery.toLowerCase()),
      )
    ) {
      queries.push(userQuery);
    }

    // Require at least one query.
    const effectiveQueries = queries.filter(Boolean);
    if (effectiveQueries.length === 0) {
      throw new AgentError(
        "At least one keyword is required.",
        "no_keywords",
        400,
      );
    }

    // Run each query and collect hits, deduplicating by oppNumber in memory.
    const allHitsMap = new Map<string, RawHit>();

    for (const keyword of effectiveQueries) {
      const requestBody: Record<string, unknown> = {
        keyword,
        oppStatuses: "forecasted|posted",
        rows: 25,
        startRecordNum: 0,
      };

      if (input.categories?.length) {
        requestBody.fundingCategories = input.categories.join("|");
      }
      if (input.dateRange?.from) {
        requestBody.postDateFrom = input.dateRange.from;
      }
      if (input.dateRange?.to) {
        requestBody.postDateTo = input.dateRange.to;
      }

      try {
        const response = await fetch(GRANTS_GOV_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) continue;

        const rawBody = (await response.json()) as GrantsGovResponse;
        for (const hit of extractHits(rawBody)) {
          const key = hitKey(hit);
          if (key && !allHitsMap.has(key)) {
            allHitsMap.set(key, hit);
          }
        }
      } catch {
        // Non-fatal: skip this keyword on network/parse errors.
      }
    }

    // Second pass: enrich each unique hit with the fuller detail object before
    // inserting. Rate-limited (500ms between fetches), capped at 50 fetches and
    // a wall-clock budget so the agent stays within its run timeout.
    const uniqueHits = Array.from(allHitsMap.values());
    const opportunities: GrantsGovOpportunity[] = [];
    let detailFetches = 0;

    for (const hit of uniqueHits) {
      const synopsis: RawSynopsis = hit.synopsis ?? {};
      const oppNum = toStr(hit.oppNumber ?? hit.number);
      const hitId = toStr(hit.id);
      const urlId = oppNum || hitId;

      // Listing-derived values (the fallback when no detail is fetched).
      let description = truncate(synopsis.description ?? hit.description, 2000);
      let awardCeiling = toPositiveNumber(synopsis.awardCeiling);
      let awardFloor = toPositiveNumber(synopsis.awardFloor);
      // Listings have no synopsis; the close date is a top-level field.
      let closeDate =
        normaliseCloseDate(synopsis.closeDate) ??
        normaliseDetailDate(hit.closeDate);
      let eligibility: string | null = null;
      let geographic: string | null = null;
      let documents: OpportunityDocument[] = [];

      const withinBudget =
        detailFetches < MAX_DETAIL_FETCHES &&
        Date.now() - runStart < DISCOVERY_BUDGET_MS;

      if (hitId && withinBudget) {
        const detail = await this.fetchDetail(hitId);
        detailFetches++;
        if (detail) {
          // Use the detail description if it is longer than the listing one.
          if (
            detail.description &&
            (!description || detail.description.length > description.length)
          ) {
            description = truncate(detail.description, 4000);
          }
          // Use detail amounts when the listing did not specify them (0/null).
          if (awardCeiling === null && detail.awardCeiling !== null) {
            awardCeiling = detail.awardCeiling;
          }
          if (awardFloor === null && detail.awardFloor !== null) {
            awardFloor = detail.awardFloor;
          }
          if (!closeDate && detail.closeDate) closeDate = detail.closeDate;
          if (detail.eligibility) eligibility = detail.eligibility;
          if (detail.geographic) geographic = detail.geographic;
          if (detail.documents.length > 0) documents = detail.documents;
        }
        // 500ms between detail fetches to avoid rate limiting.
        await delay(DETAIL_DELAY_MS);
      }

      opportunities.push({
        title: toStr(hit.title),
        agency: toStr(hit.agencyName ?? hit.agency),
        opportunity_number: oppNum,
        close_date: closeDate,
        award_ceiling: awardCeiling,
        award_floor: awardFloor,
        description,
        eligibility_requirements: eligibility,
        geographic_restrictions: geographic,
        opportunity_documents: documents,
        url: urlId
          ? `https://www.grants.gov/search-grants?opp=${urlId}`
          : null,
        source: "grants.gov" as const,
      });
    }

    let opportunitiesCreated = 0;

    for (const opp of opportunities) {
      if (!opp.title) continue;

      // Relevance filter: skip irrelevant grants before any DB queries.
      const { score, rejected } = scoreRelevance(opp.title, opp.description);
      if (rejected !== null) {
        continue;
      }
      if (score < 40) {
        continue;
      }

      // Dedup by name
      const { data: byName } = await this.client
        .from("opportunities")
        .select("id")
        .eq("organization_id", this.organizationId)
        .eq("name", opp.title)
        .maybeSingle();
      if (byName) continue;

      // Dedup by url
      if (opp.url) {
        const { data: byUrl } = await this.client
          .from("opportunities")
          .select("id")
          .eq("organization_id", this.organizationId)
          .eq("url", opp.url)
          .maybeSingle();
        if (byUrl) continue;
      }

      const category = isHudAgency(opp.agency)
        ? ("housing_grant" as const)
        : ("government_grant" as const);

      const row: Record<string, unknown> = {
        organization_id: this.organizationId,
        name: opp.title,
        category,
        source: "grants.gov",
        source_type: "government_federal",
        status: "open",
      };

      if (opp.description) row.description = opp.description;
      if (opp.close_date) row.deadline = opp.close_date;
      if (opp.award_ceiling !== null) row.amount_max = opp.award_ceiling;
      if (opp.award_floor !== null) row.amount_min = opp.award_floor;
      if (opp.url) row.url = opp.url;
      if (opp.eligibility_requirements) {
        row.eligibility_requirements = opp.eligibility_requirements;
      }
      if (opp.geographic_restrictions) {
        row.geographic_restrictions = opp.geographic_restrictions;
      }
      if (opp.opportunity_documents.length > 0) {
        row.opportunity_documents = opp.opportunity_documents;
      }

      const { error } = await this.client
        .from("opportunities")
        .insert(row);

      if (!error) opportunitiesCreated++;
    }

    // Backfill pass: enrich existing sparse rows (missing eligibility) with the
    // detail API, resolving their numeric oppId from the stored opp-number first.
    const backfill = await this.backfillSparse(runStart);

    const queryLabel =
      effectiveQueries.length === 1
        ? `"${effectiveQueries[0]}"`
        : `${effectiveQueries.length} keyword queries`;

    return {
      data: {
        opportunities,
        count: opportunities.length,
        opportunitiesCreated,
        backfilledRows: backfill.updated,
      },
      outputSummary: `Grants.gov ${queryLabel}: ${opportunities.length} unique, ${opportunitiesCreated} new record(s); ${backfill.updated} existing row(s) backfilled.`,
      itemsFound: opportunities.length,
      itemsProcessed: opportunitiesCreated + backfill.updated,
      tokensUsed: backfill.tokens,
    };
  }

  /**
   * Fetch the per-opportunity detail object and extract the fuller fields.
   * Returns null on any failure (non-fatal - the listing data is used instead).
   */
  private async fetchDetail(oppId: string): Promise<DetailData | null> {
    try {
      // The detail endpoint requires POST with a form-encoded oppId (GET 405s,
      // JSON 415s) - verified against the live API.
      const response = await fetch(GRANTS_GOV_DETAIL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: `oppId=${encodeURIComponent(oppId)}`,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;

      const body = (await response.json()) as RawDetail;
      const synopsis: RawDetailSynopsis = body.synopsis ?? {};

      // PDFs are nested in synopsisAttachmentFolders[].synopsisAttachments[];
      // build their public download URLs from the attachment id.
      const documents: OpportunityDocument[] = [];
      for (const folder of body.synopsisAttachmentFolders ?? []) {
        for (const att of folder?.synopsisAttachments ?? []) {
          const id = toStr(att?.id);
          if (!id) continue;
          const title = toStr(att?.fileName ?? att?.fileDescription);
          documents.push({
            title: title || `Attachment ${id}`,
            url: `https://apply07.grants.gov/grantsws/rest/opportunity/att/download/${id}`,
          });
        }
      }

      return {
        description: toStr(synopsis.synopsisDesc) || null,
        eligibility: toStr(synopsis.applicantEligibilityDesc) || null,
        // The details API does not return a geographic scope.
        geographic: null,
        awardCeiling: toPositiveNumber(synopsis.awardCeiling),
        awardFloor: toPositiveNumber(synopsis.awardFloor),
        closeDate: normaliseDetailDate(
          synopsis.responseDateStr ?? synopsis.responseDate,
        ),
        documents,
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolve an opportunity number (e.g. "HRSA-26-105") to the numeric oppId the
   * detail endpoint requires, by searching for the exact number. Null on miss.
   */
  private async resolveOppId(oppNumber: string): Promise<string | null> {
    try {
      const res = await fetch(GRANTS_GOV_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: oppNumber,
          oppStatuses: "forecasted|posted|closed|archived",
          rows: 1,
          startRecordNum: 0,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as GrantsGovResponse;
      const id = toStr(extractHits(body)[0]?.id);
      return id || null;
    } catch {
      return null;
    }
  }

  /**
   * Infer a brief geographic restriction from eligibility text via Claude (the
   * detail API has no geographic field). Returns null when none is mentioned.
   */
  private async inferGeographic(
    eligibility: string,
  ): Promise<{ geo: string | null; tokens: number }> {
    try {
      const res = await callClaude({
        prompt:
          "Extract any geographic restrictions from this grant eligibility text. Return only the geographic restriction as a brief string (e.g. 'Rural areas only', 'Texas residents', 'Nationwide') or null if none mentioned. Return ONLY the string or the word null.\n\nEligibility text:\n" +
          eligibility.slice(0, 2000),
        maxTokens: 40,
        temperature: 0,
      });
      const raw = res.text.trim();
      const geo =
        !raw || raw.toLowerCase() === "null"
          ? null
          : raw.replace(/^["']|["']$/g, "").slice(0, 200);
      return { geo, tokens: res.usage.totalTokens };
    } catch {
      return { geo: null, tokens: 0 };
    }
  }

  /**
   * Enrich existing grants.gov rows that are missing eligibility: resolve the
   * numeric oppId from the stored number, fetch detail, and UPDATE the row
   * (eligibility, documents, deadline-if-null, amount-if-zero/null, longer
   * description, inferred geographic). Capped + wall-clock budgeted.
   */
  private async backfillSparse(
    runStart: number,
  ): Promise<{ updated: number; tokens: number }> {
    let updated = 0;
    let tokens = 0;

    const { data: rows } = await this.client
      .from("opportunities")
      .select("id, url, deadline, amount_max, description")
      .eq("organization_id", this.organizationId)
      .eq("source", "grants.gov")
      .is("eligibility_requirements", null)
      .limit(MAX_BACKFILL);

    const sparse = (rows ?? []) as Array<{
      id: string;
      url: string | null;
      deadline: string | null;
      amount_max: number | null;
      description: string | null;
    }>;

    for (const row of sparse) {
      if (Date.now() - runStart > BACKFILL_BUDGET_MS) break;

      const oppNumber = extractOppNumber(row.url);
      if (!oppNumber) continue;

      const numericId = await this.resolveOppId(oppNumber);
      if (!numericId) {
        await delay(DETAIL_DELAY_MS);
        continue;
      }

      const detail = await this.fetchDetail(numericId);
      if (detail) {
        const patch: Record<string, unknown> = {};
        if (detail.eligibility) patch.eligibility_requirements = detail.eligibility;
        if (detail.documents.length > 0) {
          patch.opportunity_documents = detail.documents;
        }
        if (row.deadline == null && detail.closeDate) {
          patch.deadline = detail.closeDate;
        }
        if (
          (row.amount_max == null || row.amount_max === 0) &&
          detail.awardCeiling != null
        ) {
          patch.amount_max = detail.awardCeiling;
        }
        if (
          detail.description &&
          (row.description == null ||
            detail.description.length > row.description.length)
        ) {
          patch.description = detail.description.slice(0, 4000);
        }
        if (detail.eligibility && Date.now() - runStart < BACKFILL_BUDGET_MS) {
          const inferred = await this.inferGeographic(detail.eligibility);
          tokens += inferred.tokens;
          if (inferred.geo) patch.geographic_restrictions = inferred.geo;
        }

        if (Object.keys(patch).length > 0) {
          const { error } = await this.client
            .from("opportunities")
            .update(patch)
            .eq("id", row.id)
            .eq("organization_id", this.organizationId);
          if (!error) updated++;
        }
      }

      await delay(DETAIL_DELAY_MS);
    }

    return { updated, tokens };
  }
}
