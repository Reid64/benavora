// ============================================================================
// BENAVORA — Donation Marketplace test-listing seed script
//
// Seeds 3 realistic marketplace_listings for the real Faith Foundation org
// (b1ab7402-dfc2-4712-869f-70ea3566cc1d, same org used by seed-beta-users.ts
// and referenced throughout AGENT_VERIFICATION_LOG.md), then runs the real,
// unmodified production matcher (src/lib/marketplace/matcher.ts) against
// each — exercising the actual code path, not a simulated SQL insert.
//
// All 3 rows are marked is_seed_data = true for easy cleanup:
//   DELETE FROM marketplace_matches WHERE listing_id IN
//     (SELECT id FROM marketplace_listings WHERE is_seed_data = true);
//   DELETE FROM marketplace_listings WHERE is_seed_data = true;
//
//   pnpm tsx scripts/seed-marketplace-test-listings.ts
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import ws from "ws";

import { runMarketplaceMatching } from "../src/lib/marketplace/matcher";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws as unknown as typeof WebSocket },
});

const FAITH_FOUNDATION_ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";

const TEST_LISTINGS = [
  {
    title: "[TEST] Surplus Office Furniture Donation",
    description: "40 desks, 60 chairs, and 12 filing cabinets from a recent office move.",
    category: "in_kind_donation",
    item_type: "Office furniture",
    quantity: "40 desks, 60 chairs, 12 filing cabinets",
    estimated_value: 12000,
    geographic_scope: "Texas",
  },
  {
    title: "[TEST] Corporate Matching Funds Pool",
    description: "Employee-matched giving pool available for eligible nonprofit partners.",
    category: "corporate_donation",
    item_type: "Cash grant",
    quantity: "One-time disbursement",
    estimated_value: 25000,
    geographic_scope: "Nationwide",
  },
  {
    title: "[TEST] Building Materials for Housing Rehab",
    description: "Lumber, drywall, and roofing materials from a completed construction project.",
    category: "materials_donation",
    item_type: "Construction materials",
    quantity: "2 pallets lumber, 40 sheets drywall, 15 rolls roofing",
    estimated_value: 8000,
    geographic_scope: "Texas",
  },
];

async function main() {
  console.log(`Seeding ${TEST_LISTINGS.length} test listings for org ${FAITH_FOUNDATION_ORG_ID}...\n`);

  for (const listing of TEST_LISTINGS) {
    const { data, error } = await admin
      .from("marketplace_listings")
      .insert({
        organization_id: FAITH_FOUNDATION_ORG_ID,
        title: listing.title,
        description: listing.description,
        category: listing.category,
        item_type: listing.item_type,
        quantity: listing.quantity,
        estimated_value: listing.estimated_value,
        geographic_scope: listing.geographic_scope,
        is_seed_data: true,
      })
      .select("id, organization_id, category, geographic_scope")
      .single();

    if (error || !data) {
      console.error(`  ✗ ${listing.title}: ${error?.message ?? "unknown error"}`);
      continue;
    }

    console.log(`  ✓ Created listing ${data.id}: ${listing.title}`);

    const matches = await runMarketplaceMatching(admin as any, {
      id: data.id as string,
      organization_id: data.organization_id as string,
      category: data.category as string,
      geographic_scope: data.geographic_scope as string | null,
    });

    if (matches.length === 0) {
      console.log(`      (no matching orgs found for this listing)`);
    } else {
      for (const m of matches) {
        console.log(`      matched org ${m.organizationId}: ${m.reasons.join(", ")}`);
      }
    }
  }

  console.log("\nDone. To clean up:");
  console.log(
    "  DELETE FROM marketplace_matches WHERE listing_id IN (SELECT id FROM marketplace_listings WHERE is_seed_data = true);",
  );
  console.log("  DELETE FROM marketplace_listings WHERE is_seed_data = true;");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
