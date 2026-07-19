// Corporate prospect acquisition adapters — pull raw business records from
// external sources into the shared `corporate_prospects` table
// (SCHEMA_REGISTRY_v2.md #36). corporate_prospects has no organization_id —
// it's a shared table across all orgs (BLUEPRINT_v2.md §4.4) — so these
// adapters take no org scoping.
//
// Unlike the thin fetch+map clients in this directory (grantsgov-client.ts,
// samgov-client.ts), these adapters own persistence and dedup themselves,
// per their call site's contract: they take a `supabase` client and return
// the count of newly inserted prospects.
//
// API keys are read from env (GOOGLE_PLACES_API_KEY, SAM_GOV_API_KEY —
// already the established names for these two services elsewhere in the
// codebase) rather than hardcoded, consistent with every other source
// adapter and BLUEPRINT_v2.md §11 ("never expose to client" / never commit
// live credentials to source).

import { naicsLabel } from "@/lib/donor-discovery/naics-labels";

const PLACES_TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const PLACES_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";
const SAM_GOV_ENTITY_URL = "https://api.sam.gov/entity-information/v3/entities";

interface GooglePlaceResult {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  rating?: number;
  types?: string[];
  geometry?: { location?: { lat?: number; lng?: number } };
}

interface GooglePlacesTextSearchResponse {
  results?: GooglePlaceResult[];
  status?: string;
}

// Legacy Text Search returns only `formatted_address` (no structured
// address_components — that requires a separate Place Details call), so city
// and state are recovered heuristically from the standard US format
// "Street, City, ST ZIP, Country".
function extractCity(formattedAddress: string | undefined): string | null {
  if (!formattedAddress) return null;
  const parts = formattedAddress.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  return parts[parts.length - 3] || null;
}

function extractState(formattedAddress: string | undefined): string | null {
  if (!formattedAddress) return null;
  const parts = formattedAddress.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const stateZip = parts[parts.length - 2];
  if (!stateZip) return null;
  const match = /^([A-Z]{2})\s+\d{5}(-\d{4})?$/.exec(stateZip);
  return match?.[1] ?? null;
}

