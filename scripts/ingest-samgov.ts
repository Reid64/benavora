// ============================================================================
// BENAVORA — SAM.gov donor discovery ingest
//
// Drives src/lib/donor-discovery/adapters/samgov-adapter.ts across a curated
// list of ~50 NAICS codes most relevant to nonprofit in-kind donor discovery
// (DONOR_DISCOVERY_ARCHITECTURE.md §0 Faith Foundation validation case:
// construction trades / site-development, professional services, food
// service, and transportation), then a single recent-award-recipients sweep.
//
// Each NAICS code is an independent SAM.gov Entity Management API call —
// failures are logged and skipped rather than halting the run, since a
// single bad code shouldn't block the other 49 (unlike ingest-irs-bmf-full.ts,
// this is a small, bounded list re-run in seconds-to-minutes, not a
// multi-hour job, so no on-disk checkpoint is needed).
//
// Rate limiting (450 req/min, shared across both SAM.gov endpoints) lives
// inside the adapter, not here — this script just drives it code by code.
//
//   pnpm ingest:samgov
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import {
  searchEntitiesByNaics,
  searchRecentAwardRecipients,
  SamGovError,
} from "../src/lib/donor-discovery/adapters/samgov-adapter";

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

// ----------------------------------------------------------------------------
// Config — top 50 NAICS codes most relevant to nonprofit in-kind donor
// discovery, grouped by category for readability. Source of truth for labels:
// the 2022 NAICS titles already seeded into donor_discovery_taxonomy by
// scripts/seed-dd-taxonomy.ts — repeated here only as comments, not looked up,
// so this script has no dependency on the taxonomy table being seeded first.
// ----------------------------------------------------------------------------
interface NaicsTarget {
  code: string;
  label: string;
  category: string;
}

