// POST /api/donor-discovery/discover — the "Discover" flow's search endpoint
// (src/app/(dashboard)/donor-discovery/discover/page.tsx). Given a single
// NAICS code, a radius, and optional keywords, searches for businesses near
// the caller's organization via the Google Places API (Text Search, same
// endpoint as src/lib/donor-discovery/adapters/google-places.ts) and returns
// up to 50 candidates.
//
// Two modes on the same request shape:
//   - Preview (default): searches and returns the results only. Nothing is
//     written to the database.
//   - Launch (`launch: true`): re-runs the same search, then persists each
//     result into the shared `donor_discovery_directory` (via
//     upsertDirectoryRecord) and creates prospects for the caller's org under
//     a new `donor_discovery_requests` row marked `complete` immediately —
//     this bypasses the async worker pipeline (worker/dd-request-processor.ts)
//     entirely, since enumeration already happened synchronously above.
//     `taxonomy_ids` is left empty: the curated codes in naics-labels.ts
//     (including 3-digit subsector codes like "524") don't reliably resolve
//     to rows in `donor_discovery_taxonomy` (seeded only with 6-digit NAICS
//     codes), and the column has no FK constraint, so an empty array is
//     honest rather than a fabricated link.
//
// organization_id is always derived from the authenticated session
// (requireRole) — the `orgId` field in the request body is accepted per this
// endpoint's contract but is only ever compared against the session's org,
// never trusted on its own (Behavioral Contracts §2).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { geocodeAddress, GeocodingError } from "@/lib/donor-discovery/adapters/geocoding-adapter";
import { naicsLabel } from "@/lib/donor-discovery/naics-labels";
import { upsertDirectoryRecord, findOrCreateProspect } from "@/lib/donor-discovery/directory";

export const runtime = "nodejs";
export const maxDuration = 60;

const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.internationalPhoneNumber",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "nextPageToken",
].join(",");

const METERS_PER_MILE = 1609.34;
const MAX_RADIUS_METERS = 50_000; // Places API hard cap.
const PAGE_SIZE = 20;
const MAX_RESULTS = 50;
const MAX_PAGES = 3; // 3 * 20 = 60, sliced to MAX_RESULTS.
const NEXT_PAGE_TOKEN_DELAY_MS = 2_000; // Google recommends a short delay before a token becomes valid.
const DEFAULT_RADIUS_MI = 25;
const MAX_RADIUS_MI = 100;
const SOURCE_ADAPTER = "discover_ui";

interface DiscoverProspect {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
}

interface PlacesApiPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
}

interface PlacesApiSearchTextResponse {
  places?: PlacesApiPlace[];
  nextPageToken?: string;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePlace(place: PlacesApiPlace): DiscoverProspect | null {
  const name = place.displayName?.text?.trim();
  if (!name) return null;
  return {
    placeId: place.id,
    name,
    address: place.formattedAddress ?? null,
    phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
    website: place.websiteUri ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
  };
}

async function searchTextPage(
  apiKey: string,
  textQuery: string,
  center: { lat: number; lng: number },
  radiusMeters: number,
  pageToken: string | undefined,
): Promise<PlacesApiSearchTextResponse> {
  const body: Record<string, unknown> = {
    textQuery,
    pageSize: PAGE_SIZE,
    locationBias: {
      circle: {
        center: { latitude: center.lat, longitude: center.lng },
        radius: radiusMeters,
      },
    },
  };
  if (pageToken) body.pageToken = pageToken;

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
    throw new Error(`Places API Text Search failed (${response.status}): ${errorBody.slice(0, 500)}`);
  }

  return (await response.json()) as PlacesApiSearchTextResponse;
}

