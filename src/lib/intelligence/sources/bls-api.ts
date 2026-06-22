import { NeedDataPoint } from './types';

// 2-digit state FIPS codes for BLS LAUS series construction
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

interface BlsSeriesData {
  year: string;
  period: string;
  value: string;
}

interface BlsSeriesResult {
  seriesID: string;
  data: BlsSeriesData[];
}

interface BlsApiResponse {
  Results?: {
    series?: BlsSeriesResult[];
  };
}

async function fetchBlsSeries(seriesIds: string[], startYear = '2022', endYear = '2023'): Promise<BlsApiResponse> {
  const apiKey = process.env.BLS_API_KEY;
  const body: Record<string, unknown> = {
    seriesid: seriesIds,
    startyear: startYear,
    endyear: endYear,
  };
  if (apiKey) body['registrationkey'] = apiKey;

  const res = await fetch('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`BLS API error: ${res.status} ${res.statusText}`);
  return (await res.json()) as BlsApiResponse;
}

// Pick the most recent annual value (period M13 = annual average, else last monthly)
function getMostRecentAnnual(data: BlsSeriesData[]): BlsSeriesData | undefined {
  const annual = data.filter((d) => d.period === 'M13');
  if (annual.length > 0) return annual.sort((a, b) => parseInt(b.year) - parseInt(a.year))[0];
  return data.sort((a, b) => {
    const yearDiff = parseInt(b.year) - parseInt(a.year);
    if (yearDiff !== 0) return yearDiff;
    return parseInt(b.period.replace('M', '')) - parseInt(a.period.replace('M', ''));
  })[0];
}

export class BlsDataSource {
  // Fetches state (or county) unemployment rate from BLS LAUS series
  // Series: LAUST{state_fips}0000000000000003 (state) or LAUCN{state_fips}{county_fips}0000000003 (county)
  async fetchUnemploymentRate(state: string, county?: string): Promise<NeedDataPoint[]> {
    const stateFips = getStateFips(state);
    if (!stateFips) return [];

    let seriesId: string;
    let geography: string;

    if (county) {
      // County LAUS series: LAUCN{2-digit-state}{3-digit-county}0000000003
      const countyPadded = county.padStart(3, '0');
      seriesId = `LAUCN${stateFips}${countyPadded}0000000003`;
      geography = `${county}, ${state}`;
    } else {
      // State LAUS series: LAUST{2-digit-state}0000000000000003
      seriesId = `LAUST${stateFips}0000000000000003`;
      geography = state;
    }

    try {
      const response = await fetchBlsSeries([seriesId]);
      const series = response.Results?.series ?? [];
      const result = series[0];
      if (!result) return [];

      const latest = getMostRecentAnnual(result.data);
      if (!latest) return [];

      const value = parseFloat(latest.value);
      if (isNaN(value)) return [];

      const year = parseInt(latest.year, 10);
      return [
        {
          metric: 'unemployment_rate',
          value,
          year,
          geography,
          source: 'Bureau of Labor Statistics, Local Area Unemployment Statistics',
          citation: `Bureau of Labor Statistics, Local Area Unemployment Statistics (LAUS), ${year}, Series ${seriesId}`,
          category: 'employment',
        },
      ];
    } catch {
      return [];
    }
  }

  // Fetches median wage data from BLS OEWS (Occupational Employment and Wage Statistics)
  // Uses state-level median annual wage: OEUS{state_fips}0000000000000010 (all occupations, median annual)
  // If occupation code provided, constructs occupation-specific series
  async fetchWageData(state: string, occupation?: string): Promise<NeedDataPoint[]> {
    const stateFips = getStateFips(state);
    if (!stateFips) return [];

    // OEWS state series format: OEUS{state_fips}{area_fips}{ind_code}{occ_code}{data_type}
    // All occupations (00-0000), all industries (000000), median annual wage (10)
    const occCode = occupation ?? '000000';
    const seriesId = `OEUS${stateFips}0000000${occCode}10`;
    const geography = state;

    try {
      const response = await fetchBlsSeries([seriesId], '2022', '2023');
      const series = response.Results?.series ?? [];
      const result = series[0];
      if (!result) return [];

      const latest = getMostRecentAnnual(result.data);
      if (!latest) return [];

      const value = parseFloat(latest.value);
      if (isNaN(value)) return [];

      const year = parseInt(latest.year, 10);
      const metricLabel = occupation ? `median_annual_wage_occ_${occupation}` : 'median_annual_wage_all_occupations';

      return [
        {
          metric: metricLabel,
          value,
          year,
          geography,
          source: 'Bureau of Labor Statistics, Occupational Employment and Wage Statistics',
          citation: `Bureau of Labor Statistics, OEWS Survey ${year}, ${geography}`,
          category: 'employment',
        },
      ];
    } catch {
      return [];
    }
  }
}