const NAICS_TARGETS: NaicsTarget[] = [
  // ── Construction trades ──────────────────────────────────────────────────
  { code: "236115", label: "New Single-Family Housing Construction", category: "construction_trades" },
  { code: "236118", label: "Residential Remodelers", category: "construction_trades" },
  { code: "236220", label: "Commercial and Institutional Building Construction", category: "construction_trades" },
  { code: "237110", label: "Water and Sewer Line and Related Structures Construction", category: "construction_trades" },
  { code: "238110", label: "Poured Concrete Foundation and Structure Contractors", category: "construction_trades" },
  { code: "238120", label: "Structural Steel and Precast Concrete Contractors", category: "construction_trades" },
  { code: "238140", label: "Masonry Contractors", category: "construction_trades" },
  { code: "238150", label: "Glass and Glazing Contractors", category: "construction_trades" },
  { code: "238160", label: "Roofing Contractors", category: "construction_trades" },
  { code: "238170", label: "Siding Contractors", category: "construction_trades" },
  { code: "238210", label: "Electrical Contractors and Other Wiring Installation Contractors", category: "construction_trades" },
  { code: "238220", label: "Plumbing, Heating, and Air-Conditioning Contractors", category: "construction_trades" },
  { code: "238310", label: "Drywall and Insulation Contractors", category: "construction_trades" },
  { code: "238320", label: "Painting and Wall Covering Contractors", category: "construction_trades" },
  { code: "238330", label: "Flooring Contractors", category: "construction_trades" },

  // ── Site development & materials (BLUEPRINT.md Faith Foundation case) ────
  { code: "238910", label: "Site Preparation Contractors", category: "site_development" },
  { code: "562991", label: "Septic Tank and Related Services", category: "site_development" },
  { code: "561740", label: "Carpet and Upholstery Cleaning Services", category: "site_development" },
  { code: "444180", label: "Other Building Material Dealers", category: "site_development" },
  { code: "336111", label: "Automobile Manufacturing", category: "site_development" },

  // ── Professional services ────────────────────────────────────────────────
  { code: "541110", label: "Offices of Lawyers", category: "professional_services" },
  { code: "541211", label: "Offices of Certified Public Accountants", category: "professional_services" },
  { code: "541310", label: "Architectural Services", category: "professional_services" },
  { code: "541330", label: "Engineering Services", category: "professional_services" },
  { code: "541511", label: "Custom Computer Programming Services", category: "professional_services" },
  { code: "541611", label: "Administrative Management and General Management Consulting Services", category: "professional_services" },
  { code: "541618", label: "Other Management Consulting Services", category: "professional_services" },
  { code: "541690", label: "Other Scientific and Technical Consulting Services", category: "professional_services" },
  { code: "541810", label: "Advertising Agencies", category: "professional_services" },
  { code: "541990", label: "All Other Professional, Scientific, and Technical Services", category: "professional_services" },

  // ── Food service ──────────────────────────────────────────────────────────
  { code: "311811", label: "Retail Bakeries", category: "food_service" },
  { code: "424420", label: "Packaged Frozen Food Merchant Wholesalers", category: "food_service" },
  { code: "445110", label: "Supermarkets and Other Grocery (except Convenience) Stores", category: "food_service" },
  { code: "445120", label: "Convenience Stores", category: "food_service" },
  { code: "722320", label: "Caterers", category: "food_service" },
  { code: "722410", label: "Drinking Places (Alcoholic Beverages)", category: "food_service" },
  { code: "722511", label: "Full-Service Restaurants", category: "food_service" },
  { code: "722513", label: "Limited-Service Restaurants", category: "food_service" },
  { code: "722514", label: "Cafeterias, Grill Buffets, and Buffets", category: "food_service" },
  { code: "722515", label: "Snack and Nonalcoholic Beverage Bars", category: "food_service" },

  // ── Transportation ────────────────────────────────────────────────────────
  { code: "484110", label: "General Freight Trucking, Local", category: "transportation" },
  { code: "484121", label: "General Freight Trucking, Long-Distance, Truckload", category: "transportation" },
  { code: "484122", label: "General Freight Trucking, Long-Distance, Less Than Truckload", category: "transportation" },
  { code: "485210", label: "Interurban and Rural Bus Transportation", category: "transportation" },
  { code: "485410", label: "School and Employee Bus Transportation", category: "transportation" },
  { code: "485510", label: "Charter Bus Industry", category: "transportation" },
  { code: "487990", label: "Scenic and Sightseeing Transportation, Other", category: "transportation" },
  { code: "492110", label: "Couriers and Express Delivery Services", category: "transportation" },
  { code: "493110", label: "General Warehousing and Storage", category: "transportation" },
  { code: "447110", label: "Gasoline Stations with Convenience Stores", category: "transportation" },
];

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  if (!process.env.SAM_GOV_API_KEY) {
    fatal("SAM_GOV_API_KEY is not set in .env.local — cannot call the SAM.gov API.");
  }

  console.log(`Ingesting ${NAICS_TARGETS.length} NAICS codes from SAM.gov Entity Management API ...\n`);

  let totalEntities = 0;
  let codesFailed = 0;

  for (const target of NAICS_TARGETS) {
    try {
      const prospects = await searchEntitiesByNaics(target.code);
      totalEntities += prospects.length;
      ok(`${target.category} / ${target.code}`, `${target.label} — ${prospects.length} entity(ies) upserted`);
    } catch (error) {
      codesFailed++;
      fail(`${target.category} / ${target.code} (${target.label})`, error);
    }
  }

  console.log(`\nEntity sweep complete: ${totalEntities} entities upserted across ${NAICS_TARGETS.length - codesFailed}/${NAICS_TARGETS.length} codes.`);
  if (codesFailed > 0) {
    console.warn(`  ${codesFailed} code(s) failed — see errors above. Re-run to retry (upserts are idempotent).`);
  }

  console.log(`\nSearching for recent federal award recipients (last 90 days) ...`);
  let awardees: Awaited<ReturnType<typeof searchRecentAwardRecipients>> = [];
  try {
    awardees = await searchRecentAwardRecipients(90);
    ok("award recipients", `${awardees.length} awardee(s) upserted`);
  } catch (error) {
    fail("award recipients", error);
  }

  console.log(
    `\nDone. ${totalEntities + awardees.length} total donor_discovery_directory row(s) upserted this run.`,
  );
}

main().catch((error) => {
  if (error instanceof SamGovError) {
    fatal(error.message);
  }
  fatal(error instanceof Error ? error.message : String(error));
});
