import https from 'https';
import http from 'http';
import readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import type { Database } from '../types/database';

// ---------------------------------------------------------------------------
// IRS EO BMF — national import
// Downloads all state/territory files sequentially and upserts into
// foundation_directory. Set BMF_URL env var to import a single file instead.
//
// State-level file pattern:
//   https://www.irs.gov/pub/irs-soi/eo_XX.csv
// Regional file that includes TX (for reference):
//   eo3.csv (AL, AR, FL, GA, KY, LA, MS, NC, SC, TN, TX)
// ---------------------------------------------------------------------------
const BMF_BASE_URL = 'https://www.irs.gov/pub/irs-soi';

// All 50 states + DC + US territories
const STATE_CODES = [
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga',
  'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md',
  'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj',
  'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc',
  'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy',
  'dc', 'pr', 'vi', 'gu', 'mp', 'as',
];

const BATCH_SIZE = 500;

// IRS EO BMF files have NO header row, so we supply the column names. Order per
// the IRS "Exempt Organizations Business Master File Extract" record layout.
const BMF_HEADERS: readonly string[] = [
  'EIN', 'NAME', 'ICO', 'STREET', 'CITY', 'STATE', 'ZIP', 'GROUP',
  'SUBSECTION', 'AFFILIATION', 'CLASSIFICATION', 'RULING', 'DEDUCTIBILITY',
  'FOUNDATION', 'ACTIVITY', 'ORGANIZATION', 'STATUS', 'TAX_PERIOD',
  'ASSET_CD', 'INCOME_CD', 'FILING_REQD_CD', 'PF_FILING_REQD_CD', 'ACCT_PD',
  'ASSET_AMT', 'INCOME_AMT', 'REVENUE_AMT', 'NTEE_CD', 'SORT_NAME',
];

// ---------------------------------------------------------------------------
// Minimal .env.local parser (tsx does not auto-load .env files)
// ---------------------------------------------------------------------------
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// RFC 4180-compliant CSV line parser
// Uses charAt() so noUncheckedIndexedAccess doesn't widen to string | undefined
// ---------------------------------------------------------------------------
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line.charAt(i);
    if (char === '"') {
      if (inQuotes && line.charAt(i + 1) === '"') {
        current += '"';
        i += 2;
      } else {
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }
  result.push(current.trim());
  return result;
}

