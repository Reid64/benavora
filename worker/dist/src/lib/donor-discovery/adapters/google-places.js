"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DdBudgetExceededError = void 0;
exports.normalizePlace = normalizePlace;
exports.enumerate = enumerate;
const admin_1 = require("@/lib/supabase/admin");
const env_1 = require("@/lib/env");
const directory_1 = require("@/lib/donor-discovery/directory");
/**
 * Google Places registry adapter (DONOR_DISCOVERY_ARCHITECTURE.md §2A).
 *
 * Enumerates companies for a set of NAICS codes inside a radius via the
 * Places API (New) Text Search endpoint, writes normalized rows into the
 * shared `donor_discovery_directory`, and hard-stops on a monthly budget
 * cap tracked in `dd_api_spend`.
 *
 * Places API is a paid, authenticated API (no HTML scraping), so calls here
 * go straight through `fetch` — the crawler-core compliance chain
 * (robots.txt / ToS registry / per-domain rate limiter) is for adapters
 * that fetch third-party web pages, not this one (architecture doc §5:
 * "Google Places used via paid API, no SERP scraping").
 *
 * Nothing in this module runs at import time: the API key is read and
 * validated only inside `enumerate`, so importing this file is always safe
 * from any context (including Vercel routes that merely enqueue work).
 */
