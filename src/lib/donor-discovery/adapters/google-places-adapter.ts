import { createAdminClient } from "@/lib/supabase/admin";
import { decryptKey } from "@/lib/crypto/key-encrypt";
import { DomainRateLimiter } from "@/lib/donor-discovery/crawler-core";
import { upsertDirectoryRecord, parseGeo, type DirectoryGeo } from "@/lib/donor-discovery/directory";
import { priceApiCall } from "@/lib/pil/model-pricing";
import { recordCost } from "@/lib/pil/cost";

/**
 * Google Places registry adapter, cache-first variant
 * (DONOR_DISCOVERY_ARCHITECTURE.md §2A, §6).
 *
 * This is a distinct implementation from `google-places.ts` (the Text
 * Search-based adapter already wired into `worker/dd-request-processor.ts`).
 * That file always calls the Places API and tracks spend platform-wide in
 * `dd_api_spend`. This file implements a different, more explicit contract:
 * a generic `RegistryAdapter` interface, a cache-first lookup against
 * `donor_discovery_directory` before any paid call, the legacy Nearby Search
 * endpoint (which — unlike Places API (New) — accepts a free-text `keyword`
 * param, matching this task's "keyword derived from NAICS label + alias"
 * requirement), and a per-organization Faith Foundation budget throttle —
 * originally backed by `adapter_usage_log` (migration 076), re-pointed at
 * `ai_usage_log` by AR-10.2 once that became the platform's single per-call
 * cost ledger — rather than the shared `dd_api_spend` ledger. The two files
 * are not wired together; which one the worker uses is a decision for a
 * later phase, not this task.
 *
 * Nothing in this module runs at import time — env vars and the admin client
 * are only touched inside `enumerate`, matching the lazy-init convention
 * used by every other donor-discovery module.
 */

// ── Public types ─────────────────────────────────────────────────────────────

/** Radius-based search area. Required (not optional) because the legacy
 * Nearby Search endpoint this adapter calls always needs a lat/lng + radius —
 * state/national geography (supported by `donor_discovery_requests.geography`
 * generally, see DdGeography in google-places.ts) isn't resolvable to a
 * single Places search and is out of scope here. */
export interface Geography {
  center: { lat: number; lng: number };
  radius_mi: number;
}

/** Normalized shape returned by every registry adapter, before it's written
 * to `donor_discovery_directory`. `directory_id` is set once the record has
 * been upserted (always, by the time `enumerate` returns); `from_cache`
 * tells the caller whether this record required a fresh Places API call. */
export interface RawProspect {
  legal_name: string;
  website: string | null;
  hq_address: string | null;
  geo: DirectoryGeo | null;
  phone: string | null;
  naics_codes: string[];
  source_adapters: string[];
  directory_id: string | null;
  from_cache: boolean;
}

/**
 * Generic contract every acquisition adapter (§2A) implements: enumerate
 * companies for a set of taxonomy codes inside a geography. `organizationId`
 * is not mentioned in this task's one-line interface summary, but it's
 * unavoidable in practice — the Faith Foundation throttle and the BYOK
 * connector lookup both need to know which org is asking, and every other
 * per-request caller in this codebase (worker/dd-request-processor.ts) has
 * an organization_id in hand at the call site.
 */
export interface RegistryAdapter {
  name: string;
  enumerate(naicsCodes: string[], geography: Geography, organizationId: string): Promise<RawProspect[]>;
}

export type AdapterErrorCode = "BYOK_REQUIRED" | "PLACES_API_ERROR";

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  constructor(code: AdapterErrorCode, message: string) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
  }
}

const PROVIDER = "google_places";
const MONTHLY_BUDGET_USD = 100; // $100 hard ceiling (Faith Foundation platform-key path only)

