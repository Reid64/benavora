// POST /api/prospects/acquire — on-demand corporate prospect acquisition for
// the caller's own organization. Same Google Places sweep as
// scripts/acquire-corporate-prospects.ts (all onboarded orgs, nightly), but
// scoped to a single org for a manual "run it now" trigger.
//
// organization_id is always derived from the authenticated session
// (requireRole), never from the request body (Behavioral Contracts §2).
//
// corporate_prospects has no organization_id column — it's a shared,
// cross-org table (SCHEMA_REGISTRY_v2.md #36) — so results land in the
// shared pool rather than being tagged to the caller's org, same as the CLI
// runner and every other adapter in corporate-acquisition-adapter.ts.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { acquireFromGooglePlaces } from "@/lib/sources/corporate-acquisition-adapter";
import {
  ACQUISITION_RADIUS_METERS,
  TARGET_SEARCHES,
  locationForOrg,
} from "@/lib/sources/corporate-prospect-categories";

export const runtime = "nodejs";
export const maxDuration = 290;

const DELAY_BETWEEN_CALLS_MS = 200;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return jsonError("Prospect acquisition is not configured (GOOGLE_PLACES_API_KEY missing).", 503);
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("service_area, city, state")
    .eq("id", organizationId)
    .single();
  if (orgError || !org) {
    return jsonError("Could not load your organization.", 500);
  }

  const location = locationForOrg(org as { service_area: string | null; city: string | null; state: string | null });

  let totalAcquired = 0;
  const categoryResults: { naicsCode: string; friendlyName: string; inserted: number }[] = [];

  for (const [index, search] of TARGET_SEARCHES.entries()) {
    try {
      const inserted = await acquireFromGooglePlaces(
        search.naicsCode,
        location,
        ACQUISITION_RADIUS_METERS,
        supabase,
      );
      totalAcquired += inserted;
      categoryResults.push({ naicsCode: search.naicsCode, friendlyName: search.friendlyName, inserted });
    } catch (err) {
      console.warn(
        `[prospects/acquire] ${search.friendlyName} (${search.naicsCode}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      categoryResults.push({ naicsCode: search.naicsCode, friendlyName: search.friendlyName, inserted: 0 });
    }

    if (index < TARGET_SEARCHES.length - 1) {
      await sleep(DELAY_BETWEEN_CALLS_MS);
    }
  }

  return NextResponse.json({
    message: `Acquisition complete: ${totalAcquired} new prospect${totalAcquired === 1 ? "" : "s"} found near ${location} across ${TARGET_SEARCHES.length} categories.`,
    location,
    totalAcquired,
    categories: categoryResults,
  });
}
