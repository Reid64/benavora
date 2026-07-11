// ============================================================================
// BENAVORA — Texas Department of Licensing and Regulation (TDLR) donor
// discovery ingest
//
// Drives src/lib/donor-discovery/adapters/tx-tdlr-adapter.ts across all five
// license types relevant to the Faith Foundation site-development validation
// case (DONOR_DISCOVERY_ARCHITECTURE.md §0, §2A): Electrical (ELEC), Plumbing
// (PLMB), HVAC (HVAC), Elevator (ELEV), and Boiler (BLRP).
//
// Each license type is an independent TDLR Lookup.aspx fetch — failures are
// logged and skipped rather than halting the run, since a single bad license
// type shouldn't block the other four (same posture as ingest-samgov.ts).
//
// Compliance (kill switch, ToS registry, robots.txt, per-domain rate limit)
// lives inside crawler-core.ts's fetchCompliant, called from the adapter —
// this script just drives it type by type.
//
//   pnpm ingest:tdlr
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import {
  NAICS_BY_LICENSE_TYPE,
  TDLR_LICENSE_TYPES,
  TdlrError,
  searchLicenseType,
} from "../src/lib/donor-discovery/adapters/tx-tdlr-adapter";

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
  console.log(`Ingesting ${TDLR_LICENSE_TYPES.length} TDLR license types (active licenses only) ...\n`);

  let totalUpserted = 0;
  let typesFailed = 0;

  for (const licenseType of TDLR_LICENSE_TYPES) {
    try {
      const prospects = await searchLicenseType(licenseType);
      totalUpserted += prospects.length;
      ok(
        `${licenseType} (NAICS ${NAICS_BY_LICENSE_TYPE[licenseType]})`,
        `${prospects.length} active licensee(s) upserted`,
      );
    } catch (error) {
      typesFailed++;
      fail(licenseType, error);
    }
  }

  console.log(
    `\nDone. ${totalUpserted} donor_discovery_directory row(s) upserted across ` +
      `${TDLR_LICENSE_TYPES.length - typesFailed}/${TDLR_LICENSE_TYPES.length} license types.`,
  );
  if (typesFailed > 0) {
    console.warn(`  ${typesFailed} license type(s) failed — see errors above. Re-run to retry (upserts are idempotent).`);
  }
}

main().catch((error) => {
  if (error instanceof TdlrError) {
    fatal(error.message);
  }
  fatal(error instanceof Error ? error.message : String(error));
});
