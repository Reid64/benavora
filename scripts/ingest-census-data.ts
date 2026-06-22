/**
 * Census data ingestion script.
 * Fetches poverty, housing, and demographic data for US states via Census ACS API
 * and stores results in the intelligence_need_data table.
 *
 * Usage:
 *   npx tsx scripts/ingest-census-data.ts --states "TX,CA,NY"
 *   npx tsx scripts/ingest-census-data.ts --all
 */

import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { CensusDataSource } from '../src/lib/intelligence/sources/census-api';
import type { NeedDataPoint } from '../src/lib/intelligence/sources/types';

const ALL_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
  'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma',
  'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
];

function parseArgs(): { states: string[] } {
  const args = process.argv.slice(2);
  const allFlag = args.includes('--all');
  const statesIdx = args.indexOf('--states');

  if (allFlag) return { states: ALL_STATES };

  if (statesIdx !== -1 && args[statesIdx + 1]) {
    const abbrs = args[statesIdx + 1]!.split(',').map((s) => s.trim()).filter(Boolean);
    // Accept two-letter abbreviations and map to full names
    const abbrToFull: Record<string, string> = {
      AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
      CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
      HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
      KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
      MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
      MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
      NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
      OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
      SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
      UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
      WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
    };
    return {
      states: abbrs.map((a) => abbrToFull[a.toUpperCase()] ?? a),
    };
  }

  console.error('Usage: npx tsx scripts/ingest-census-data.ts --all');
  console.error('       npx tsx scripts/ingest-census-data.ts --states "TX,CA,NY"');
  process.exit(1);
}

function needDataPointToRow(pt: NeedDataPoint, state: string): Record<string, unknown> {
  return {
    source: pt.source,
    source_url: 'https://api.census.gov/data/2022/acs/acs5',
    data_type: pt.category,
    geographic_level: pt.geography.includes(',') ? 'county' : 'state',
    state,
    metric_name: pt.metric,
    metric_value: String(pt.value),
    metric_year: pt.year,
    citation: pt.citation,
  };
}

async function main() {
  const { states } = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const census = new CensusDataSource();

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const state of states) {
    process.stdout.write(`[${state}] fetching...`);
    try {
      const [poverty, housing, demo] = await Promise.allSettled([
        census.fetchPovertyData(state),
        census.fetchHousingData(state),
        census.fetchDemographics(state),
      ]);

      const points: NeedDataPoint[] = [
        ...(poverty.status === 'fulfilled' ? poverty.value : []),
        ...(housing.status === 'fulfilled' ? housing.value : []),
        ...(demo.status === 'fulfilled' ? demo.value : []),
      ];

      if (points.length === 0) {
        console.log(` no data returned (likely unknown state name)`);
        totalSkipped++;
        continue;
      }

      const rows = points.map((pt) => needDataPointToRow(pt, state));

      // Delete existing rows for this state+source before re-inserting so
      // the script is idempotent (re-runs don't create duplicates).
      await supabase
        .from('intelligence_need_data')
        .delete()
        .eq('state', state)
        .eq('source', rows[0]?.['source'] ?? 'US Census Bureau ACS 5-Year');

      const { error: insertError } = await supabase
        .from('intelligence_need_data')
        .insert(rows as never);

      if (insertError) {
        console.error(`\n  insert error: ${insertError.message}`);
      }

      totalInserted += rows.length;
      console.log(` inserted ${rows.length} points`);
    } catch (err) {
      console.error(` error: ${(err as Error).message}`);
      totalSkipped++;
    }

    // Respectful delay between states
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\nDone. ${totalInserted} points inserted, ${totalSkipped} states skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