// ── Non-enumerable "cached-only" warning flag ───────────────────────────────
//
// The interface returns a plain RawProspect[], so the Faith Foundation
// budget-exceeded warning can't be a new top-level field without breaking
// that contract. Instead it's attached as a non-enumerable property on the
// returned array itself — invisible to JSON.stringify/spread/for-of, but
// readable by any caller that cares via `wasBudgetLimited`.
const BUDGET_WARNING = Symbol("dd_places_budget_warning");

export function wasBudgetLimited(result: RawProspect[]): boolean {
  return (result as unknown as Record<symbol, boolean>)[BUDGET_WARNING] === true;
}

function markBudgetLimited(result: RawProspect[]): RawProspect[] {
  Object.defineProperty(result, BUDGET_WARNING, {
    value: true,
    enumerable: false,
    configurable: true,
  });
  return result;
}

// ── Rate limiting ────────────────────────────────────────────────────────────
//
// Places is a paid, authenticated API, not a scraped page — the crawler-core
// robots.txt/ToS chain doesn't apply (see google-places.ts's comment on this
// exact point) — but the task still asks for the existing token-bucket
// pattern, so one domain-scoped limiter is dedicated to the Places host.
const PLACES_HOST = "maps.googleapis.com";
const placesRateLimiter = new DomainRateLimiter(5_000); // 1 req / 5s

// ── Cache-first directory lookup ─────────────────────────────────────────────

interface CachedDirectoryRow {
  id: string;
  legal_name: string;
  website: string | null;
  hq_address: string | null;
  geo: unknown;
  phone: string | null;
  naics_codes: string[];
  source_adapters: string[];
}

/**
 * Whether a `donor_discovery_geo_within_postgis(p_ids uuid[], p_lat, p_lng,
 * p_radius_m)` RPC exists in this database. No such function or PostGIS
 * extension is installed in this schema today (the directory's `geo` column
 * is a plain Postgres `point`, deduped via a hand-rolled haversine function —
 * see migration 071's comment) — but the task asks for "ST_DWithin if
 * available", so this probes for it once per process instead of assuming
 * either way. On any error (function missing, extension absent) it falls
 * back to the bounding-box filter below and remembers the negative result so
 * later calls in the same process skip straight to the fallback.
 */
let postgisRpcAvailable: boolean | null = null;

async function filterByGeographyPostgis(
  rows: CachedDirectoryRow[],
  geography: Geography,
): Promise<CachedDirectoryRow[] | null> {
  if (postgisRpcAvailable === false) return null;

  const supabase = createAdminClient();
  const radiusMeters = geography.radius_mi * 1609.34;

  const { data, error } = await supabase.rpc("donor_discovery_geo_within_postgis", {
    p_ids: rows.map((r) => r.id),
    p_lat: geography.center.lat,
    p_lng: geography.center.lng,
    p_radius_m: radiusMeters,
  });

  if (error) {
    postgisRpcAvailable = false;
    return null;
  }

  postgisRpcAvailable = true;
  const withinIds = new Set((data as { id: string }[] | null ?? []).map((r) => r.id));
  return rows.filter((r) => withinIds.has(r.id));
}

/**
 * Fallback geo filter when PostGIS isn't available: a simple lat/lng
 * bounding box around `geography.center`, sized from `radius_mi` using the
 * standard ~69 miles/degree-latitude approximation and a longitude
 * correction by cos(latitude). Deliberately conservative (a bounding box is
 * a superset of the true circle — a few extra corner records is an
 * acceptable amount of overreach for a cache lookup that's about to be
 * cheaper than a Places API call either way). Rows with no `geo` on file are
 * excluded — there's no way to confirm proximity for them.
 */