interface OrgAddressRow {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

function buildAddressString(org: OrgAddressRow): string {
  return [org.address_line1, org.address_line2, org.city, org.state, org.zip]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .join(", ");
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const { naicsCode, radius, keywords, orgId, launch } = body as Record<string, unknown>;

  if (typeof naicsCode !== "string" || naicsCode.trim().length === 0) {
    return jsonError("naicsCode is required.", 400);
  }
  if (typeof orgId !== "string" || orgId.trim().length === 0) {
    return jsonError("orgId is required.", 400);
  }
  if (orgId !== organizationId) {
    return jsonError("orgId does not match your organization.", 403);
  }

  const radiusMi =
    typeof radius === "number" && Number.isFinite(radius) && radius > 0
      ? Math.min(radius, MAX_RADIUS_MI)
      : DEFAULT_RADIUS_MI;
  const keywordText = typeof keywords === "string" ? keywords.trim() : "";

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return jsonError("Business search is not configured (GOOGLE_PLACES_API_KEY missing).", 503);
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("address_line1, address_line2, city, state, zip")
    .eq("id", organizationId)
    .single();

  if (orgError || !org) {
    return jsonError("Could not load your organization's address.", 500);
  }

  const addressString = buildAddressString(org as OrgAddressRow);
  if (!addressString) {
    return jsonError(
      "Your organization has no address on file yet — add one in Settings before running Discover.",
      400,
    );
  }

  let center: { lat: number; lng: number };
  try {
    const geocoded = await geocodeAddress(addressString);
    center = { lat: geocoded.lat, lng: geocoded.lng };
  } catch (err) {
    const message = err instanceof GeocodingError ? err.message : "Could not locate your organization.";
    return jsonError(message, 502);
  }

  const textQuery = [naicsLabel(naicsCode), keywordText].filter(Boolean).join(" ");
  const radiusMeters = Math.min(radiusMi * METERS_PER_MILE, MAX_RADIUS_METERS);

  const prospects: DiscoverProspect[] = [];
  const seenPlaceIds = new Set<string>();
  let pageToken: string | undefined;

  try {
    for (let page = 0; page < MAX_PAGES && prospects.length < MAX_RESULTS; page++) {
      if (page > 0) await sleep(NEXT_PAGE_TOKEN_DELAY_MS);

      const result = await searchTextPage(apiKey, textQuery, center, radiusMeters, pageToken);

      for (const place of result.places ?? []) {
        if (prospects.length >= MAX_RESULTS) break;
        const normalized = normalizePlace(place);
        if (!normalized || seenPlaceIds.has(normalized.placeId)) continue;
        seenPlaceIds.add(normalized.placeId);
        prospects.push(normalized);
      }

      if (!result.nextPageToken) break;
      pageToken = result.nextPageToken;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Business search failed.";
    return jsonError(message, 502);
  }

  if (launch !== true) {
    return NextResponse.json({ prospects, count: prospects.length, center });
  }

  const requestName = `${naicsLabel(naicsCode)}${keywordText ? ` — ${keywordText}` : ""} (${radiusMi} mi)`;

  const { data: requestRow, error: requestError } = await supabase
    .from("donor_discovery_requests")
    .insert({
      organization_id: organizationId,
      name: requestName,
      taxonomy_ids: [],
      geography: { center, radius_mi: radiusMi },
      status: "complete",
      counts: { enumerated: prospects.length, enriched: 0, scored: 0 },
      created_by: userId,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (requestError || !requestRow) {
    return jsonError("Failed to save the discovery request.", 500);
  }

  let prospectsCreated = 0;
  for (const prospect of prospects) {
    try {
      const record = await upsertDirectoryRecord({
        legal_name: prospect.name,
        website: prospect.website,
        hq_address: prospect.address,
        geo: prospect.lat != null && prospect.lng != null ? { lat: prospect.lat, lng: prospect.lng } : null,
        phone: prospect.phone,
        naics_codes: [naicsCode],
        source_adapter: SOURCE_ADAPTER,
      });
      const result = await findOrCreateProspect(organizationId, (requestRow as { id: string }).id, record.id);
      if (result.created) prospectsCreated += 1;
    } catch (err) {
      console.warn(
        `[discover] Failed to persist prospect "${prospect.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return NextResponse.json({
    prospects,
    count: prospects.length,
    requestId: (requestRow as { id: string }).id,
    prospectsCreated,
  });
}
