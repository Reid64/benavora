"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.googlePlacesAdapter = exports.AdapterError = void 0;
exports.wasBudgetLimited = wasBudgetLimited;
const admin_1 = require("../../../lib/supabase/admin");
const key_encrypt_1 = require("../../../lib/crypto/key-encrypt");
const crawler_core_1 = require("../../../lib/donor-discovery/crawler-core");
const directory_1 = require("../../../lib/donor-discovery/directory");
class AdapterError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "AdapterError";
        this.code = code;
    }
}
exports.AdapterError = AdapterError;
const PROVIDER = "google_places";
const MONTHLY_BUDGET_CENTS = 100_00; // $100 hard ceiling (Faith Foundation platform-key path only)
// ── Non-enumerable "cached-only" warning flag ───────────────────────────────
//
// The interface returns a plain RawProspect[], so the Faith Foundation
// budget-exceeded warning can't be a new top-level field without breaking
// that contract. Instead it's attached as a non-enumerable property on the
// returned array itself — invisible to JSON.stringify/spread/for-of, but
// readable by any caller that cares via `wasBudgetLimited`.
const BUDGET_WARNING = Symbol("dd_places_budget_warning");
function wasBudgetLimited(result) {
    return result[BUDGET_WARNING] === true;
}
function markBudgetLimited(result) {
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
const placesRateLimiter = new crawler_core_1.DomainRateLimiter(5_000); // 1 req / 5s
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
let postgisRpcAvailable = null;
async function filterByGeographyPostgis(rows, geography) {
    if (postgisRpcAvailable === false)
        return null;
    const supabase = (0, admin_1.createAdminClient)();
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
    const withinIds = new Set((data ?? []).map((r) => r.id));
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
function filterByGeographyBoundingBox(rows, geography) {
    const { center, radius_mi } = geography;
    const latDeltaDeg = radius_mi / 69.0;
    const lngDeltaDeg = radius_mi / (69.0 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01));
    const minLat = center.lat - latDeltaDeg;
    const maxLat = center.lat + latDeltaDeg;
    const minLng = center.lng - lngDeltaDeg;
    const maxLng = center.lng + lngDeltaDeg;
    return rows.filter((row) => {
        const geo = (0, directory_1.parseGeo)(row.geo);
        if (!geo)
            return false;
        return geo.lat >= minLat && geo.lat <= maxLat && geo.lng >= minLng && geo.lng <= maxLng;
    });
}
async function filterByGeography(rows, geography) {
    if (rows.length === 0)
        return rows;
    const postgisResult = await filterByGeographyPostgis(rows, geography);
    return postgisResult ?? filterByGeographyBoundingBox(rows, geography);
}
/** Every distinct NAICS code covered by at least one row already in the directory. */
function coveredCodes(rows, naicsCodes) {
    const wanted = new Set(naicsCodes);
    const covered = new Set();
    for (const row of rows) {
        for (const code of row.naics_codes ?? []) {
            if (wanted.has(code))
                covered.add(code);
        }
    }
    return covered;
}
function toRawProspectFromCache(row) {
    return {
        legal_name: row.legal_name,
        website: row.website,
        hq_address: row.hq_address,
        geo: (0, directory_1.parseGeo)(row.geo),
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
async function queryCachedDirectory(naicsCodes, geography) {
    const supabase = (0, admin_1.createAdminClient)();
    const { data, error } = await supabase
        .from("donor_discovery_directory")
        .select("id, legal_name, website, hq_address, geo, phone, naics_codes, source_adapters")
        .overlaps("naics_codes", naicsCodes);
    if (error || !data)
        return [];
    return filterByGeography(data, geography);
}
// ── Faith Foundation platform-key throttle ──────────────────────────────────
function isFaithFoundation(organizationId) {
    const faithOrgId = process.env.FAITH_FOUNDATION_ORG_ID;
    return Boolean(faithOrgId) && organizationId === faithOrgId;
}
async function faithFoundationMonthSpendCents(organizationId) {
    const supabase = (0, admin_1.createAdminClient)();
    const now = new Date();
    const monthStartIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const { data, error } = await supabase
        .from("adapter_usage_log")
        .select("api_cost_cents")
        .eq("organization_id", organizationId)
        .eq("adapter_name", PROVIDER)
        .gte("called_at", monthStartIso);
    if (error || !data)
        return 0;
    return data.reduce((sum, r) => sum + (r.api_cost_cents ?? 0), 0);
}
async function logAdapterUsage(params) {
    const supabase = (0, admin_1.createAdminClient)();
    await supabase.from("adapter_usage_log").insert({
        organization_id: params.organizationId,
        adapter_name: PROVIDER,
        api_cost_cents: params.apiCostCents,
        records_returned: params.recordsReturned,
        cache_hit: params.cacheHit,
    });
}
async function resolveByokApiKey(organizationId) {
    const supabase = (0, admin_1.createAdminClient)();
    const { data, error } = await supabase
        .from("donor_discovery_connectors")
        .select("encrypted_api_key, status")
        .eq("organization_id", organizationId)
        .eq("provider", PROVIDER)
        .maybeSingle();
    const row = data;
    if (error || !row || row.status !== "active") {
        throw new AdapterError("BYOK_REQUIRED", `No active Google Places connector key found for organization ${organizationId}. ` +
            "Connect one under Settings > Donor Discovery > Connectors.");
    }
    return (0, key_encrypt_1.decryptKey)(row.encrypted_api_key);
}
/**
 * Builds the free-text `keyword` param for one NAICS gap code: the
 * taxonomy's official label plus its first plain-language alias (migration
 * 075 — "septic installer" alongside the Census title "Septic Tank and
 * Related Services"), which together aim Nearby Search's free-text matching
 * better than either alone. Falls back to the bare code when the taxonomy
 * node isn't found rather than skipping the gap entirely.
 */
async function resolveKeyword(naicsCode) {
    const supabase = (0, admin_1.createAdminClient)();
    const { data: taxonomyRow } = await supabase
        .from("donor_discovery_taxonomy")
        .select("id, label")
        .eq("kind", "naics")
        .eq("code", naicsCode)
        .maybeSingle();
    const taxonomy = taxonomyRow;
    if (!taxonomy)
        return naicsCode;
    const { data: aliasRow } = await supabase
        .from("donor_discovery_taxonomy_aliases")
        .select("alias")
        .eq("taxonomy_id", taxonomy.id)
        .limit(1)
        .maybeSingle();
    const alias = aliasRow?.alias;
    return alias ? `${taxonomy.label} ${alias}` : taxonomy.label;
}
// ── Legacy Nearby Search (the "keyword" param only exists on this endpoint,
// not on Places API (New)'s searchNearby — see file header) ────────────────
const NEARBY_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const COST_PER_REQUEST_USD = 0.032; // Basic Data SKU, same rate as Text Search (New)
const MAX_RADIUS_METERS = 50_000; // Places API hard cap
const MAX_PAGES = 3; // Nearby Search caps at 60 results / 3 pages of 20
const NEXT_PAGE_TOKEN_DELAY_MS = 2_000; // Google recommends a short delay before a token becomes valid
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function nearbySearchPage(apiKey, keyword, geography, pageToken) {
    await placesRateLimiter.acquire(PLACES_HOST);
    const url = new URL(NEARBY_SEARCH_URL);
    url.searchParams.set("key", apiKey);
    if (pageToken) {
        url.searchParams.set("pagetoken", pageToken);
    }
    else {
        url.searchParams.set("location", `${geography.center.lat},${geography.center.lng}`);
        url.searchParams.set("radius", String(Math.round(Math.min(geography.radius_mi * 1609.34, MAX_RADIUS_METERS))));
        url.searchParams.set("keyword", keyword);
    }
    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new AdapterError("PLACES_API_ERROR", `Nearby Search HTTP ${response.status} for keyword "${keyword}"`);
    }
    const body = (await response.json());
    if (body.status !== "OK" && body.status !== "ZERO_RESULTS" && body.status !== "INVALID_REQUEST") {
        throw new AdapterError("PLACES_API_ERROR", `Nearby Search failed (${body.status}) for keyword "${keyword}": ${body.error_message ?? ""}`);
    }
    return body;
}
/** Nearby Search doesn't return website/phone (that requires a separate Place
 * Details call) — those stay null here and are filled in later by the §2B
 * enrichment stage (web-extractor over the eventual website), not this
 * registry adapter. */
function normalizePlace(place, naicsCode) {
    const legalName = place.name?.trim();
    if (!legalName)
        return null;
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
async function enumerateGapCode(apiKey, naicsCode, geography) {
    const keyword = await resolveKeyword(naicsCode);
    const prospects = [];
    let requestsMade = 0;
    let pageToken;
    for (let page = 0; page < MAX_PAGES; page++) {
        if (page > 0)
            await sleep(NEXT_PAGE_TOKEN_DELAY_MS);
        const response = await nearbySearchPage(apiKey, keyword, geography, pageToken);
        requestsMade += 1;
        for (const result of response.results ?? []) {
            const normalized = normalizePlace(result, naicsCode);
            if (normalized)
                prospects.push(normalized);
        }
        if (!response.next_page_token)
            break;
        pageToken = response.next_page_token;
    }
    return { prospects, requestsMade };
}
// ── Directory upsert ─────────────────────────────────────────────────────────
async function upsertFreshProspect(prospect) {
    try {
        const record = await (0, directory_1.upsertDirectoryRecord)({
            legal_name: prospect.legal_name,
            website: prospect.website,
            hq_address: prospect.hq_address,
            geo: prospect.geo,
            phone: prospect.phone,
            naics_codes: prospect.naics_codes,
            source_adapter: PROVIDER,
        });
        return { ...prospect, directory_id: record.id, source_adapters: record.source_adapters };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[google-places-adapter] Directory upsert failed for "${prospect.legal_name}": ${message}`);
        return prospect;
    }
}
/** De-dupes the merged cached + freshly-fetched result set: prefer
 * `directory_id` as the key (set for every upserted record); a record that
 * somehow failed to upsert falls back to a lowercased legal_name key so it
 * isn't silently dropped. */
function dedupeProspects(prospects) {
    const byKey = new Map();
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
async function enumerate(naicsCodes, geography, organizationId) {
    const cachedRows = await queryCachedDirectory(naicsCodes, geography);
    const covered = coveredCodes(cachedRows, naicsCodes);
    const gapCodes = naicsCodes.filter((code) => !covered.has(code));
    const cachedProspects = cachedRows.map(toRawProspectFromCache);
    if (gapCodes.length === 0) {
        await logAdapterUsage({
            organizationId,
            apiCostCents: 0,
            recordsReturned: cachedProspects.length,
            cacheHit: true,
        });
        return dedupeProspects(cachedProspects);
    }
    const faith = isFaithFoundation(organizationId);
    if (faith) {
        const spentCents = await faithFoundationMonthSpendCents(organizationId);
        if (spentCents >= MONTHLY_BUDGET_CENTS) {
            console.warn(`[google-places-adapter] Faith Foundation monthly Places budget exceeded ` +
                `($${(spentCents / 100).toFixed(2)} of $${(MONTHLY_BUDGET_CENTS / 100).toFixed(2)}) — ` +
                "returning cached results only.");
            await logAdapterUsage({
                organizationId,
                apiCostCents: 0,
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
    const freshProspects = [];
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
        apiCostCents: Math.round(totalRequests * COST_PER_REQUEST_USD * 100),
        recordsReturned: merged.length,
        cacheHit: false,
    });
    return merged;
}
exports.googlePlacesAdapter = {
    name: PROVIDER,
    enumerate,
};
