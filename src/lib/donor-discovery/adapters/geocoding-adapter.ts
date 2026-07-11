import { createHash } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { DomainRateLimiter } from "@/lib/donor-discovery/crawler-core";

/**
 * Google Geocoding adapter (DONOR_DISCOVERY_ARCHITECTURE.md §4). Resolves a
 * plain-text address to {lat, lng, formatted_address, state, county, zip} for
 * the "New Discovery" wizard's radius-geography step.
 *
 * Cache-first against `donor_discovery_geocache` (migration 077) — a repeat
 * lookup for the same address never touches the paid Geocoding API. Uses the
 * same platform `GOOGLE_PLACES_API_KEY` as the Places registry adapter
 * (Geocoding shares Google Maps Platform billing/keys with Places); there is
 * no per-organization BYOK path here, unlike google-places-adapter.ts —
 * every tenant's wizard resolves addresses through the one platform key.
 *
 * Nothing in this module runs at import time — the admin client and env var
 * are only touched inside `geocodeAddress`, matching the lazy-init
 * convention used by every other donor-discovery module.
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  formatted_address: string;
  state: string | null;
  county: string | null;
  zip: string | null;
  from_cache: boolean;
}

export class GeocodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocodingError";
  }
}

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

// A dedicated bucket key, not a real hostname — kept separate from
// crawler-core.ts's per-domain buckets and google-places-adapter.ts's Nearby
// Search bucket, both of which key off the same "maps.googleapis.com" host
// at a much slower 1 req / 5s. Geocoding gets its own 10 req/s allowance.
const RATE_LIMIT_BUCKET = "google-geocoding";
const geocodeRateLimiter = new DomainRateLimiter(100); // 1 req / 100ms == 10 req/s

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

function addressHash(address: string): string {
  return createHash("sha256").update(normalizeAddress(address)).digest("hex");
}

// ── Cache ─────────────────────────────────────────────────────────────────

interface GeocacheRow {
  lat: number;
  lng: number;
  formatted_address: string;
  state: string | null;
  county: string | null;
  zip: string | null;
}

async function readCache(hash: string): Promise<GeocacheRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("donor_discovery_geocache")
    .select("lat, lng, formatted_address, state, county, zip")
    .eq("address_hash", hash)
    .maybeSingle();

  if (error || !data) return null;
  return data as GeocacheRow;
}

async function writeCache(hash: string, result: Omit<GeocodeResult, "from_cache">): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("donor_discovery_geocache").upsert(
    {
      address_hash: hash,
      lat: result.lat,
      lng: result.lng,
      formatted_address: result.formatted_address,
      state: result.state,
      county: result.county,
      zip: result.zip,
      cached_at: new Date().toISOString(),
    },
    { onConflict: "address_hash" },
  );
}

// ── Google Geocoding API ────────────────────────────────────────────────────

interface GeocodeAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GeocodeApiResult {
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
  address_components: GeocodeAddressComponent[];
}

interface GeocodeApiResponse {
  status: string;
  error_message?: string;
  results?: GeocodeApiResult[];
}

function componentByType(
  components: GeocodeAddressComponent[],
  type: string,
): GeocodeAddressComponent | undefined {
  return components.find((c) => c.types.includes(type));
}

/** Google's `administrative_area_level_2` is usually the county ("Travis
 * County"); `administrative_area_level_1` is the state, returned as its
 * short_name (postal abbreviation) to match STATE_OPTIONS elsewhere in the
 * wizard. Either can be absent for addresses outside the US. */
function extractParts(result: GeocodeApiResult): {
  state: string | null;
  county: string | null;
  zip: string | null;
} {
  const components = result.address_components ?? [];
  return {
    state: componentByType(components, "administrative_area_level_1")?.short_name ?? null,
    county: componentByType(components, "administrative_area_level_2")?.long_name ?? null,
    zip: componentByType(components, "postal_code")?.long_name ?? null,
  };
}

async function callGeocodingApi(address: string, apiKey: string): Promise<GeocodeApiResult> {
  await geocodeRateLimiter.acquire(RATE_LIMIT_BUCKET);

  const url = new URL(GEOCODE_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch {
    throw new GeocodingError("Could not reach the Google Geocoding API.");
  }

  if (!response.ok) {
    throw new GeocodingError(`Geocoding HTTP ${response.status}.`);
  }

  const body = (await response.json()) as GeocodeApiResponse;

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
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
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

  const result: Omit<GeocodeResult, "from_cache"> = {
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
