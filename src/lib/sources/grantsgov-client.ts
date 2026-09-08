// Grants.gov opportunity search client — lightweight polling client for the
// public v2 search endpoint (no auth required).
//
// This is intentionally a thin fetch + map layer: given a search term it
// returns opportunities normalised toward the `opportunities` table shape.
// Callers (route handlers, worker jobs) own persistence and dedup.

import { decodeHtmlEntities } from "@/lib/utils/formatters";
import { fetchWithRetry } from "@/lib/agents/research/http-retry";

const GRANTS_GOV_SEARCH_URL = "https://api.grants.gov/v1/api/search2";

const DEFAULT_ROWS = 100;

export interface GrantsGovNormalizedOpportunity {
  /** Grants.gov opportunity id — the natural external identifier for dedup. */
  externalId: string;
  name: string;
  description: string | null;
  /** Award ceiling, mapped toward `opportunities.amount_max`. */
  amount: number | null;
  /** ISO-8601 (YYYY-MM-DD) close date, or null when not published. */
  deadline: string | null;
  category: "Government Federal";
  source: "grants_gov";
}

interface RawOppHit {
  id?: unknown;
  title?: unknown;
  closeDate?: unknown;
}

interface RawAgencyFacetOption {
  label?: unknown;
  value?: unknown;
  count?: unknown;
}

interface RawAgencyFacetEntry extends RawAgencyFacetOption {
  subAgencyOptions?: RawAgencyFacetOption[];
}

