import { NeedDataPoint } from './types';

// FIPS codes for US states (2-digit)
const STATE_FIPS: Record<string, string> = {
  alabama: '01', alaska: '02', arizona: '04', arkansas: '05', california: '06',
  colorado: '08', connecticut: '09', delaware: '10', florida: '12', georgia: '13',
  hawaii: '15', idaho: '16', illinois: '17', indiana: '18', iowa: '19',
  kansas: '20', kentucky: '21', louisiana: '22', maine: '23', maryland: '24',
  massachusetts: '25', michigan: '26', minnesota: '27', mississippi: '28', missouri: '29',
  montana: '30', nebraska: '31', nevada: '32', 'new hampshire': '33', 'new jersey': '34',
  'new mexico': '35', 'new york': '36', 'north carolina': '37', 'north dakota': '38',
  ohio: '39', oklahoma: '40', oregon: '41', pennsylvania: '42', 'rhode island': '44',
  'south carolina': '45', 'south dakota': '46', tennessee: '47', texas: '48',
  utah: '49', vermont: '50', virginia: '51', washington: '53', 'west virginia': '54',
  wisconsin: '55', wyoming: '56', 'district of columbia': '11',
  al: '01', ak: '02', az: '04', ar: '05', ca: '06', co: '08', ct: '09', de: '10',
  fl: '12', ga: '13', hi: '15', id: '16', il: '17', in: '18', ia: '19', ks: '20',
  ky: '21', la: '22', me: '23', md: '24', ma: '25', mi: '26', mn: '27', ms: '28',
  mo: '29', mt: '30', ne: '31', nv: '32', nh: '33', nj: '34', nm: '35', ny: '36',
  nc: '37', nd: '38', oh: '39', ok: '40', or: '41', pa: '42', ri: '44', sc: '45',
  sd: '46', tn: '47', tx: '48', ut: '49', vt: '50', va: '51', wa: '53', wv: '54',
  wi: '55', wy: '56', dc: '11',
};

function getStateFips(state: string): string | undefined {
  return STATE_FIPS[state.toLowerCase().trim()];
}

function normalizeCountyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+county$/, '')
    .replace(/\s+parish$/, '')
    .replace(/\s+borough$/, '');
}

// Cache of state FIPS -> (normalized county name -> 3-digit county FIPS)
const countyFipsCache = new Map<string, Record<string, string>>();

async function getCountyFips(stateFips: string, county: string): Promise<string | undefined> {
  // Already a raw 3-digit FIPS code
  if (/^\d{3}$/.test(county.trim())) return county.trim();

  let lookup = countyFipsCache.get(stateFips);
  if (!lookup) {
    const key = process.env.CENSUS_API_KEY ? `&key=${process.env.CENSUS_API_KEY}` : '';
    const url = `https://api.census.gov/data/2022/acs/acs5?get=NAME&for=county:*&in=state:${stateFips}${key}`;
    const res = await fetch(url);
    if (!res.ok) return undefined;

    const data = (await res.json()) as string[][];
    lookup = {};
    // Row shape: [NAME, state, county] e.g. ["Harris County, Texas", "48", "201"]
    for (const [name, , code] of data.slice(1)) {
      if (!name || !code) continue;
      const cleanName = normalizeCountyName(name.split(',')[0] ?? name);
      lookup[cleanName] = code;
    }
    countyFipsCache.set(stateFips, lookup);
  }

  return lookup[normalizeCountyName(county)];
}

