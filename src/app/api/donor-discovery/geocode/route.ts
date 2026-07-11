// POST /api/donor-discovery/geocode — resolves a free-text address into
// {lat, lng, formatted_address, state, county, zip} for the Donor Discovery
// "New Discovery" wizard's radius geography step
// (DONOR_DISCOVERY_ARCHITECTURE.md §4). Server-only: GOOGLE_PLACES_API_KEY
// never reaches the browser.
//
// Delegates to src/lib/donor-discovery/adapters/geocoding-adapter.ts, which
// is cache-first against `donor_discovery_geocache` (migration 077) and uses
// the Google Geocoding API (distinct from the Places Text Search endpoint
// used by src/lib/donor-discovery/adapters/google-places.ts).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { geocodeAddress, GeocodingError } from "@/lib/donor-discovery/adapters/geocoding-adapter";

export const runtime = "nodejs";

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

  try {
    const result = await geocodeAddress(address);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof GeocodingError) {
      const status = err.message.includes("not configured")
        ? 503
        : err.message === "No matching address found."
          ? 404
          : 502;
      return NextResponse.json({ error: err.message }, { status });
    }
    return NextResponse.json({ error: "Could not reach the geocoding service." }, { status: 502 });
  }
}