const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_FIELD_MASK = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.internationalPhoneNumber",
    "places.nationalPhoneNumber",
    "places.websiteUri",
    "places.types",
    "nextPageToken",
].join(",");
// Text Search (New) at the "Pro" field tier (the fields we request —
// address, phone, website — fall outside the free "Essentials" tier).
// https://mapsplatform.google.com/pricing/ — update if Google's pricing changes.
const COST_PER_REQUEST_USD = 0.032;
const DEFAULT_MONTHLY_BUDGET_USD = 200;
const MAX_PAGES_PER_TERM = 3; // Text Search caps at 60 results / 3 pages of 20.
const PAGE_SIZE = 20;
const MAX_RADIUS_METERS = 50_000; // Places API hard cap.
const METERS_PER_MILE = 1609.34;
const NEXT_PAGE_TOKEN_DELAY_MS = 2_000; // Google recommends a short delay before a token becomes valid.
const PROVIDER = "google_places";
const NAICS_PLACES_MAP = {
    // Construction — site work & trades
    "236115": { includedType: "general_contractor", textQuery: "home builders" },
    "236118": { includedType: "general_contractor", textQuery: "residential remodeling contractors" },
    "236220": { includedType: "general_contractor", textQuery: "commercial building contractors" },
    "237110": { textQuery: "water well drilling contractors" },
    "238110": { textQuery: "concrete and foundation contractors" },
    "238160": { includedType: "roofing_contractor", textQuery: "roofing contractors" },
    "238210": { includedType: "electrician", textQuery: "electrical contractors" },
    "238220": { includedType: "plumber", textQuery: "plumbing and HVAC contractors" },
    "238320": { includedType: "painter", textQuery: "painting contractors" },
    "238330": { textQuery: "flooring contractors" },
    "238910": { textQuery: "site preparation and grading contractors" },
    "238990": { textQuery: "specialty trade contractors" },
    // Services
    "484121": { textQuery: "trucking and freight companies" },
    "522110": { includedType: "bank", textQuery: "commercial banks" },
    "524210": { includedType: "insurance_agency", textQuery: "insurance agencies" },
    "541110": { includedType: "lawyer", textQuery: "law offices" },
    "541211": { includedType: "accounting", textQuery: "accounting firms" },
    "561621": { textQuery: "security systems installers" },
    "561720": { textQuery: "janitorial services" },
    "561730": { textQuery: "landscaping services" },
    "561740": { textQuery: "carpet and upholstery cleaning services" },
    "562991": { textQuery: "septic system installation and pumping services" },
    "811111": { includedType: "car_repair", textQuery: "auto repair shops" },
    "811121": { includedType: "car_repair", textQuery: "auto body and paint shops" },
    "811192": { includedType: "car_wash", textQuery: "car washes" },
    // Retail
    "444110": { includedType: "hardware_store", textQuery: "home improvement centers" },
    "444180": { includedType: "hardware_store", textQuery: "building material dealers" },
    "445110": { includedType: "supermarket", textQuery: "grocery stores and supermarkets" },
    "447110": { includedType: "gas_station", textQuery: "gas stations and convenience stores" },
    "448140": { includedType: "clothing_store", textQuery: "family clothing stores" },
    "452210": { includedType: "department_store", textQuery: "department stores" },
    "453910": { includedType: "pet_store", textQuery: "pet supply stores" },
    // Manufacturing (Places is a weak fit here — best-effort textQuery only)
    "336111": { textQuery: "automobile manufacturing plants" },
};
class DdBudgetExceededError extends Error {
    constructor(monthlyBudgetUsd, spentUsd) {
        super(`Donor Discovery Google Places budget exceeded: $${spentUsd.toFixed(2)} spent of ` +
            `$${monthlyBudgetUsd.toFixed(2)} monthly cap (DD_PLACES_MONTHLY_BUDGET_USD). Stopping before further requests.`);
        this.name = "DdBudgetExceededError";
    }
}
exports.DdBudgetExceededError = DdBudgetExceededError;
// ── Geography ────────────────────────────────────────────────────────────────
function requireRadiusGeography(geography) {
    if ("center" in geography && "radius_mi" in geography)
        return geography;
    throw new Error("google-places adapter requires a radius geography ({center, radius_mi}); " +
        "state/national geography is not supported by this adapter yet.");
}
async function resolveSearchTerms(naicsCodes) {
    const terms = [];
    const unmapped = [];
    for (const code of naicsCodes) {
        const entry = NAICS_PLACES_MAP[code];
        if (entry) {
            terms.push({ code, includedType: entry.includedType, textQuery: entry.textQuery });
        }
        else {
            unmapped.push(code);
        }
    }
    if (unmapped.length > 0) {
        const supabase = (0, admin_1.createAdminClient)();
        const { data, error } = await supabase
            .from("donor_discovery_taxonomy")
            .select("code, label")
            .eq("kind", "naics")
            .in("code", unmapped);
        const labelsByCode = new Map(error || !data ? [] : data.map((row) => [row.code, row.label]));
        for (const code of unmapped) {
            const label = labelsByCode.get(code);
            if (label) {
                terms.push({ code, textQuery: label });
            }
            else {
                console.warn(`[google-places] No NAICS mapping or taxonomy label found for code "${code}" — skipping.`);
            }
        }
    }
    return terms;
}
// ── Budget guard ─────────────────────────────────────────────────────────────
function currentMonthKey() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthlyBudgetUsd() {
    const raw = process.env.DD_PLACES_MONTHLY_BUDGET_USD;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MONTHLY_BUDGET_USD;
}
async function assertBudgetAvailable(monthKey) {
    const supabase = (0, admin_1.createAdminClient)();
    const { data } = await supabase
        .from("dd_api_spend")
        .select("est_cost_usd")
        .eq("provider", PROVIDER)
        .eq("month", monthKey)
        .maybeSingle();
    const spentUsd = data?.est_cost_usd ?? 0;
    const budget = monthlyBudgetUsd();
    if (spentUsd + COST_PER_REQUEST_USD > budget) {
        throw new DdBudgetExceededError(budget, spentUsd);
    }
}
async function recordSpend(monthKey) {
    const supabase = (0, admin_1.createAdminClient)();
    await supabase.rpc("donor_discovery_increment_api_spend", {
        p_provider: PROVIDER,
        p_month: monthKey,
        p_requests: 1,
        p_cost_usd: COST_PER_REQUEST_USD,
    });
}
// ── Normalization ────────────────────────────────────────────────────────────
function normalizePlace(place, naicsCode) {
    const legalName = place.displayName?.text?.trim();
    if (!legalName)
        return null;
    return {
        legal_name: legalName,
        website: place.websiteUri ?? null,
        hq_address: place.formattedAddress ?? null,
        geo: place.location
            ? { lat: place.location.latitude, lng: place.location.longitude }
            : null,
        phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
        naics_codes: [naicsCode],
        source_adapters: [PROVIDER],
    };
}
async function upsertToDirectory(prospect) {
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
        return record.id;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[google-places] Directory upsert failed for "${prospect.legal_name}": ${message}`);
        return null;
    }
}
// ── Places API call ──────────────────────────────────────────────────────────
async function searchTextPage(apiKey, term, geography, pageToken) {
    const radiusMeters = Math.min(geography.radius_mi * METERS_PER_MILE, MAX_RADIUS_METERS);
    const body = {
        textQuery: term.textQuery,
        pageSize: PAGE_SIZE,
        locationBias: {
            circle: {
                center: { latitude: geography.center.lat, longitude: geography.center.lng },
                radius: radiusMeters,
            },
        },
    };
    if (term.includedType)
        body.includedType = term.includedType;
    if (pageToken)
        body.pageToken = pageToken;
    const response = await fetch(PLACES_SEARCH_TEXT_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": PLACES_FIELD_MASK,
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`Places API Text Search failed (${response.status}) for "${term.textQuery}": ${errorBody.slice(0, 500)}`);
    }
    return (await response.json());
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ── Public entry point ───────────────────────────────────────────────────────
/**
 * Enumerates companies for the given NAICS codes inside `geography`, writes
 * normalized rows into `donor_discovery_directory`, and returns them.
 *
 * Hard-stops (throws `DdBudgetExceededError`) the instant the next request
 * would exceed `DD_PLACES_MONTHLY_BUDGET_USD` (default $200/mo). Prospects
 * already upserted from earlier, successful requests in this call remain in
 * the directory — only further API calls are blocked.
 */
async function enumerate(params) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
        (0, env_1.warnIfMissingOptionalEnv)("GOOGLE_PLACES_API_KEY");
        throw new Error("GOOGLE_PLACES_API_KEY is not set — cannot run the Google Places registry adapter.");
    }
    const geography = requireRadiusGeography(params.geography);
    const searchTerms = await resolveSearchTerms(params.naicsCodes);
    const monthKey = currentMonthKey();
    const prospects = [];
    const directoryIds = [];
    let requestsMade = 0;
    for (const term of searchTerms) {
        let pageToken;
        for (let page = 0; page < MAX_PAGES_PER_TERM; page++) {
            await assertBudgetAvailable(monthKey);
            if (page > 0)
                await sleep(NEXT_PAGE_TOKEN_DELAY_MS);
            const result = await searchTextPage(apiKey, term, geography, pageToken);
            requestsMade += 1;
            await recordSpend(monthKey);
            for (const place of result.places ?? []) {
                const normalized = normalizePlace(place, term.code);
                if (!normalized)
                    continue;
                prospects.push(normalized);
                const id = await upsertToDirectory(normalized);
                if (id)
                    directoryIds.push(id);
            }
            if (!result.nextPageToken)
                break;
            pageToken = result.nextPageToken;
        }
    }
    return {
        prospects,
        directoryIds,
        requestsMade,
        estCostUsd: requestsMade * COST_PER_REQUEST_USD,
    };
}