// ---------------------------------------------------------------------------
// HTTP/HTTPS streaming download with redirect support (up to 5 hops)
// Returns null on HTTP 404 so the caller can skip the file gracefully.
// ---------------------------------------------------------------------------
function streamURL(
  url: string,
  redirectCount = 0
): Promise<readline.Interface | null> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'));
      return;
    }
    const proto = url.startsWith('https') ? https : http;
    proto
      .get(url, (res) => {
        const { statusCode, headers: resHeaders } = res;
        if (
          (statusCode === 301 || statusCode === 302 || statusCode === 307) &&
          resHeaders.location
        ) {
          streamURL(resHeaders.location, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (statusCode === 404) {
          res.resume();
          resolve(null);
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${statusCode ?? 'unknown'} downloading ${url}`));
          return;
        }
        resolve(readline.createInterface({ input: res, crlfDelay: Infinity }));
      })
      .on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Foundation filter logic (per BMF field documentation)
//   FOUNDATION code 02 or 04 = private foundation types
//   SUBSECTION 03 (501c3) + PF_FILING_REQD_CD = 1 = required to file as PF
// ---------------------------------------------------------------------------
function isFoundation(row: Record<string, string | undefined>): boolean {
  const foundation = (row['FOUNDATION'] ?? '').trim().padStart(2, '0');
  const subsection = (row['SUBSECTION'] ?? '').trim();
  const pfFiling = (row['PF_FILING_REQD_CD'] ?? '').trim();
  return (
    foundation === '02' ||
    foundation === '04' ||
    (subsection === '03' && pfFiling === '1')
  );
}

// ---------------------------------------------------------------------------
// Map a parsed BMF row to a foundation_directory insert record
// ---------------------------------------------------------------------------
function mapRow(
  row: Record<string, string | undefined>
): Database['public']['Tables']['foundation_directory']['Insert'] {
  const parseAmount = (val: string | undefined): number | null => {
    const n = parseFloat(val ?? '');
    return isNaN(n) ? null : n;
  };
  const str = (val: string | undefined): string | null =>
    (val ?? '').trim() || null;

  return {
    ein: (row['EIN'] ?? '').trim(),
    name: (row['NAME'] ?? '').trim(),
    dba: str(row['SORT_NAME']),
    city: str(row['CITY']),
    state: str(row['STATE']),
    zip: str(row['ZIP']),
    ntee_code: str(row['NTEE_CD']),
    subsection_code: str(row['SUBSECTION']),
    foundation_type: str(row['FOUNDATION']),
    revenue_amount: parseAmount(row['REVENUE_AMT']),
    asset_amount: parseAmount(row['ASSET_AMT']),
    ruling_date: str(row['RULING']),
    tax_period: str(row['TAX_PERIOD']),
    activity_codes: str(row['ACTIVITY']),
    organization_type: str(row['ORGANIZATION']),
    status: str(row['STATUS']),
    website: null,
    email: null,
    phone: null,
    giving_total: null,
    geographic_focus: str(row['STATE']),
  };
}

// ---------------------------------------------------------------------------
// Import a single BMF file URL. Returns imported count, or null if skipped.
// ---------------------------------------------------------------------------
async function importFile(
  supabase: SupabaseClient<Database>,
  url: string,
  globalImported: { count: number }
): Promise<number | null> {
  const rl = await streamURL(url);
  if (rl === null) {
    console.log(`  Skipped (404): ${url}`);
    return null;
  }

  let batch: Database['public']['Tables']['foundation_directory']['Insert'][] = [];
  let fileImported = 0;
  let fileErrors = 0;

  const lastMilestone = { value: Math.floor(globalImported.count / 1000) };

  for await (const line of rl) {
    if (!line.trim()) continue;

    // BMF files have no header row — every line is data, mapped positionally
    // against the fixed BMF_HEADERS layout (so row['FOUNDATION'] etc. resolve).
    const values = parseCSVLine(line);
    const row: Record<string, string | undefined> = {};
    for (let i = 0; i < BMF_HEADERS.length; i++) {
      const key = BMF_HEADERS[i];
      if (key !== undefined) {
        row[key] = values[i];
      }
    }

    if (!isFoundation(row)) continue;

    const ein = (row['EIN'] ?? '').trim();
    const name = (row['NAME'] ?? '').trim();
    if (!ein || !name) continue;

    batch.push(mapRow(row));

    if (batch.length >= BATCH_SIZE) {
      const { error } = await supabase
        .from('foundation_directory')
        .upsert(batch, { onConflict: 'ein' });

      if (error) {
        console.error(`\n  Batch upsert error: ${error.message}`);
        fileErrors++;
      } else {
        fileImported += batch.length;
        globalImported.count += batch.length;

        const milestone = Math.floor(globalImported.count / 1000);
        if (milestone > lastMilestone.value) {
          lastMilestone.value = milestone;
          process.stdout.write(`\r  Progress: ${globalImported.count.toLocaleString()} foundations imported total...`);
        }
      }
      batch = [];
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    const { error } = await supabase
      .from('foundation_directory')
      .upsert(batch, { onConflict: 'ein' });

    if (error) {
      console.error(`\n  Final batch upsert error: ${error.message}`);
      fileErrors++;
    } else {
      fileImported += batch.length;
      globalImported.count += batch.length;
    }
  }

  if (fileErrors > 0) {
    console.log(`\n  Completed with ${fileErrors} batch error(s): ${fileImported} imported`);
  }

  return fileImported;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  loadEnvLocal();

  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
    // ws's constructor type is broader than Supabase's WebSocketLikeConstructor;
    // cast bridges the known @types/ws vs @supabase/supabase-js mismatch.
    realtime: { transport: ws as never },
  });

  // Single-file override for debugging
  const singleUrl = process.env['BMF_URL'];
  const urls = singleUrl
    ? [singleUrl]
    : STATE_CODES.map((s) => `${BMF_BASE_URL}/eo_${s}.csv`);

  console.log(
    singleUrl
      ? `Importing single file: ${singleUrl}`
      : `Importing IRS BMF for ${STATE_CODES.length} state/territory files...`
  );

  const globalImported = { count: 0 };
  let filesSucceeded = 0;
  let filesSkipped = 0;
  let filesFailed = 0;

  for (const url of urls) {
    const label = url.split('/').pop() ?? url;
    process.stdout.write(`\nProcessing ${label}...`);

    try {
      const count = await importFile(supabase, url, globalImported);
      if (count === null) {
        filesSkipped++;
      } else {
        process.stdout.write(` ${count.toLocaleString()} foundations`);
        filesSucceeded++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n  ERROR: ${msg}`);
      filesFailed++;
    }
  }

  console.log(`\n`);
  console.log(`=== IRS BMF National Import Complete ===`);
  console.log(`Files processed:  ${filesSucceeded}`);
  console.log(`Files skipped:    ${filesSkipped}`);
  console.log(`Files failed:     ${filesFailed}`);
  console.log(`Total imported:   ${globalImported.count.toLocaleString()} foundations from ${filesSucceeded} files`);

  if (filesFailed > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Import failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

