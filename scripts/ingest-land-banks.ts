// ============================================================================
// BENAVORA — Center for Community Progress land bank directory ingest
//
// Drives src/lib/donor-discovery/adapters/land-bank-adapter.ts against the
// single public land bank directory page (DONOR_DISCOVERY_ARCHITECTURE.md
// §1B, §2A layer 4 "Civic directories ... scraped once, refreshed quarterly
// by cron"). Unlike the registry-layer ingests (ingest-samgov.ts,
// ingest-tx-tdlr.ts), there's no list of codes/types to loop over — one page,
// one fetch, one batch of upserts.
//
// Compliance (kill switch, ToS registry, robots.txt, per-domain rate limit)
// lives inside crawler-core.ts's fetchCompliant, called from the adapter.
//
//   pnpm ingest:landbanks
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { LandBankDirectoryError, fetchLandBankDirectory } from "../src/lib/donor-discovery/adapters/land-bank-adapter";

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

async function main() {
  console.log("Ingesting the Center for Community Progress land bank directory ...\n");

  const prospects = await fetchLandBankDirectory();

  console.log(`\nDone. ${prospects.length} donor_discovery_directory row(s) upserted (civic_kind = 'land_bank').`);
}

main().catch((error) => {
  if (error instanceof LandBankDirectoryError) {
    fatal(error.message);
  }
  fatal(error instanceof Error ? error.message : String(error));
});
