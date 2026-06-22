/**
 * HUD data ingestion script.
 * Fetches PIT homeless counts and Fair Market Rent data for all US states
 * and stores results in the intelligence_need_data table.
 *
 * Usage:
 *   npx tsx scripts/ingest-hud-data.ts --all
 *   npx tsx scripts/ingest-hud-data.ts --states "TX,CA,NY"
 */

import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';
import { HudDataSource } from '../src/lib/intelligence/sources/hud-api';
import type { NeedDataPoint } from '../src/lib/intelligence/sources/types';

const ALL_STATE_ABBRS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

const ABBR_TO_FULL: Record<string, string> = {
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

function parseArgs(): { abbrs: string[] } {
  const args = process.argv.slice(2);

  if (args.includes('--all')) return { abbrs: ALL_STATE_ABBRS };

  const statesIdx = args.indexOf('--states');
  if (statesIdx !== -1 && args[statesIdx + 1]) {
    const abbrs = args[statesIdx + 1]!
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    return { abbrs };
  }

  console.error('Usage: npx tsx scripts/ingest-hud-data.ts --all');
  console.error('       npx tsx scripts/ingest-hud-data.ts --states "TX,CA,NY"');
  process.exit(1);
}

function needDataPointToRow(pt: NeedDataPoint, stateAbbr: string): Record<string, unknown> {
  return {
    source: pt.source,
    source_url: 'https://www.hudexchange.info/',
    data_type: pt.category,
    geographic_level: 'state',
    state: ABBR_TO_FULL[stateAbbr] ?? stateAbbr,
    metric_name: pt.metric,
    metric_value: String(pt.value),
    metric_year: pt.year,
    citation: pt.citation,
  };
}

async function main() {
  const { abbrs } = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }

  const hudApiKey = process.env.HUD_API_KEY;
  if (!hudApiKey) {
    console.warn('Warning: HUD_API_KEY not set — Fair Market Rent data will be skipped.');
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const hud = new HudDataSource();

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const abbr of abbrs) {
    const stateName = ABBR_TO_FULL[abbr] ?? abbr;
    process.stdout.write(`[${abbr}] fetching...`);

    try {
      const [pitResult, fmrResult] = await Promise.allSettled([
        hud.fetchHomelessCounts(abbr),
        hud.fetchFairMarketRents(abbr),
      ]);

      const points: NeedDataPoint[] = [
        ...(pitResult.status === 'fulfilled' ? pitResult.value : []),
        ...(fmrResult.status === 'fulfilled' ? fmrResult.value : []),
      ];

      if (points.length === 0) {
        console.log(' no data returned');
        totalSkipped++;
        continue;
      }

      const rows = points.map((pt) => needDataPointToRow(pt, abbr));

      // Delete existing rows for this state before re-inserting for idempotency.
      await supabase
        .from('intelligence_need_data')
        .delete()
        .eq('state', stateName)
        .in('source', ['HUD Exchange PIT', 'HUD Fair Market Rents', 'HUD CHAS']);

      const { error: insertError } = await supabase
        .from('intelligence_need_data')
        .insert(rows as never);

      if (insertError) {
        console.error(`\n  insert error: ${insertError.message}`);
      }

      totalInserted += rows.length;
      console.log(` inserted ${rows.length} points (${stateName})`);
    } catch (err) {
      console.error(` error: ${(err as Error).message}`);
      totalSkipped++;
    }

    // 1-second delay between states — respectful to HUD APIs
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\nDone. ${totalInserted} points inserted, ${totalSkipped} states skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
