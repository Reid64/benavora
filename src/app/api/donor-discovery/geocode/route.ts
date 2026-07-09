// POST /api/donor-discovery/geocode — resolves a free-text address into
// {lat, lng} for the Donor Discovery "New Discovery" wizard's radius
// geography step (DONOR_DISCOVERY_ARCHITECTURE.md §4). Server-only:
// GOOGLE_PLACES_API_KEY never reaches the browser. Uses the same Places API
// (New) Text Search endpoint as the enumeration adapter
// (src/lib/donor-discovery/adapters/google-places.ts), restricted to a
// single best match.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = "places.formattedAddress,places.location";

interface PlacesGeocodeResponse {
  places?: Array<{
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
  }>;
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { address } = body as Record<string, unknown>;
  if (typeof address !== "string" || address.trim().length === 0) {
    return NextResponse.json({ error: "address is required." }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Address geocoding is not configured (GOOGLE_PLACES_API_KEY missing)." },
      { status: 503 },
    );
  }

  let response: Response;
  try {
    response = await fetch(PLACES_SEARCH_TEXT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: address.trim(), pageSize: 1 }),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach the geocoding service." }, { status: 502 });
  }

  if (!response.ok) {
    return NextResponse.json({ error: "Geocoding request failed." }, { status: 502 });
  }

  const data = (await response.json().catch(() => null)) as PlacesGeocodeResponse | null;
  const place = data?.places?.[0];

  if (!place?.location) {
    return NextResponse.json({ error: "No matching address found." }, { status: 404 });
  }

  return NextResponse.json({
    lat: place.location.latitude,
    lng: place.location.longitude,
    formatted_address: place.formattedAddress ?? address.trim(),
  });
}
