// ============================================================================
// BENAVORA — corporate prospect acquisition runner (Google Places)
//
// Drives src/lib/sources/corporate-acquisition-adapter.ts's
// acquireFromGooglePlaces() across the 20 NAICS categories most likely to
// yield donation-capable corporate prospects for the shared
// `corporate_prospects` table (SCHEMA_REGISTRY_v2.md #36).
//
// Iterates every onboarded organization (onboarding_completed = true) and
// searches near that org's own service area rather than a single hardcoded
// region, so the sweep covers every subscriber's geography. Falls back to
// the org's city/state, then "United States", when service_area is blank.
//
// corporate_prospects has no organization_id column (it's a shared,
// cross-org table by design — SCHEMA_REGISTRY_v2.md #36, confirmed against
// the adapter's own doc comment) — acquired prospects are not tagged to the
// org whose service area drove the search; they land in the shared pool for
// every org to draw from, same as every other adapter in this file.
//
// acquireFromGooglePlaces builds its own Google Places query text from
// naicsLabel(naicsCode) — it does not accept a custom search string — so
// `searchTerms` below documents the intended query context per category but
// is not passed into the adapter call. All 20 naicsCode values are backed by
// an entry in NAICS_FRIENDLY_LABELS (src/lib/donor-discovery/naics-labels.ts)
// so the derived query text is meaningful.
//
//   pnpm acquire:prospects
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

import { acquireFromGooglePlaces } from "../src/lib/sources/corporate-acquisition-adapter";
import {
  ACQUISITION_RADIUS_METERS,
  TARGET_SEARCHES,
  locationForOrg,
} from "../src/lib/sources/corporate-prospect-categories";

const RADIUS_METERS = ACQUISITION_RADIUS_METERS;
const DELAY_BETWEEN_CALLS_MS = 200;

interface OnboardedOrg {
  id: string;
  name: string;
  service_area: string | null;
  city: string | null;
  state: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.warn("\nWARNING: GOOGLE_PLACES_API_KEY is not set — skipping acquisition run.");
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    // ws's WebSocket type isn't structurally identical to realtime-js's
    // WebSocketLikeConstructor (event handler signatures differ); runtime
    // behavior is unaffected. Same pattern as scripts/poll-federal-grants.ts.
    realtime: { transport: ws as any },
  });

  const { data: orgs, error: orgsError } = await admin
    .from("organizations")
    .select("id, name, service_area, city, state")
    .eq("onboarding_completed", true);

  if (orgsError) {
    fatal(`Failed to load onboarded organizations: ${orgsError.message}`);
  }
  if (!orgs || orgs.length === 0) {
    console.log("No onboarded organizations found (onboarding_completed = true) — nothing to do.");
    return;
  }

  console.log("Corporate prospect acquisition — Google Places\n");
  console.log(`  Organizations: ${orgs.length}`);
  console.log(`  Categories:    ${TARGET_SEARCHES.length} (radius ${RADIUS_METERS}m)\n`);

  let totalAcquired = 0;

  for (const [orgIndex, org] of (orgs as OnboardedOrg[]).entries()) {
    const location = locationForOrg(org);
    console.log(`Org [${orgIndex + 1}/${orgs.length}] ${org.name} — searching near ${location}`);

    for (const [index, search] of TARGET_SEARCHES.entries()) {
      const position = `${index + 1}/${TARGET_SEARCHES.length}`;
      try {
        const inserted = await acquireFromGooglePlaces(
          search.naicsCode,
          location,
          RADIUS_METERS,
          admin,
        );
        totalAcquired += inserted;
        console.log(
          `  [${position}] ✓ ${search.friendlyName} (${search.naicsCode}): ${inserted} new prospects`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  [${position}] ✗ ${search.friendlyName} (${search.naicsCode}): ${message}`);
      }

      await sleep(DELAY_BETWEEN_CALLS_MS);
    }
  }

  console.log("\nDone.");
  console.log(`  Organizations processed: ${orgs.length}`);
  console.log(`  Categories per org:      ${TARGET_SEARCHES.length}`);
  console.log(`  Total prospects acquired: ${totalAcquired}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
