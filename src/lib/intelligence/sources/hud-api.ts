import { NeedDataPoint } from './types';

// HUD state abbreviation to entity ID mapping for FMR API
const STATE_ENTITY_IDS: Record<string, string> = {
  AL: 'AL', AK: 'AK', AZ: 'AZ', AR: 'AR', CA: 'CA', CO: 'CO', CT: 'CT',
  DE: 'DE', FL: 'FL', GA: 'GA', HI: 'HI', ID: 'ID', IL: 'IL', IN: 'IN',
  IA: 'IA', KS: 'KS', KY: 'KY', LA: 'LA', ME: 'ME', MD: 'MD', MA: 'MA',
  MI: 'MI', MN: 'MN', MS: 'MS', MO: 'MO', MT: 'MT', NE: 'NE', NV: 'NV',
  NH: 'NH', NJ: 'NJ', NM: 'NM', NY: 'NY', NC: 'NC', ND: 'ND', OH: 'OH',
  OK: 'OK', OR: 'OR', PA: 'PA', RI: 'RI', SC: 'SC', SD: 'SD', TN: 'TN',
  TX: 'TX', UT: 'UT', VT: 'VT', VA: 'VA', WA: 'WA', WV: 'WV', WI: 'WI',
  WY: 'WY', DC: 'DC',
};

