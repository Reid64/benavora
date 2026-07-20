"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeocodingError = void 0;
exports.geocodeAddress = geocodeAddress;
const crypto_1 = require("crypto");
const admin_1 = require("@/lib/supabase/admin");
const crawler_core_1 = require("@/lib/donor-discovery/crawler-core");
class GeocodingError extends Error {
    constructor(message) {
        super(message);
        this.name = "GeocodingError";
    }
}
exports.GeocodingError = GeocodingError;
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
// A dedicated bucket key, not a real hostname — kept separate from
// crawler-core.ts's per-domain buckets and google-places-adapter.ts's Nearby
// Search bucket, both of which key off the same "maps.googleapis.com" host
// at a much slower 1 req / 5s. Geocoding gets its own 10 req/s allowance.
const RATE_LIMIT_BUCKET = "google-geocoding";
const geocodeRateLimiter = new crawler_core_1.DomainRateLimiter(100); // 1 req / 100ms == 10 req/s
function normalizeAddress(address) {
    return address.trim().toLowerCase().replace(/\s+/g, " ");
}
function addressHash(address) {
    return (0, crypto_1.createHash)("sha256").update(normalizeAddress(address)).digest("hex");
}
async function readCache(hash) {
    const supabase = (0, admin_1.createAdminClient)();
    const { data, error } = await supabase
        .from("donor_discovery_geocache")
        .select("lat, lng, formatted_address, state, county, zip")
        .eq("address_hash", hash)
        .maybeSingle();
    if (error || !data)
        return null;
    return data;
}
async function writeCache(hash, result) {
    const supabase = (0, admin_1.createAdminClient)();
    await supabase.from("donor_discovery_geocache").upsert({
        address_hash: hash,
        lat: result.lat,
        lng: result.lng,
        formatted_address: result.formatted_address,
        state: result.state,
        county: result.county,
        zip: result.zip,
        cached_at: new Date().toISOString(),
    }, { onConflict: "address_hash" });
}
function componentByType(components, type) {
    return components.find((c) => c.types.includes(type));
}
/** Google's `administrative_area_level_2` is usually the county ("Travis
 * County"); `administrative_area_level_1` is the state, returned as its
 * short_name (postal abbreviation) to match STATE_OPTIONS elsewhere in the
 * wizard. Either can be absent for addresses outside the US. */
function extractParts(result) {
    const components = result.address_components ?? [];
    return {
        state: componentByType(components, "administrative_area_level_1")?.short_name ?? null,
        county: componentByType(components, "administrative_area_level_2")?.long_name ?? null,
        zip: componentByType(components, "postal_code")?.long_name ?? null,
    };
}
async function callGeocodingApi(address, apiKey) {
    await geocodeRateLimiter.acquire(RATE_LIMIT_BUCKET);
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("address", address);
    url.searchParams.set("key", apiKey);
    let response;
    try {
        response = await fetch(url.toString());
    }
    catch {
        throw new GeocodingError("Could not reach the Google Geocoding API.");
    }
    if (!response.ok) {
        throw new GeocodingError(`Geocoding HTTP ${response.status}.`);
    }
    const body = (await response.json());
    if (body.status === "ZERO_RESULTS") {
        throw new GeocodingError("No matching address found.");
    }
    const [firstResult] = body.results ?? [];
    if (body.status !== "OK" || !firstResult) {
        throw new GeocodingError(`Geocoding failed (${body.status}): ${body.error_message ?? ""}`);
    }
    return firstResult;
}
// ── Public entry point ───────────────────────────────────────────────────────
/**
 * Resolves `address` to lat/lng + state/county/zip, checking
 * `donor_discovery_geocache` before ever calling the Geocoding API. Throws
 * `GeocodingError` for empty input, no match, or an API/network failure —
 * callers (the geocode route) are expected to translate that into an HTTP
 * response.
 */
async function geocodeAddress(address) {
    const trimmed = address.trim();
    if (!trimmed) {
        throw new GeocodingError("address is required.");
    }
    const hash = addressHash(trimmed);
    const cached = await readCache(hash);
    if (cached) {
        return { ...cached, from_cache: true };
    }
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
        throw new GeocodingError("Address geocoding is not configured (GOOGLE_PLACES_API_KEY missing).");
    }
    const apiResult = await callGeocodingApi(trimmed, apiKey);
    const { state, county, zip } = extractParts(apiResult);
    const result = {
        lat: apiResult.geometry.location.lat,
        lng: apiResult.geometry.location.lng,
        formatted_address: apiResult.formatted_address,
        state,
        county,
        zip,
    };
    await writeCache(hash, result);
    return { ...result, from_cache: false };
}