// Legacy Text Search never returns `website`/`formatted_phone_number` (those
// require the Details endpoint's `fields` mask) — fetched once per newly
// discovered place only, to keep quota cost proportional to new records
// rather than to search volume.
async function fetchPlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<{ website: string | null; phone: string | null }> {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: "website,formatted_phone_number",
    key: apiKey,
  });
  try {
    const response = await fetch(`${PLACES_DETAILS_URL}?${params.toString()}`, {
      method: "GET",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { website: null, phone: null };
    const body = (await response.json()) as {
      result?: { website?: string; formatted_phone_number?: string };
    };
    return {
      website: body.result?.website ?? null,
      phone: body.result?.formatted_phone_number ?? null,
    };
  } catch {
    return { website: null, phone: null };
  }
}

/**
 * Searches Google Places Text Search for businesses matching a NAICS
 * category near a location, and inserts any not already tracked in
 * `corporate_prospects` (deduped on `enrichment->>google_place_id`).
 * Returns the count of newly inserted prospects. Non-fatal: returns 0 on any
 * missing config or request failure rather than throwing.
 */
export async function acquireFromGooglePlaces(
  naicsCode: string,
  location: string,
  radius: number,
  supabase: any,
): Promise<number> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return 0;

  const query = `${naicsLabel(naicsCode)} near ${location}`;
  const params = new URLSearchParams({
    query,
    radius: String(radius),
    key: apiKey,
  });

  let response: Response;
  try {
    response = await fetch(`${PLACES_TEXT_SEARCH_URL}?${params.toString()}`, {
      method: "GET",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return 0;
  }
  if (!response.ok) return 0;

  let body: GooglePlacesTextSearchResponse;
  try {
    body = (await response.json()) as GooglePlacesTextSearchResponse;
  } catch {
    return 0;
  }

  const results = Array.isArray(body.results) ? body.results : [];
  let inserted = 0;

  for (const result of results) {
    const placeId = result.place_id;
    const name = result.name?.trim();
    if (!placeId || !name) continue;

    const { data: existing } = await supabase
      .from("corporate_prospects")
      .select("id")
      .eq("enrichment->>google_place_id", placeId)
      .maybeSingle();
    if (existing) continue;

    const details = await fetchPlaceDetails(placeId, apiKey);

    const { error } = await supabase.from("corporate_prospects").insert({
      legal_name: name,
      website: details.website,
      phone: details.phone,
      address_street: result.formatted_address ?? null,
      address_city: extractCity(result.formatted_address),
      address_state: extractState(result.formatted_address),
      address_lat: result.geometry?.location?.lat ?? null,
      address_lng: result.geometry?.location?.lng ?? null,
      naics_code: naicsCode,
      industry_category: naicsLabel(naicsCode),
      source_adapters: ["google_places"],
      enrichment: {
        google_place_id: placeId,
        rating: result.rating ?? null,
        google_types: result.types ?? [],
      },
    });
    if (!error) inserted += 1;
  }

  return inserted;
}

interface SamGovPhysicalAddress {
  addressLine1?: string;
  city?: string;
  stateOrProvinceCode?: string;
  zipCode?: string;
}

interface SamGovNaicsEntry {
  naicsCode?: string;
  naicsDescription?: string;
}

interface SamGovEntity {
  entityRegistration?: {
    ueiSAM?: string;
    legalBusinessName?: string;
  };
  coreData?: {
    physicalAddress?: SamGovPhysicalAddress;
    businessTypes?: {
      naicsList?: SamGovNaicsEntry[];
    };
  };
}

interface SamGovEntityResponse {
  entityData?: SamGovEntity[];
}

/**
 * Searches the SAM.gov Entity Management API for active, non-federal
 * registrants (`purposeOfRegistrationCode=Z2`) matching a keyword, and
 * inserts any not already tracked in `corporate_prospects` (deduped on
 * `enrichment->>sam_uei`). Returns the count of newly inserted prospects.
 * Non-fatal: returns 0 on any missing config or request failure rather than
 * throwing.
 */
export async function acquireFromSAMGov(keywords: string, supabase: any): Promise<number> {
  const apiKey = process.env.SAM_GOV_API_KEY;
  if (!apiKey) return 0;

  const params = new URLSearchParams({
    api_key: apiKey,
    purposeOfRegistrationCode: "Z2",
    registrationStatus: "A",
    q: keywords,
    limit: "100",
  });

  let response: Response;
  try {
    response = await fetch(`${SAM_GOV_ENTITY_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return 0;
  }
  if (!response.ok) return 0;

  let body: SamGovEntityResponse;
  try {
    body = (await response.json()) as SamGovEntityResponse;
  } catch {
    return 0;
  }

  const entities = Array.isArray(body.entityData) ? body.entityData : [];
  let inserted = 0;

  for (const entity of entities) {
    const uei = entity.entityRegistration?.ueiSAM;
    const legalName = entity.entityRegistration?.legalBusinessName?.trim();
    if (!uei || !legalName) continue;

    const { data: existing } = await supabase
      .from("corporate_prospects")
      .select("id")
      .eq("enrichment->>sam_uei", uei)
      .maybeSingle();
    if (existing) continue;

    const address = entity.coreData?.physicalAddress;
    const naics = entity.coreData?.businessTypes?.naicsList?.[0];

    const { error } = await supabase.from("corporate_prospects").insert({
      legal_name: legalName,
      address_street: address?.addressLine1 ?? null,
      address_city: address?.city ?? null,
      address_state: address?.stateOrProvinceCode ?? null,
      address_zip: address?.zipCode ?? null,
      naics_code: naics?.naicsCode ?? null,
      naics_description: naics?.naicsDescription ?? null,
      source_adapters: ["sam_gov"],
      enrichment: { sam_uei: uei },
    });
    if (!error) inserted += 1;
  }

  return inserted;
}