// Normalize state input to 2-letter abbreviation
function normalizeState(state: string): string {
  const upper = state.trim().toUpperCase();
  if (upper.length === 2 && upper in STATE_ENTITY_IDS) return upper;
  // Try matching common full names
  const nameMap: Record<string, string> = {
    ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
    COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA',
    HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
    KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
    MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO',
    MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
    'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND',
    OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI',
    'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX',
    UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
    WISCONSIN: 'WI', WYOMING: 'WY', 'DISTRICT OF COLUMBIA': 'DC',
  };
  return nameMap[upper] ?? upper;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export class HudDataSource {
  async fetchHomelessCounts(state: string, year = 2023): Promise<NeedDataPoint[]> {
    const abbr = normalizeState(state);
    // HUD Exchange PIT data is distributed as downloadable files; use the public data API endpoint
    const url = `https://www.hudexchange.info/resource/3031/pit-and-hic-data-since-2007/`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HUD Exchange error: ${res.status}`);

      const text = await res.text();
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length < 2) return [];

      const headers = parseCSVLine(lines[0] ?? '');
      const stateIdx = headers.findIndex((h) => h.toLowerCase().includes('state'));
      const yearIdx = headers.findIndex((h) => h.toLowerCase().includes('year'));
      const totalIdx = headers.findIndex((h) => h.toLowerCase().includes('overall homeless'));
      const shelteredIdx = headers.findIndex((h) => h.toLowerCase().includes('sheltered'));
      const unshelteredIdx = headers.findIndex((h) => h.toLowerCase().includes('unsheltered'));

      const points: NeedDataPoint[] = [];

      for (const line of lines.slice(1)) {
        const cols = parseCSVLine(line);
        if (stateIdx >= 0 && cols[stateIdx]?.toUpperCase() !== abbr) continue;
        if (yearIdx >= 0 && cols[yearIdx] !== String(year)) continue;

        const geography = `${abbr} (${year})`;
        const citation = `HUD Point-in-Time Count ${year}, HUD Exchange`;

        if (totalIdx >= 0) {
          const val = parseFloat(cols[totalIdx] ?? '0');
          if (!isNaN(val)) {
            points.push({ metric: 'total_homeless', value: val, year, geography, source: 'HUD Exchange PIT', citation, category: 'housing' });
          }
        }
        if (shelteredIdx >= 0) {
          const val = parseFloat(cols[shelteredIdx] ?? '0');
          if (!isNaN(val)) {
            points.push({ metric: 'sheltered_homeless', value: val, year, geography, source: 'HUD Exchange PIT', citation, category: 'housing' });
          }
        }
        if (unshelteredIdx >= 0) {
          const val = parseFloat(cols[unshelteredIdx] ?? '0');
          if (!isNaN(val)) {
            points.push({ metric: 'unsheltered_homeless', value: val, year, geography, source: 'HUD Exchange PIT', citation, category: 'housing' });
          }
        }
      }

      return points;
    } catch {
      return [];
    }
  }

  async fetchFairMarketRents(state: string, county?: string): Promise<NeedDataPoint[]> {
    const apiKey = process.env.HUD_API_KEY;
    if (!apiKey) return [];

    const abbr = normalizeState(state);
    const entityId = county ? `${abbr}${county}` : abbr;
    const url = `https://www.huduser.gov/hudapi/public/fmr/data/${entityId}`;

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`HUD FMR error: ${res.status}`);

      const json = (await res.json()) as {
        data?: {
          basicdata?: Array<{
            year?: number;
            fmr_0?: number;
            fmr_1?: number;
            fmr_2?: number;
            fmr_3?: number;
            fmr_4?: number;
            county_name?: string;
            state_alpha?: string;
          }>;
        };
      };

      const rows = json.data?.basicdata ?? [];
      const geography = county ? `${county}, ${state}` : state;
      const points: NeedDataPoint[] = [];

      for (const row of rows) {
        const yr = row.year ?? new Date().getFullYear();
        const citation = `HUD Fair Market Rents ${yr}, HUD User`;
        const bedroomLabels: Array<[keyof typeof row, string]> = [
          ['fmr_0', 'fmr_efficiency'],
          ['fmr_1', 'fmr_1br'],
          ['fmr_2', 'fmr_2br'],
          ['fmr_3', 'fmr_3br'],
          ['fmr_4', 'fmr_4br'],
        ];

        for (const [key, metric] of bedroomLabels) {
          const val = row[key];
          if (typeof val === 'number' && !isNaN(val)) {
            points.push({ metric, value: val, year: yr, geography, source: 'HUD Fair Market Rents', citation, category: 'housing' });
          }
        }
      }

      return points;
    } catch {
      return [];
    }
  }

  async fetchAffordabilityIndex(state: string): Promise<NeedDataPoint[]> {
    const apiKey = process.env.HUD_API_KEY;
    if (!apiKey) return [];

    const abbr = normalizeState(state);
    const url = `https://www.huduser.gov/hudapi/public/chas?type=4&stateId=${abbr}`;

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`HUD CHAS error: ${res.status}`);

      const json = (await res.json()) as {
        data?: Array<{
          year?: string;
          T1_est1?: number;
          T1_est2?: number;
          T1_est11?: number;
        }>;
      };

      const rows = json.data ?? [];
      const geography = state;
      const points: NeedDataPoint[] = [];

      for (const row of rows) {
        const yr = parseInt(row.year ?? '0', 10) || new Date().getFullYear();
        const citation = `HUD CHAS ${yr}, HUD User`;

        const totalHouseholds = row.T1_est1;
        const costBurdened = row.T1_est2;
        const severelyCostBurdened = row.T1_est11;

        if (typeof totalHouseholds === 'number' && !isNaN(totalHouseholds)) {
          points.push({ metric: 'total_households', value: totalHouseholds, year: yr, geography, source: 'HUD CHAS', citation, category: 'housing' });
        }
        if (typeof costBurdened === 'number' && !isNaN(costBurdened)) {
          points.push({ metric: 'cost_burdened_households', value: costBurdened, year: yr, geography, source: 'HUD CHAS', citation, category: 'housing' });
        }
        if (typeof severelyCostBurdened === 'number' && !isNaN(severelyCostBurdened)) {
          points.push({ metric: 'severely_cost_burdened_households', value: severelyCostBurdened, year: yr, geography, source: 'HUD CHAS', citation, category: 'housing' });
        }
      }

      return points;
    } catch {
      return [];
    }
  }
}
