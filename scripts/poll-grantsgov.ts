// ============================================================================
// BENAVORA — Grants.gov manual poll
//
// Manual/ops entry point for the same daily sweep `/api/cron/grantsgov` runs
// on Vercel Cron (BEHAVIORAL_CONTRACTS §33): for every organization with at
// least one active search profile, searches Grants.gov for each profile's
// keywords and upserts hits into `opportunities` via
// src/lib/sources/grantsgov-sync.ts. Useful for backfilling before the first
// scheduled run, or re-running by hand without waiting for the cron window.
//
//   pnpm poll:grantsgov
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";
import {
  listActiveGrantsGovOrgIds,
  syncGrantsGovForOrg,
} from "../src/lib/sources/grantsgov-sync";

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

async function main() {
  const admin = createAdminClient();
  const orgIds = await listActiveGrantsGovOrgIds(admin);

  if (orgIds.length === 0) {
    console.log("No organizations with active search profiles — nothing to poll.");
    return;
  }

  console.log(`Polling Grants.gov for ${orgIds.length} organization(s) ...\n`);

  let totalNew = 0;
  let totalUpdated = 0;
  let orgsFailed = 0;

  for (const organizationId of orgIds) {
    try {
      const result = await syncGrantsGovForOrg(admin, organizationId);
      totalNew += result.newCount;
      totalUpdated += result.updatedCount;
      ok(
        organizationId,
        `${result.keywordsSearched} keyword(s) searched — ${result.newCount} new, ${result.updatedCount} updated`,
      );
    } catch (error) {
      orgsFailed++;
      fail(organizationId, error);
    }
  }

  console.log(
    `\nDone. ${totalNew} new, ${totalUpdated} updated across ${orgIds.length - orgsFailed}/${orgIds.length} organization(s).`,
  );
  if (orgsFailed > 0) {
    console.warn(`  ${orgsFailed} organization(s) failed — see errors above.`);
  }
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
