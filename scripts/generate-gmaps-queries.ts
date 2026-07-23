// ============================================================================
// BENAVORA — Google Maps query generator for gosom/google-maps-scraper
//
// Generates input query files for the gosom google-maps-scraper binary.
// Queries are city+state level searches like "nonprofit Austin TX"
// which return 20-120 results per query including name, address, phone,
// website, and email.
//
// TWO MODES:
//   --mode=foundations  Query foundation_directory (133K records)
//   --mode=nonprofits   Query nonprofits table (1.97M records)
//
// OUTPUT: One .txt file per mode, one query per line, ready to pipe into:
//   google-maps-scraper-windows-amd64.exe -input queries-foundations.txt
//     -results results-foundations.csv -email -exit-on-inactivity 3m
//
// Run:
//   npx tsx scripts/generate-gmaps-queries.ts --mode=foundations
//   npx tsx scripts/generate-gmaps-queries.ts --mode=nonprofits
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// ---- Config -----------------------------------------------------------------
const OUTPUT_DIR = path.join(process.cwd(), "scripts", ".gmaps-queries");
const BATCH_SIZE = 1000;

// Google Maps search terms — broader terms catch more listings per query
const FOUNDATION_SEARCH_TERMS = [
  "foundation",
  "charitable foundation",
  "private foundation",
  "community foundation",
  "family foundation",
];

const NONPROFIT_SEARCH_TERMS = [
  "nonprofit organization",
  "charity",
  "501c3",
  "community organization",
  "social services nonprofit",
  "human services nonprofit",
  "youth organization nonprofit",
  "health nonprofit",
  "education nonprofit",
  "housing nonprofit",
];

// Blacklisted domains — skip these in results import later
export const DIRECTORY_DOMAINS = [
  "guidestar.org",
  "charitynavigator.org",
  "give.org",
  "candid.org",
  "propublica.org",
  "irs.gov",
  "facebook.com",
  "linkedin.com",
  "twitter.com",
  "instagram.com",
  "youtube.com",
  "wikipedia.org",
  "google.com",
  "yelp.com",
  "bbb.org",
  "indeed.com",
  "glassdoor.com",
];

// ---- Helpers ----------------------------------------------------------------
function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function parseMode(): "foundations" | "nonprofits" {
  const modeArg = process.argv.find((a) => a.startsWith("--mode="));
  const mode = modeArg?.replace("--mode=", "");
  if (mode !== "foundations" && mode !== "nonprofits") {
    console.error("Usage: npx tsx scripts/generate-gmaps-queries.ts --mode=foundations|nonprofits");
    process.exit(1);
  }
  return mode;
}

interface CityState {
  city: string;
  state: string;
  count: number;
}

async function getFoundationCities(db: ReturnType<typeof createClient>): Promise<CityState[]> {
  // Get distinct city+state combinations from foundation_directory
  // where website is null (unenriched) — these are our targets
  const cities: CityState[] = [];
  let offset = 0;

  log("Fetching distinct city+state combinations from foundation_directory...");

  while (true) {
    const { data, error } = await db
      .from("foundation_directory")
      .select("city, state")
      .is("website", null)
      .not("city", "is", null)
      .not("state", "is", null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error("DB error:", error);
      break;
    }
    if (!data || data.length === 0) break;

    // Aggregate city+state counts
    for (const row of data) {
      const city = (row.city as string).trim();
      const state = (row.state as string).trim().toUpperCase();
      if (!city || !state || city.length < 2) continue;
      const existing = cities.find((c) => c.city === city && c.state === state);
      if (existing) {
        existing.count++;
      } else {
        cities.push({ city, state, count: 1 });
      }
    }

    offset += BATCH_SIZE;
    if (data.length < BATCH_SIZE) break;

    if (offset % 10000 === 0) log(`Scanned ${offset} foundation records...`);
  }

  // Sort by count descending — highest density cities first
  return cities.sort((a, b) => b.count - a.count);
}

