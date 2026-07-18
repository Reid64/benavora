// ============================================================================
// BENAVORA — nonprofits (IRS BMF import) ProPublica financial enrichment,
// state-partitioned parallel worker
//
// Identical to scripts/enrich-nonprofits-bmf-propublica.ts, except the
// query is additionally filtered to a caller-supplied set of state codes
// via --states, so multiple copies of this script can run concurrently
// against disjoint state partitions without racing each other's rows.
//
//   pnpm enrich:nonprofits-parallel --states TX,CA,FL
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { parseArgs } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

const PROPUBLICA_BASE_URL = "https://projects.propublica.org/nonprofits/api/v2/organizations";
const BATCH_SIZE = 500;
const DELAY_MS = 400;
const LOG_EVERY = 500;
const FETCH_TIMEOUT_MS = 15_000;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseStatesArg(): string[] {
  const { values } = parseArgs({
    options: {
      states: { type: "string" },
    },
  });

  if (!values.states) {
    fatal("--states is required, e.g. --states TX,CA,FL");
  }

  const states = values.states
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);

  if (states.length === 0) {
    fatal("--states is required, e.g. --states TX,CA,FL");
  }

  return states;
}

interface NonprofitRow {
  id: string;
  ein: string;
  website: string | null;
}

interface ProPublicaFiling {
  totrevenue?: number | null;
  totassetsend?: number | null;
  employees?: number | null;
}

interface ProPublicaOrganization {
  website?: string | null;
  websiteAddress?: string | null;
  mission?: string | null;
  nteeCode?: string | null;
}

interface ProPublicaResponse {
  organization?: ProPublicaOrganization;
  filings?: ProPublicaFiling[];
}

interface ExtractedFields {
  website: string | null;
  mission: string | null;
  ntee_code: string | null;
  revenue: number | null;
  assets: number | null;
  employee_count: number | null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchProPublica(ein: string): Promise<ExtractedFields | null> {
  const res = await fetch(`${PROPUBLICA_BASE_URL}/${ein}.json`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = (await res.json()) as ProPublicaResponse;
  const org = data.organization;
  if (!org) return null;

  const filing = data.filings?.[0];

  return {
    website: asString(org.websiteAddress) ?? asString(org.website),
    mission: asString(org.mission),
    ntee_code: asString(org.nteeCode),
    revenue: filing ? asNumber(filing.totrevenue) : null,
    assets: filing ? asNumber(filing.totassetsend) : null,
    employee_count: filing ? asNumber(filing.employees) : null,
  };
}

async function fetchNextBatch(admin: SupabaseClient, states: string[]): Promise<NonprofitRow[]> {
  const { data, error } = await admin
    .from("nonprofits")
    .select("id, ein, website")
    .is("last_enriched_at", null)
    .not("ein", "is", null)
    .in("state", states)
    .order("revenue_amount", { ascending: false, nullsFirst: false })
    .limit(BATCH_SIZE);

  if (error) {
    fatal(`could not query nonprofits: ${error.message}`);
  }

  return (data ?? []) as NonprofitRow[];
}

async function main() {
  const states = parseStatesArg();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    // ws's WebSocket type isn't structurally identical to realtime-js's
    // WebSocketLikeConstructor (event handler signatures differ); runtime
    // behavior is unaffected. Same pattern as scripts/batch-score-opportunities.ts.
    realtime: { transport: ws as any },
  });

  console.log("ProPublica financial enrichment — nonprofits table (state-partitioned)");
  console.log(
    `Population: last_enriched_at IS NULL AND ein IS NOT NULL AND state IN (${states.join(", ")}), revenue_amount desc`,
  );
  console.log(`Batch size: ${BATCH_SIZE}, delay: ${DELAY_MS}ms\n`);

  const startedAt = Date.now();
  let processed = 0;
  let enriched = 0;
  let noRecord = 0;
  let failed = 0;

  for (;;) {
    const batch = await fetchNextBatch(admin, states);
    if (batch.length === 0) break;

    for (const row of batch) {
      processed++;

      try {
        const result = await fetchProPublica(row.ein);

        if (!result) {
          noRecord++;
        } else {
          const update: Record<string, unknown> = {
            mission: result.mission,
            employee_count: result.employee_count,
            last_enriched_at: new Date().toISOString(),
            enrichment_tier: 1,
          };

          // Only fill in website when we don't already have one — never
          // clobber tier-1 XML enrichment (scripts/enrich-990-xml.ts).
          if (row.website === null && result.website !== null) {
            update.website = result.website;
          }

          const { error: updateError } = await admin
            .from("nonprofits")
            .update(update)
            .eq("ein", row.ein);

          if (updateError) {
            failed++;
            fail(`update EIN ${row.ein}`, updateError);
          } else {
            enriched++;
            ok(row.ein, `revenue=${result.revenue ?? "n/a"} assets=${result.assets ?? "n/a"}`);
          }
        }
      } catch (err) {
        failed++;
        fail(`enrich EIN ${row.ein}`, err);
      }

      if (processed % LOG_EVERY === 0) {
        const elapsedMin = (Date.now() - startedAt) / 60_000;
        const rate = elapsedMin > 0 ? Math.round(processed / elapsedMin) : 0;
        console.log(
          `  … processed ${processed}, enriched ${enriched}, failed ${failed}, rate ${rate}/min`,
        );
      }

      await sleep(DELAY_MS);
    }
  }

  console.log("\nDone.");
  console.log(`  Rows processed:        ${processed}`);
  console.log(`  Enriched:              ${enriched}`);
  console.log(`  No ProPublica record:  ${noRecord}`);
  console.log(`  Failed:                ${failed}`);
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