// The real v1/api/search2 response wraps hits under `data.oppHits`, not a
// top-level `oppHits` field. Hits carry only summary fields (id, title,
// dates) — no synopsis/description or award amount is available from this
// search endpoint at all.
//
// `data.agencies` is the same response's agency facet — every top-level
// department with at least one currently-matching opportunity, each with a
// `subAgencyOptions` array of its operating divisions. Verified live
// 2026-09-07: this facet is populated on any request, including an
// unfiltered one (empty keyword, no `agencies` filter), which makes it the
// only real, queryable source of current agency/sub-agency codes exposed by
// the Grants.gov API — see `discoverAgencySubCodes` below.
interface GrantsGovSearchResponse {
  data?: {
    oppHits?: RawOppHit[];
    agencies?: RawAgencyFacetEntry[];
  };
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

// Grants.gov close dates arrive as "MM/DD/YYYY"; normalise to ISO (YYYY-MM-DD).
function toIsoDate(val: unknown): string | null {
  const raw = toStr(val);
  if (!raw) return null;

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (slash) {
    const [, month, day, year] = slash;
    return `${year}-${(month ?? "").padStart(2, "0")}-${(day ?? "").padStart(2, "0")}`;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function mapHit(hit: RawOppHit): GrantsGovNormalizedOpportunity | null {
  const externalId = toStr(hit.id);
  const name = decodeHtmlEntities(toStr(hit.title));
  if (!externalId || !name) return null;

  return {
    externalId,
    name,
    // search2 hits carry no synopsis/award-ceiling field — not available
    // without a separate per-opportunity detail call.
    description: null,
    amount: null,
    deadline: toIsoDate(hit.closeDate),
    category: "Government Federal",
    source: "grants_gov",
  };
}

export interface GrantsGovSearchOptions {
  /**
   * Grants.gov agency codes (e.g. "ED" for Department of Education) to
   * restrict the search to. Multiple codes are OR'd together — verified
   * live against `api.grants.gov/v1/api/search2` 2026-09-06, which expects
   * this as a single pipe-delimited string, not a JSON array.
   */
  agencies?: string[];
  /**
   * Grants.gov funding category codes (e.g. "ED", "ELT") to restrict the
   * search to. Same pipe-delimited-string convention as `agencies`.
   */
  fundingCategories?: string[];
}

/**
 * Searches the public Grants.gov v2 opportunity search API for `searchTerm`
 * and returns opportunities mapped toward the `opportunities` table shape.
 * Returns an empty array on any HTTP or parse failure (non-fatal — callers
 * typically loop over several search terms and should not abort the whole
 * poll because one keyword's request failed).
 *
 * `options` is additive and optional — omitting it sends exactly the same
 * request body as before, so existing callers are unaffected.
 */
export async function searchGrantsGovOpportunities(
  searchTerm: string,
  options?: GrantsGovSearchOptions,
): Promise<GrantsGovNormalizedOpportunity[]> {
  const keyword = searchTerm.trim();
  if (!keyword) return [];

  const requestBody: Record<string, unknown> = {
    keyword,
    oppStatuses: "posted",
    rows: DEFAULT_ROWS,
    startRecordNum: 0,
  };
  if (options?.agencies?.length) {
    requestBody.agencies = options.agencies.join("|");
  }
  if (options?.fundingCategories?.length) {
    requestBody.fundingCategories = options.fundingCategories.join("|");
  }

  let response: Response;
  try {
    response = await fetchWithRetry(
      () =>
        fetch(GRANTS_GOV_SEARCH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(30_000),
        }),
      { attempts: 3 },
    );
  } catch {
    return [];
  }

  if (!response.ok) return [];

  let body: GrantsGovSearchResponse;
  try {
    body = (await response.json()) as GrantsGovSearchResponse;
  } catch {
    return [];
  }

  const hits = Array.isArray(body.data?.oppHits) ? body.data.oppHits : [];
  const mapped: GrantsGovNormalizedOpportunity[] = [];
  for (const hit of hits) {
    const opp = mapHit(hit);
    if (opp) mapped.push(opp);
  }
  return mapped;
}

// --- live agency/sub-agency code discovery ----------------------------------
//
// Grants.gov does not publish a dedicated agency-lookup/taxonomy endpoint —
// confirmed against the published API guide (grants.gov/api/api-guide,
// grants.gov/api/common/search2) 2026-09-07, which documents only `search2`
// and `fetchOpportunity`, and by probing `/v1/api/agencies`,
// `/v1/api/fetchAgencies`, `/v1/api/agency`, and `/v1/api/lookupAgencies`
// live, all of which returned API Gateway's "Missing Authentication Token" —
// the standard response for an unmatched route, i.e. these do not exist as
// public routes.
//
// The `search2` endpoint itself, however, returns a live `agencies` facet
// (department -> `subAgencyOptions[]`) on every response, including an
// unfiltered one. That facet is real, current, and queryable at runtime, so
// it is used here as the closest thing Grants.gov exposes to an agency
// taxonomy — see `GrantsGovSearchResponse.data.agencies` above for the
// verification note.

function toAgencyCode(val: unknown): string {
  return typeof val === "string" ? val.trim() : "";
}

/**
 * Discovers the current Grants.gov sub-agency codes nested under
 * `parentAgencyCode` (e.g. "HHS" -> ["HHS-NIH11", "HHS-CDC-GHC", ...]) by
 * reading the live `agencies` facet from an unfiltered `search2` call.
 *
 * Returns:
 * - the parent's `subAgencyOptions` codes, when it has any (HHS-style
 *   departments that only match under an operating-division code);
 * - `[parentAgencyCode]`, when the parent facet entry exists but has no
 *   sub-agencies (ED-style departments where the parent code itself is
 *   directly queryable);
 * - `[]`, when the parent has zero currently posted/forecasted
 *   opportunities (so it has no facet entry at all) or the request fails —
 *   callers should treat this as "discovery unavailable right now" and fall
 *   back to a dated snapshot rather than searching with no agency filter.
 */
export async function discoverAgencySubCodes(parentAgencyCode: string): Promise<string[]> {
  const requestBody = {
    keyword: "",
    oppStatuses: "posted|forecasted",
    rows: 1,
    startRecordNum: 0,
  };

  let response: Response;
  try {
    response = await fetchWithRetry(
      () =>
        fetch(GRANTS_GOV_SEARCH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(30_000),
        }),
      { attempts: 3 },
    );
  } catch {
    return [];
  }

  if (!response.ok) return [];

  let body: GrantsGovSearchResponse;
  try {
    body = (await response.json()) as GrantsGovSearchResponse;
  } catch {
    return [];
  }

  const agencies = Array.isArray(body.data?.agencies) ? body.data.agencies : [];
  const entry = agencies.find((a) => toAgencyCode(a?.value) === parentAgencyCode);
  if (!entry) return [];

  const subCodes = Array.isArray(entry.subAgencyOptions)
    ? entry.subAgencyOptions.map((o) => toAgencyCode(o?.value)).filter(Boolean)
    : [];

  return subCodes.length > 0 ? subCodes : [parentAgencyCode];
}

/** Cache TTL for discovered agency codes — reasonable staleness window for a taxonomy that changes on the order of months, not minutes. */
export const AGENCY_CODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedAgencyCodes {
  codes: string[];
  fetchedAt: number;
}

const agencyCodeCache = new Map<string, CachedAgencyCodes>();

/**
 * Returns the current sub-agency codes for `parentAgencyCode`, backed by an
 * in-memory cache (TTL {@link AGENCY_CODE_CACHE_TTL_MS}) over
 * {@link discoverAgencySubCodes}. Falls back to `fallbackCodes` — a dated
 * hardcoded snapshot the caller maintains — when live discovery returns
 * nothing (API outage, or the parent has no currently posted/forecasted
 * opportunities at all), logging so the fallback path is observable rather
 * than silently masking an upstream problem.
 */
export async function getAgencyCodesWithFallback(
  parentAgencyCode: string,
  fallbackCodes: readonly string[],
  ttlMs: number = AGENCY_CODE_CACHE_TTL_MS,
): Promise<string[]> {
  const cached = agencyCodeCache.get(parentAgencyCode);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    return cached.codes;
  }

  const discovered = await discoverAgencySubCodes(parentAgencyCode);
  if (discovered.length > 0) {
    agencyCodeCache.set(parentAgencyCode, { codes: discovered, fetchedAt: Date.now() });
    return discovered;
  }

  console.warn(
    `[grantsgov-client] live agency discovery for "${parentAgencyCode}" returned nothing — ` +
      `falling back to hardcoded snapshot (${fallbackCodes.length} codes). This may mean the ` +
      `snapshot has gone stale; re-verify against api.grants.gov/v1/api/search2 if this persists.`,
  );
  return [...fallbackCodes];
}

/** Test-only: clears the in-memory discovery cache so specs don't leak state across runs. */
export function __resetAgencyCodeCacheForTests(): void {
  agencyCodeCache.clear();
}