async function getNonprofitCities(db: ReturnType<typeof createClient>): Promise<CityState[]> {
  const cities: CityState[] = [];
  let offset = 0;

  log("Fetching distinct city+state combinations from nonprofits...");

  while (true) {
    const { data, error } = await db
      .from("nonprofits")
      .select("city, state")
      .is("website", null)
      .not("city", "is", null)
      .not("state", "is", null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error("DB error:", error);
      break;
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const city = (row.city as string).trim();
      const state = (row.state as string).trim().toUpperCase();
      if (!city || !state || city.length < 2) continue;
      const existing = cities.find((c) => c.city === city && c.state === state);
      if (existing) {
        existing.count++;
      } else {
        cities.push({ city, state, count: 1 });
      }
    }

    offset += BATCH_SIZE;
    if (data.length < BATCH_SIZE) break;

    if (offset % 50000 === 0) log(`Scanned ${offset} nonprofit records...`);
  }

  return cities.sort((a, b) => b.count - a.count);
}

function generateQueries(cities: CityState[], searchTerms: string[]): string[] {
  const queries: Set<string> = new Set();

  for (const { city, state } of cities) {
    for (const term of searchTerms) {
      // Format: "nonprofit organization Austin TX"
      queries.add(`${term} ${city} ${state}`);
    }
  }

  return Array.from(queries);
}

function splitIntoWindows(queries: string[], numWindows: number): string[][] {
  const windows: string[][] = Array.from({ length: numWindows }, () => []);
  queries.forEach((q, i) => {
    windows[i % numWindows].push(q);
  });
  return windows;
}

async function main() {
  const mode = parseMode();
  const searchTerms = mode === "foundations" ? FOUNDATION_SEARCH_TERMS : NONPROFIT_SEARCH_TERMS;
  const numWindows = mode === "foundations" ? 3 : 6; // More windows for larger dataset

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: {} }, realtime: { transport: ws as unknown as typeof WebSocket } }
  );

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Fetch city+state combinations
  const cities =
    mode === "foundations"
      ? await getFoundationCities(db)
      : await getNonprofitCities(db);

  log(`Found ${cities.length} distinct city+state combinations for ${mode}`);

  // Generate queries
  const queries = generateQueries(cities, searchTerms);
  log(`Generated ${queries.length} total queries (${searchTerms.length} search terms × ${cities.length} cities)`);

  // Write single combined file
  const combinedPath = path.join(OUTPUT_DIR, `queries-${mode}-all.txt`);
  fs.writeFileSync(combinedPath, queries.join("\n"), "utf-8");
  log(`Written: ${combinedPath}`);

  // Split into window files for parallel runs
  const windows = splitIntoWindows(queries, numWindows);
  for (let i = 0; i < windows.length; i++) {
    const windowPath = path.join(OUTPUT_DIR, `queries-${mode}-window${i + 1}.txt`);
    fs.writeFileSync(windowPath, windows[i].join("\n"), "utf-8");
    log(`Written: ${windowPath} (${windows[i].length} queries)`);
  }

  // Print launch instructions
  console.log(`
============================================================
QUERY FILES GENERATED — ${mode.toUpperCase()}
============================================================
Total queries: ${queries.length}
Split into: ${numWindows} parallel windows

NEXT STEPS:
1. Download binary from https://github.com/gosom/google-maps-scraper/releases/latest
   Save as: C:\\gmaps-scraper\\google-maps-scraper-windows-amd64.exe

2. Open ${numWindows} PowerShell windows and run one per window:
${windows
  .map(
    (_, i) => `
   Window ${i + 1}:
   cd C:\\gmaps-scraper
   .\\google-maps-scraper-windows-amd64.exe \`
     -input "${OUTPUT_DIR}\\queries-${mode}-window${i + 1}.txt" \`
     -results "${OUTPUT_DIR}\\results-${mode}-window${i + 1}.csv" \`
     -email \`
     -c 4 \`
     -depth 1 \`
     -exit-on-inactivity 5m`
  )
  .join("\n")}

3. After all windows complete, run the import:
   npx tsx scripts/import-gmaps-results.ts --mode=${mode}

BLACKLISTED DOMAINS (filtered during import):
${DIRECTORY_DOMAINS.join(", ")}
============================================================
`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
