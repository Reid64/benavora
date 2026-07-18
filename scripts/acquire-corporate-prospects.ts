// ============================================================================
// BENAVORA — corporate prospect acquisition runner (Google Places)
//
// Drives src/lib/sources/corporate-acquisition-adapter.ts's
// acquireFromGooglePlaces() across the 20 NAICS categories most likely to
// yield donation-capable corporate prospects for the shared
// `corporate_prospects` table (SCHEMA_REGISTRY_v2.md #36), statewide across
// Texas (Faith Foundation's primary service geography — BLUEPRINT_v2.md §1).
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

const LOCATION = "Texas";
const RADIUS_METERS = 50_000;
const DELAY_BETWEEN_CALLS_MS = 200;

interface TargetSearch {
  naicsCode: string;
  friendlyName: string;
  searchTerms: string[];
}

const TARGET_SEARCHES: TargetSearch[] = [
  {
    naicsCode: "236220",
    friendlyName: "Construction Companies",
    searchTerms: ["construction company", "general contractor", "commercial builder"],
  },
  {
    naicsCode: "444180",
    friendlyName: "Building Material Suppliers",
    searchTerms: ["building material supplier", "lumber yard", "building supply store"],
  },
  {
    naicsCode: "238160",
    friendlyName: "Roofing Contractors",
    searchTerms: ["roofing contractor", "roofing company"],
  },
  {
    naicsCode: "238220",
    friendlyName: "Plumbing Contractors",
    searchTerms: ["plumbing contractor", "plumbing company"],
  },
  {
    naicsCode: "238210",
    friendlyName: "Electrical Contractors",
    searchTerms: ["electrical contractor", "electrician company"],
  },
  {
    naicsCode: "441110",
    friendlyName: "Auto Dealers",
    searchTerms: ["car dealership", "auto dealer"],
  },
  {
    naicsCode: "442110",
    friendlyName: "Furniture Dealers",
    searchTerms: ["furniture store", "furniture dealer"],
  },
  {
    naicsCode: "443142",
    friendlyName: "Computer Retailers",
    searchTerms: ["computer store", "electronics retailer"],
  },
  {
    naicsCode: "423450",
    friendlyName: "Medical Equipment Suppliers",
    searchTerms: ["medical equipment supplier", "medical supply company"],
  },
  {
    naicsCode: "311",
    friendlyName: "Food Manufacturers",
    searchTerms: ["food manufacturer", "food production company"],
  },
  {
    naicsCode: "424410",
    friendlyName: "Grocery Distributors",
    searchTerms: ["grocery distributor", "food wholesaler"],
  },
  {
    naicsCode: "522",
    friendlyName: "Banks",
    searchTerms: ["bank", "community bank", "credit union"],
  },
  {
    naicsCode: "524",
    friendlyName: "Insurance Companies",
    searchTerms: ["insurance company", "insurance agency"],
  },
  {
    naicsCode: "531",
    friendlyName: "Real Estate Companies",
    searchTerms: ["real estate company", "real estate brokerage"],
  },
  {
    naicsCode: "561320",
    friendlyName: "Staffing Agencies",
    searchTerms: ["staffing agency", "employment agency"],
  },
  {
    naicsCode: "562",
    friendlyName: "Waste Management Companies",
    searchTerms: ["waste management company", "trash removal service"],
  },
  {
    naicsCode: "488510",
    friendlyName: "Logistics Companies",
    searchTerms: ["logistics company", "freight company"],
  },
  {
    naicsCode: "622110",
    friendlyName: "Healthcare Systems",
    searchTerms: ["hospital system", "healthcare system"],
  },
  {
    naicsCode: "541511",
    friendlyName: "Technology Companies",
    searchTerms: ["technology company", "software company"],
  },
  {
    naicsCode: "541",
    friendlyName: "Professional Services Firms",
    searchTerms: ["professional services firm", "consulting firm"],
  },
];

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
    fatal("Missing GOOGLE_PLACES_API_KEY");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    // ws's WebSocket type isn't structurally identical to realtime-js's
    // WebSocketLikeConstructor (event handler signatures differ); runtime
    // behavior is unaffected. Same pattern as scripts/poll-federal-grants.ts.
    realtime: { transport: ws as any },
  });

  console.log("Corporate prospect acquisition — Google Places\n");
  console.log(`  Categories: ${TARGET_SEARCHES.length}`);
  console.log(`  Location:   ${LOCATION} (radius ${RADIUS_METERS}m)\n`);

  let totalAcquired = 0;

  for (const [index, search] of TARGET_SEARCHES.entries()) {
    const position = `${index + 1}/${TARGET_SEARCHES.length}`;
    try {
      const inserted = await acquireFromGooglePlaces(
        search.naicsCode,
        LOCATION,
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

    if (index < TARGET_SEARCHES.length - 1) {
      await sleep(DELAY_BETWEEN_CALLS_MS);
    }
  }

  console.log("\nDone.");
  console.log(`  Categories processed: ${TARGET_SEARCHES.length}`);
  console.log(`  Total prospects acquired: ${totalAcquired}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
