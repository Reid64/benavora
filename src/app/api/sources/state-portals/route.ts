import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
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
//
// WGR-155 fix (2026-08-22): this route is user-triggered (called from
// /settings/state-portals, not one of vercel.json's crons[] entries — see
// WIRING_GAP_REGISTER.md), not cron-triggered, so the fix here is
// `requireRole()` (matching every other user-triggered route in this
// codebase), not a CRON_SECRET bearer check (that pattern is for
// src/middleware.ts's SECRET_GATED_PATHS, real external callers with no
// session cookie — Vercel Cron / webhook delivery — which this route is
// not). Previously had zero auth check of any kind in the handler itself;
// the only protection was src/middleware.ts's default session requirement,
// which blocks anonymous callers but not any authenticated user of any role
// in any organization triggering an outbound scrape of an arbitrary
// configured state portal. `requireRole("viewer")` matches this route's
// read-only/preview nature (no data persisted) and the gate every other
// GET route in `src/app/api/donor-discovery/` already uses for the same
// reason.

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

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