function filterByGeographyBoundingBox(
  rows: CachedDirectoryRow[],
  geography: Geography,
): CachedDirectoryRow[] {
  const { center, radius_mi } = geography;
  const latDeltaDeg = radius_mi / 69.0;
  const lngDeltaDeg = radius_mi / (69.0 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01));

  const minLat = center.lat - latDeltaDeg;
  const maxLat = center.lat + latDeltaDeg;
  const minLng = center.lng - lngDeltaDeg;
  const maxLng = center.lng + lngDeltaDeg;

  return rows.filter((row) => {
    const geo = parseGeo(row.geo);
    if (!geo) return false;
    return geo.lat >= minLat && geo.lat <= maxLat && geo.lng >= minLng && geo.lng <= maxLng;
  });
}

async function filterByGeography(
  rows: CachedDirectoryRow[],
  geography: Geography,
): Promise<CachedDirectoryRow[]> {
  if (rows.length === 0) return rows;
  const postgisResult = await filterByGeographyPostgis(rows, geography);
  return postgisResult ?? filterByGeographyBoundingBox(rows, geography);
}

/** Every distinct NAICS code covered by at least one row already in the directory. */
function coveredCodes(rows: CachedDirectoryRow[], naicsCodes: string[]): Set<string> {
  const wanted = new Set(naicsCodes);
  const covered = new Set<string>();
  for (const row of rows) {
    for (const code of row.naics_codes ?? []) {
      if (wanted.has(code)) covered.add(code);
    }
  }
  return covered;
}

function toRawProspectFromCache(row: CachedDirectoryRow): RawProspect {
  return {
    legal_name: row.legal_name,
    website: row.website,
    hq_address: row.hq_address,
    geo: parseGeo(row.geo),
    phone: row.phone,
    naics_codes: row.naics_codes ?? [],
    source_adapters: row.source_adapters ?? [],
    directory_id: row.id,
    from_cache: true,
  };
}

/**
 * Queries `donor_discovery_directory` for records already covering
 * `naicsCodes`, then narrows to `geography` (§ above). This is the "cache
 * before any Places API call" step — the naics_codes array-overlap filter
 * runs in Postgres (cheap, GIN-friendly); the geo narrowing runs
 * PostGIS-if-available, bounding-box otherwise.
 */
async function queryCachedDirectory(
  naicsCodes: string[],
  geography: Geography,
): Promise<CachedDirectoryRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("donor_discovery_directory")
    .select("id, legal_name, website, hq_address, geo, phone, naics_codes, source_adapters")
    .overlaps("naics_codes", naicsCodes);

  if (error || !data) return [];

  return filterByGeography(data as CachedDirectoryRow[], geography);
}

// ── Faith Foundation platform-key throttle ──────────────────────────────────

function isFaithFoundation(organizationId: string): boolean {
  const faithOrgId = process.env.FAITH_FOUNDATION_ORG_ID;
  return Boolean(faithOrgId) && organizationId === faithOrgId;
}

// AR-10.2: the throttle now reads ai_usage_log (the single per-call cost
// ledger) instead of adapter_usage_log.api_cost_cents, which is frozen at
// its DEFAULT 0 and no longer written. Unpriced rows (cost_usd null -- see
// recordGooglePlacesCost below) are treated as $0 spend for this sum,
// consistent with checkBudget()'s (src/lib/pil/cost.ts) own tri-state
// "unknown-priced calls don't count against a hard-dollar ceiling" posture,
// since summing null as if it were the real spend would either crash the
// throttle or silently understate it either way -- this at least never
// blocks a Faith Foundation search that isn't actually confirmed to have
// spent anything.
async function faithFoundationMonthSpendUsd(organizationId: string): Promise<number> {
  const supabase = createAdminClient();
  const now = new Date();
  const monthStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { data, error } = await supabase
    .from("ai_usage_log")
    .select("cost_usd")
    .eq("organization_id", organizationId)
    .eq("model", PROVIDER)
    .gte("created_at", monthStartIso);

  if (error || !data) return 0;
  return (data as { cost_usd: number | null }[]).reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
}