async function fetchCensus(variables: string[], stateFips: string, countyFips?: string): Promise<Record<string, string>[]> {
  const base = 'https://api.census.gov/data/2022/acs/acs5';
  const key = process.env.CENSUS_API_KEY ? `&key=${process.env.CENSUS_API_KEY}` : '';
  const geo = countyFips
    ? `for=county:${countyFips}&in=state:${stateFips}`
    : `for=state:${stateFips}`;
  const url = `${base}?get=${variables.join(',')}&${geo}${key}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census API error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as string[][];
  if (data.length < 2) return [];

  const headers = data[0] ?? [];
  return data.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    return obj;
  });
}

export class CensusDataSource {
  async fetchPovertyData(state: string, county?: string): Promise<NeedDataPoint[]> {
    const stateFips = getStateFips(state);
    if (!stateFips) return [];
    const countyFips = county ? await getCountyFips(stateFips, county) : undefined;
    if (county && !countyFips) return [];

    const variables = ['B17001_001E', 'B17001_002E'];
    const rows = await fetchCensus(variables, stateFips, countyFips);
    const geography = county ? `${county}, ${state}` : state;

    return rows.flatMap((row): NeedDataPoint[] => {
      const total = parseFloat(row['B17001_001E'] ?? '0');
      const belowPoverty = parseFloat(row['B17001_002E'] ?? '0');
      if (isNaN(total) || isNaN(belowPoverty)) return [];

      return [
        {
          metric: 'total_population',
          value: total,
          year: 2022,
          geography,
          source: 'US Census Bureau ACS 5-Year',
          citation: 'American Community Survey 5-Year Estimates 2022, Table B17001',
          category: 'poverty',
        },
        {
          metric: 'population_below_poverty',
          value: belowPoverty,
          year: 2022,
          geography,
          source: 'US Census Bureau ACS 5-Year',
          citation: 'American Community Survey 5-Year Estimates 2022, Table B17001',
          category: 'poverty',
        },
      ];
    });
  }

  async fetchHousingData(state: string, county?: string): Promise<NeedDataPoint[]> {
    const stateFips = getStateFips(state);
    if (!stateFips) return [];
    const countyFips = county ? await getCountyFips(stateFips, county) : undefined;
    if (county && !countyFips) return [];

    const variables = ['B25003_001E', 'B25003_003E', 'B25077_001E'];
    const rows = await fetchCensus(variables, stateFips, countyFips);
    const geography = county ? `${county}, ${state}` : state;

    return rows.flatMap((row): NeedDataPoint[] => {
      const occupied = parseFloat(row['B25003_001E'] ?? '0');
      const renter = parseFloat(row['B25003_003E'] ?? '0');
      const medianValue = parseFloat(row['B25077_001E'] ?? '0');

      const points: NeedDataPoint[] = [];
      if (!isNaN(occupied)) {
        points.push({
          metric: 'occupied_housing_units',
          value: occupied,
          year: 2022,
          geography,
          source: 'US Census Bureau ACS 5-Year',
          citation: 'American Community Survey 5-Year Estimates 2022, Table B25003',
          category: 'housing',
        });
      }
      if (!isNaN(renter)) {
        points.push({
          metric: 'renter_occupied_units',
          value: renter,
          year: 2022,
          geography,
          source: 'US Census Bureau ACS 5-Year',
          citation: 'American Community Survey 5-Year Estimates 2022, Table B25003',
          category: 'housing',
        });
      }
      if (!isNaN(medianValue) && medianValue > 0) {
        points.push({
          metric: 'median_home_value',
          value: medianValue,
          year: 2022,
          geography,
          source: 'US Census Bureau ACS 5-Year',
          citation: 'American Community Survey 5-Year Estimates 2022, Table B25077',
          category: 'housing',
        });
      }
      return points;
    });
  }

  async fetchDemographics(state: string, county?: string): Promise<NeedDataPoint[]> {
    const stateFips = getStateFips(state);
    if (!stateFips) return [];
    const countyFips = county ? await getCountyFips(stateFips, county) : undefined;
    if (county && !countyFips) return [];

    const variables = ['B01003_001E', 'B19013_001E'];
    const rows = await fetchCensus(variables, stateFips, countyFips);
    const geography = county ? `${county}, ${state}` : state;

    return rows.flatMap((row): NeedDataPoint[] => {
      const population = parseFloat(row['B01003_001E'] ?? '0');
      const medianIncome = parseFloat(row['B19013_001E'] ?? '0');

      const points: NeedDataPoint[] = [];
      if (!isNaN(population)) {
        points.push({
          metric: 'total_population',
          value: population,
          year: 2022,
          geography,
          source: 'US Census Bureau ACS 5-Year',
          citation: 'American Community Survey 5-Year Estimates 2022, Table B01003',
          category: 'demographics',
        });
      }
      if (!isNaN(medianIncome) && medianIncome > 0) {
        points.push({
          metric: 'median_household_income',
          value: medianIncome,
          year: 2022,
          geography,
          source: 'US Census Bureau ACS 5-Year',
          citation: 'American Community Survey 5-Year Estimates 2022, Table B19013',
          category: 'demographics',
        });
      }
      return points;
    });
  }
}
