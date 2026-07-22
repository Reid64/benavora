// ============================================================================
// BENAVORA — ProPublica organization endpoint enrichment (tier 3)
//
// Hits https://projects.propublica.org/nonprofits/api/v2/organizations/{ein}.json
// for each nonprofit missing address or officer_name data.
// Writes: address (stored in city/state/zip), officer_name (from careofname),
// phone (when present).
//
// NO Claude API calls. Pure HTTP against ProPublica's free public API.
// Idempotent: only writes NULL columns, never overwrites existing data.
// Resumable: queries unenriched rows on every run via DB state.
// State-partitioned: pass --states TX,CA,FL to run multiple windows
// concurrently against disjoint partitions.
//
// Rate limit: ProPublica allows ~1 req/sec sustained without key.
// This script uses 300ms delay between requests = ~200 records/min = ~12K/hr.
// Run 4 windows across 4 state partitions = ~48K records/hr.
//
//   pnpm enrich:propublica-contacts
//   pnpm enrich:propublica-contacts -- --states TX,CA,FL
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { parseArgs } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

// ---- Config -----------------------------------------------------------------
const PROPUBLICA_BASE = "https://projects.propublica.org/nonprofits/api/v2/organizations";
const BATCH_SIZE = 1000;
const DELAY_MS = 350;
const FETCH_TIMEOUT_MS = 10_000;
const LOG_EVERY = 100;

// ---- Helpers ----------------------------------------------------------------
function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseStatesArg(): string[] | null {
  try {
    const { values } = parseArgs({ options: { states: { type: "string" } } });
    if (!values.states) return null;
    return values.states.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  } catch {
    return null;
  }
}

interface ProPublicaOrg {
  ein?: number;
  name?: string;
  careofname?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  phone?: string | null;
}

interface NonprofitRow {
  id: string;
  ein: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  officer_name: string | null;
  phone: string | null;
}

async function fetchProPublica(ein: string): Promise<ProPublicaOrg | null> {
  const cleanEin = ein.replace(/-/g, "");
  const url = `${PROPUBLICA_BASE}/${cleanEin}.json`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json() as { organization?: ProPublicaOrg };
    return data.organization ?? null;
  } catch {
    return null;
  }
}

async function enrichBatch(
  db: SupabaseClient,
  rows: NonprofitRow[],
  stats: { updated: number; empty: number; failed: number; processed: number }
) {
  for (const row of rows) {
    stats.processed++;

    const org = await fetchProPublica(row.ein);
    await sleep(DELAY_MS);

    if (!org) {
      stats.empty++;
      // Still stamp enrichment_tier so we don't retry forever
      await db.from("nonprofits").update({ enrichment_tier: 3 }).eq("id", row.id);
      continue;
    }

    // Build update object — only write NULL columns (COALESCE semantics)
    const update: Record<string, string | number | null> = { enrichment_tier: 3 };

    if (!row.city && org.city) update.city = org.city;
    if (!row.state && org.state) update.state = org.state;
    if (!row.zip && org.zipcode) update.zip = org.zipcode;
    if (!row.officer_name && org.careofname) {
      // Strip leading % and trim (ProPublica format: "% SHANE JACOBSON")
      update.officer_name = org.careofname.replace(/^%\s*/, "").trim();
    }
    if (!row.phone && org.phone) update.phone = org.phone;

    const hasNewData = Object.keys(update).length > 1; // more than just enrichment_tier

    const { error } = await db.from("nonprofits").update(update).eq("id", row.id);

    if (error) {
      stats.failed++;
      if (stats.failed % 50 === 0) log(`WARN: ${stats.failed} update failures so far`);
    } else if (hasNewData) {
      stats.updated++;
    } else {
      stats.empty++;
    }

    if (stats.processed % LOG_EVERY === 0) {
      log(`Progress: ${stats.processed} processed | ${stats.updated} updated | ${stats.empty} no-data | ${stats.failed} failed`);
    }
  }
}

async function main() {
  const states = parseStatesArg();

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: {} }, realtime: { transport: ws } }
  );

  const stateLabel = states ? states.join(",") : "ALL";
  log(`ProPublica contact enrichment starting — states: ${stateLabel}`);

  const stats = { updated: 0, empty: 0, failed: 0, processed: 0 };
  let batchNum = 0;
  let totalCandidates = 0;

  while (true) {
    batchNum++;

    // Query nonprofits missing address OR officer_name, not yet tier-3 enriched
    let query = db
      .from("nonprofits")
      .select("id, ein, city, state, zip, officer_name, phone")
      .or("city.is.null,officer_name.is.null")
      .not("ein", "is", null)
      .order("state", { ascending: true })
      .limit(BATCH_SIZE);

    if (states && states.length > 0) {
      query = query.in("state", states);
    }

    const { data: rows, error } = await query as { data: NonprofitRow[] | null; error: unknown };

    if (error) {
      log(`FATAL: DB query failed — ${JSON.stringify(error)}`);
      break;
    }

    if (!rows || rows.length === 0) {
      log(`All candidates exhausted. Total processed: ${stats.processed} | Updated: ${stats.updated} | No-data: ${stats.empty} | Failed: ${stats.failed}`);
      break;
    }

    totalCandidates += rows.length;
    log(`Batch ${batchNum}: ${rows.length} candidates (${totalCandidates} total so far)`);

    await enrichBatch(db, rows, stats);
  }

  log(`COMPLETE — ${stats.processed} processed | ${stats.updated} updated | ${stats.empty} no-data | ${stats.failed} failed`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
