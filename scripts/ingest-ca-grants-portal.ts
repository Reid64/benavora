// ============================================================================
// BENAVORA — California Grants Portal ingestion
//
// Real RSS/XML sweep of https://www.grants.ca.gov/grants/feed/ (WordPress
// feed — NOT an HTML scraper) per STATE_PORTAL_SCOPING_2026-08-13.md §3 #1 /
// §5 item 1. Parses title/link/description/pubDate plus content:encoded's
// Agency/Department Name + Application Close Date, cross-references the
// nonprofit-eligibility signal against the HTML archive's
// `applicant_type-nonprofit` article class (the feed itself doesn't carry
// this field — confirmed live, see ca-grants-portal-client.ts header), and
// syncs new opportunities into `opportunities` for every organization with
// at least one active search profile — the same sweep-population convention
// scripts/poll-grantsgov.ts already uses.
//
// A standalone, new source (source = "ca_grants_portal") — does not touch or
// reconcile portal-scraper.ts/portal-config.ts/state-portal.ts/
// state-scrapers.ts/tdhca-scraper.ts, per the scoping doc's own item 3/5.
//
//   pnpm ingest:ca-grants-portal
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";
import {
  fetchAndTagCaGrantsPortalFeed,
  listActiveCaGrantsPortalOrgIds,
  syncCaGrantsPortalForOrg,
} from "../src/lib/sources/state-portals/ca-grants-portal-sync";

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

async function main() {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    fatal(error instanceof Error ? error.message : String(error));
  }

  console.log("Fetching California Grants Portal RSS feed ...\n");

  let opportunities: Awaited<ReturnType<typeof fetchAndTagCaGrantsPortalFeed>>;
  try {
    opportunities = await fetchAndTagCaGrantsPortalFeed();
  } catch (error) {
    fatal(`Feed fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const nonprofitTagged = opportunities.filter((o) => o.nonprofitEligible === true).length;
  ok(
    "feed fetch",
    `${opportunities.length} grant(s) parsed, ${nonprofitTagged} confirmed nonprofit-eligible via archive cross-reference`,
  );

  if (opportunities.length === 0) {
    console.log("\nNo opportunities parsed from the feed — nothing to sync.");
    return;
  }

  const orgIds = await listActiveCaGrantsPortalOrgIds(admin);
  if (orgIds.length === 0) {
    console.log("\nNo organizations with active search profiles — nothing to sync.");
    return;
  }

  console.log(`\nSyncing into ${orgIds.length} organization(s) ...\n`);

  let totalNew = 0;
  let totalDuplicate = 0;
  let totalFailed = 0;
  let orgsFailed = 0;

  for (const organizationId of orgIds) {
    try {
      const result = await syncCaGrantsPortalForOrg(admin, organizationId, opportunities);
      totalNew += result.newCount;
      totalDuplicate += result.skippedDuplicate;
      totalFailed += result.failed;
      ok(
        organizationId,
        `${result.newCount} new, ${result.skippedDuplicate} already ingested, ${result.failed} failed`,
      );
    } catch (error) {
      orgsFailed++;
      fail(organizationId, error);
    }
  }

  console.log(
    `\nDone. ${totalNew} new, ${totalDuplicate} already ingested, ${totalFailed} failed across ${orgIds.length - orgsFailed}/${orgIds.length} organization(s).`,
  );
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
