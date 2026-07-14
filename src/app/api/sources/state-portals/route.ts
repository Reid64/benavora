import { NextResponse } from "next/server";

import { STATE_PORTAL_CONFIGS } from "@/lib/sources/state-portals/portal-config";
import { scrapePortal } from "@/lib/sources/state-portals/portal-scraper";

// State grant portal scraping endpoint.
//
// GET /api/sources/state-portals?state=TX
//
// Looks up the requested state's PortalConfig from the static
// STATE_PORTAL_CONFIGS list and scrapes it on demand. Unlike the
// grants.gov/sam.gov sources this does not persist to `opportunities` —
// it's a read-only preview of what the scraper currently sees for a portal
// (state portal markup drifts without notice, BLUEPRINT.md §15).

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");

  if (!state) {
    return jsonError("state is required.", "missing_state", 400);
  }

  const config = STATE_PORTAL_CONFIGS.find(
    (c) => c.state.toLowerCase() === state.toLowerCase(),
  );

  if (!config) {
    return jsonError(`No portal configured for state "${state}".`, "unknown_state", 404);
  }

  const results = await scrapePortal(config);

  return NextResponse.json({
    state: config.state,
    portalName: config.portalName,
    count: results.length,
    results,
  });
}