async function logAdapterUsage(params: {
  organizationId: string;
  recordsReturned: number;
  cacheHit: boolean;
}): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("adapter_usage_log").insert({
    organization_id: params.organizationId,
    adapter_name: PROVIDER,
    records_returned: params.recordsReturned,
    cache_hit: params.cacheHit,
  });
}

/**
 * AR-10.2: records the real dollar cost of `requestsMade` paid Nearby Search
 * calls to ai_usage_log via the single recordCost() ledger, priced through
 * model_cost_reference's 'google_places' pricing_unit='call' row (migration
 * 197) rather than a hardcoded per-file constant. Never throws -- a
 * cost-logging failure must not fail the prospect enumeration that already
 * succeeded, matching src/lib/ai/usage-recorder.ts's recordUsage() contract
 * for Anthropic calls.
 */
async function recordGooglePlacesCost(organizationId: string, requestsMade: number): Promise<void> {
  if (requestsMade === 0) return;
  try {
    const priced = await priceApiCall(PROVIDER, requestsMade);
    await recordCost({
      organization_id: organizationId,
      model: PROVIDER,
      endpoint: "google-places-nearby-search",
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_usd: priced.costUsd,
      duration_ms: null,
      agent_type: null,
      agent_run_id: null,
      pil_agent_run_id: null,
      provider: PROVIDER,
      billing_path: "api",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[google-places-adapter] Failed to record ai_usage_log cost: ${message}`);
  }
}

// ── BYOK connector resolution (non-Faith-Foundation orgs) ───────────────────

interface ConnectorRow {
  encrypted_api_key: string;
  status: string;
}

async function resolveByokApiKey(organizationId: string): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("donor_discovery_connectors")
    .select("encrypted_api_key, status")
    .eq("organization_id", organizationId)
    .eq("provider", PROVIDER)
    .maybeSingle();

  const row = data as ConnectorRow | null;
  if (error || !row || row.status !== "active") {
    throw new AdapterError(
      "BYOK_REQUIRED",
      `No active Google Places connector key found for organization ${organizationId}. ` +
        "Connect one under Settings > Donor Discovery > Connectors.",
    );
  }

  return decryptKey(row.encrypted_api_key);
}

// ── NAICS label + alias -> Nearby Search keyword ────────────────────────────

interface TaxonomyLookupRow {
  id: string;
  label: string;
}

/**
 * Builds the free-text `keyword` param for one NAICS gap code: the
 * taxonomy's official label plus its first plain-language alias (migration
 * 075 — "septic installer" alongside the Census title "Septic Tank and
 * Related Services"), which together aim Nearby Search's free-text matching
 * better than either alone. Falls back to the bare code when the taxonomy
 * node isn't found rather than skipping the gap entirely.
 */
async function resolveKeyword(naicsCode: string): Promise<string> {
  const supabase = createAdminClient();

  const { data: taxonomyRow } = await supabase
    .from("donor_discovery_taxonomy")
    .select("id, label")
    .eq("kind", "naics")
    .eq("code", naicsCode)
    .maybeSingle();

  const taxonomy = taxonomyRow as TaxonomyLookupRow | null;
  if (!taxonomy) return naicsCode;

  const { data: aliasRow } = await supabase
    .from("donor_discovery_taxonomy_aliases")
    .select("alias")
    .eq("taxonomy_id", taxonomy.id)
    .limit(1)
    .maybeSingle();

  const alias = (aliasRow as { alias: string } | null)?.alias;
  return alias ? `${taxonomy.label} ${alias}` : taxonomy.label;
}

// ── Legacy Nearby Search (the "keyword" param only exists on this endpoint,
// not on Places API (New)'s searchNearby — see file header) ────────────────

const NEARBY_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const MAX_RADIUS_METERS = 50_000; // Places API hard cap
const MAX_PAGES = 3; // Nearby Search caps at 60 results / 3 pages of 20
const NEXT_PAGE_TOKEN_DELAY_MS = 2_000; // Google recommends a short delay before a token becomes valid

interface LegacyPlaceResult {
  place_id: string;
  name: string;
  vicinity?: string;
  geometry?: { location?: { lat: number; lng: number } };
}

interface LegacyNearbySearchResponse {
  results?: LegacyPlaceResult[];
  status: string;
  error_message?: string;
  next_page_token?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nearbySearchPage(
  apiKey: string,
  keyword: string,
  geography: Geography,
  pageToken: string | undefined,
): Promise<LegacyNearbySearchResponse> {
  await placesRateLimiter.acquire(PLACES_HOST);

  const url = new URL(NEARBY_SEARCH_URL);
  url.searchParams.set("key", apiKey);
  if (pageToken) {
    url.searchParams.set("pagetoken", pageToken);
  } else {
    url.searchParams.set("location", `${geography.center.lat},${geography.center.lng}`);
    url.searchParams.set(
      "radius",
      String(Math.round(Math.min(geography.radius_mi * 1609.34, MAX_RADIUS_METERS))),
    );
    url.searchParams.set("keyword", keyword);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new AdapterError(
      "PLACES_API_ERROR",
      `Nearby Search HTTP ${response.status} for keyword "${keyword}"`,
    );
  }

  const body = (await response.json()) as LegacyNearbySearchResponse;
  if (body.status !== "OK" && body.status !== "ZERO_RESULTS" && body.status !== "INVALID_REQUEST") {
    throw new AdapterError(
      "PLACES_API_ERROR",
      `Nearby Search failed (${body.status}) for keyword "${keyword}": ${body.error_message ?? ""}`,
    );
  }

  return body;
}

/** Nearby Search doesn't return website/phone (that requires a separate Place
 * Details call) — those stay null here and are filled in later by the §2B
 * enrichment stage (web-extractor over the eventual website), not this
 * registry adapter. */
function normalizePlace(place: LegacyPlaceResult, naicsCode: string): RawProspect | null {
  const legalName = place.name?.trim();
  if (!legalName) return null;

  const location = place.geometry?.location;

  return {
    legal_name: legalName,
    website: null,
    hq_address: place.vicinity ?? null,
    geo: location ? { lat: location.lat, lng: location.lng } : null,
    phone: null,
    naics_codes: [naicsCode],
    source_adapters: [PROVIDER],
    directory_id: null,
    from_cache: false,
  };
}

async function enumerateGapCode(
  apiKey: string,
  naicsCode: string,
  geography: Geography,
): Promise<{ prospects: RawProspect[]; requestsMade: number }> {
  const keyword = await resolveKeyword(naicsCode);
  const prospects: RawProspect[] = [];
  let requestsMade = 0;
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await sleep(NEXT_PAGE_TOKEN_DELAY_MS);

    const response = await nearbySearchPage(apiKey, keyword, geography, pageToken);
    requestsMade += 1;

    for (const result of response.results ?? []) {
      const normalized = normalizePlace(result, naicsCode);
      if (normalized) prospects.push(normalized);
    }

    if (!response.next_page_token) break;
    pageToken = response.next_page_token;
  }

  return { prospects, requestsMade };
}

// ── Directory upsert ─────────────────────────────────────────────────────────

async function upsertFreshProspect(prospect: RawProspect): Promise<RawProspect> {
  try {
    const record = await upsertDirectoryRecord({
      legal_name: prospect.legal_name,
      website: prospect.website,
      hq_address: prospect.hq_address,
      geo: prospect.geo,
      phone: prospect.phone,
      naics_codes: prospect.naics_codes,
      source_adapter: PROVIDER,
    });
    return { ...prospect, directory_id: record.id, source_adapters: record.source_adapters };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[google-places-adapter] Directory upsert failed for "${prospect.legal_name}": ${message}`);
    return prospect;
  }
}

/** De-dupes the merged cached + freshly-fetched result set: prefer
 * `directory_id` as the key (set for every upserted record); a record that
 * somehow failed to upsert falls back to a lowercased legal_name key so it
 * isn't silently dropped. */
function dedupeProspects(prospects: RawProspect[]): RawProspect[] {
  const byKey = new Map<string, RawProspect>();
  for (const prospect of prospects) {
    const key = prospect.directory_id ?? `name:${prospect.legal_name.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || (!existing.website && prospect.website)) {
      byKey.set(key, prospect);
    }
  }
  return Array.from(byKey.values());
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Cache-first enumeration for `naicsCodes` inside `geography`, scoped to
 * `organizationId`:
 *
 * 1. Query `donor_discovery_directory` for existing coverage (naics overlap
 *    + geo proximity). Codes fully covered by cache never touch the Places
 *    API.
 * 2. For remaining gap codes, resolve an API key:
 *    - `organizationId === FAITH_FOUNDATION_ORG_ID`: use the platform
 *      `GOOGLE_PLACES_API_KEY`, gated by a $100/month spend ceiling tracked
 *      in `adapter_usage_log`. At/over the ceiling, returns cached results
 *      only, flagged via `wasBudgetLimited`.
 *    - otherwise: require an active BYOK connector
 *      (`donor_discovery_connectors`, provider `google_places`) — throws
 *      `AdapterError('BYOK_REQUIRED', ...)` if none exists.
 * 3. Calls legacy Nearby Search per gap code, upserts every result into the
 *    shared directory, and returns the merged (cache + fresh), deduplicated
 *    prospect list.
 */
async function enumerate(
  naicsCodes: string[],
  geography: Geography,
  organizationId: string,
): Promise<RawProspect[]> {
  const cachedRows = await queryCachedDirectory(naicsCodes, geography);
  const covered = coveredCodes(cachedRows, naicsCodes);
  const gapCodes = naicsCodes.filter((code) => !covered.has(code));

  const cachedProspects = cachedRows.map(toRawProspectFromCache);

  if (gapCodes.length === 0) {
    await logAdapterUsage({
      organizationId,
      recordsReturned: cachedProspects.length,
      cacheHit: true,
    });
    return dedupeProspects(cachedProspects);
  }

  const faith = isFaithFoundation(organizationId);

  if (faith) {
    const spentUsd = await faithFoundationMonthSpendUsd(organizationId);
    if (spentUsd >= MONTHLY_BUDGET_USD) {
      console.warn(
        `[google-places-adapter] Faith Foundation monthly Places budget exceeded ` +
          `($${spentUsd.toFixed(2)} of $${MONTHLY_BUDGET_USD.toFixed(2)}) — ` +
          "returning cached results only.",
      );
      await logAdapterUsage({
        organizationId,
        recordsReturned: cachedProspects.length,
        cacheHit: true,
      });
      return markBudgetLimited(dedupeProspects(cachedProspects));
    }
  }

  const apiKey = faith ? process.env.GOOGLE_PLACES_API_KEY : undefined;
  if (faith && !apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is not set — cannot run the platform-key Places path.");
  }
  const resolvedApiKey = apiKey ?? (await resolveByokApiKey(organizationId));

  const freshProspects: RawProspect[] = [];
  let totalRequests = 0;

  for (const code of gapCodes) {
    const { prospects, requestsMade } = await enumerateGapCode(resolvedApiKey, code, geography);
    totalRequests += requestsMade;
    for (const prospect of prospects) {
      freshProspects.push(await upsertFreshProspect(prospect));
    }
  }

  const merged = dedupeProspects([...cachedProspects, ...freshProspects]);

  await logAdapterUsage({
    organizationId,
    recordsReturned: merged.length,
    cacheHit: false,
  });
  await recordGooglePlacesCost(organizationId, totalRequests);

  return merged;
}

export const googlePlacesAdapter: RegistryAdapter = {
  name: PROVIDER,
  enumerate,
};
