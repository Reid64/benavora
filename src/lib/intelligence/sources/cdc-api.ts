import { NeedDataPoint } from './types';

// CDC Open Data (Socrata) — no auth required for basic queries
// NCHS Leading Causes of Death: data.cdc.gov/resource/bi63-dtpu.json
// Drug Overdose Deaths: data.cdc.gov/resource/xkb8-kh2a.json

interface NchsCauseRow {
  year?: string;
  state?: string;
  cause_name?: string;
  age_adjusted_death_rate?: string;
  deaths?: string;
}

interface OverdoseRow {
  year?: string;
  state?: string;
  indicator?: string;
  data_value?: string;
}

async function fetchSocrata<T>(url: string, params: Record<string, string>): Promise<T[]> {
  const qs = new URLSearchParams({ $limit: '200', ...params }).toString();
  const res = await fetch(`${url}?${qs}`, {
    headers: { 'X-App-Token': process.env.CDC_APP_TOKEN ?? '' },
  });
  if (!res.ok) throw new Error(`CDC Socrata error: ${res.status} ${res.statusText}`);
  return (await res.json()) as T[];
}

// Normalize full state name or abbreviation to title-case full name for CDC data
const STATE_FULL: Record<string, string> = {
  al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California',
  co: 'Colorado', ct: 'Connecticut', de: 'Delaware', fl: 'Florida', ga: 'Georgia',
  hi: 'Hawaii', id: 'Idaho', il: 'Illinois', in: 'Indiana', ia: 'Iowa',
  ks: 'Kansas', ky: 'Kentucky', la: 'Louisiana', me: 'Maine', md: 'Maryland',
  ma: 'Massachusetts', mi: 'Michigan', mn: 'Minnesota', ms: 'Mississippi', mo: 'Missouri',
  mt: 'Montana', ne: 'Nebraska', nv: 'Nevada', nh: 'New Hampshire', nj: 'New Jersey',
  nm: 'New Mexico', ny: 'New York', nc: 'North Carolina', nd: 'North Dakota',
  oh: 'Ohio', ok: 'Oklahoma', or: 'Oregon', pa: 'Pennsylvania', ri: 'Rhode Island',
  sc: 'South Carolina', sd: 'South Dakota', tn: 'Tennessee', tx: 'Texas',
  ut: 'Utah', vt: 'Vermont', va: 'Virginia', wa: 'Washington', wv: 'West Virginia',
  wi: 'Wisconsin', wy: 'Wyoming', dc: 'District of Columbia',
};

function toFullStateName(state: string): string {
  const key = state.trim().toLowerCase();
  if (key.length === 2) return STATE_FULL[key] ?? state;
  // Already a full name — title-case it
  return state.trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

export class CdcDataSource {
  // Fetches leading causes of death by state from NCHS via CDC Socrata
  // Dataset: NCHS - Leading Causes of Death, United States (bi63-dtpu)
  async fetchMortalityData(state: string): Promise<NeedDataPoint[]> {
    const fullState = toFullStateName(state);

    try {
      const rows = await fetchSocrata<NchsCauseRow>(
        'https://data.cdc.gov/resource/bi63-dtpu.json',
        { state: fullState, $order: 'year DESC' },
      );

      if (rows.length === 0) return [];

      // Find the most recent year available
      const latestYear = Math.max(
        ...rows
          .map((r) => parseInt(r.year ?? '0', 10))
          .filter((y) => !isNaN(y) && y > 0),
      );

      const points: NeedDataPoint[] = [];

      for (const row of rows) {
        const yr = parseInt(row.year ?? '0', 10);
        if (yr !== latestYear) continue;

        const cause = row.cause_name?.trim() ?? '';
        if (!cause || cause.toLowerCase() === 'all causes') {
          // Record total death rate
          const rate = parseFloat(row.age_adjusted_death_rate ?? '');
          if (!isNaN(rate)) {
            points.push({
              metric: 'age_adjusted_death_rate_all_causes',
              value: rate,
              year: yr,
              geography: fullState,
              source: 'CDC National Center for Health Statistics',
              citation: `CDC NCHS, Leading Causes of Death: United States, ${yr} (WONDER)`,
              category: 'health',
            });
          }
          const deaths = parseFloat(row.deaths ?? '');
          if (!isNaN(deaths)) {
            points.push({
              metric: 'total_deaths',
              value: deaths,
              year: yr,
              geography: fullState,
              source: 'CDC National Center for Health Statistics',
              citation: `CDC NCHS, Leading Causes of Death: United States, ${yr} (WONDER)`,
              category: 'health',
            });
          }
        } else {
          // Individual cause — record age-adjusted death rate
          const rate = parseFloat(row.age_adjusted_death_rate ?? '');
          if (!isNaN(rate)) {
            const metricKey = `death_rate_${cause.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
            points.push({
              metric: metricKey,
              value: rate,
              year: yr,
              geography: fullState,
              source: 'CDC National Center for Health Statistics',
              citation: `CDC NCHS, Leading Causes of Death: United States, ${yr}, Cause: ${cause}`,
              category: 'health',
            });
          }
        }
      }

      return points;
    } catch {
      return [];
    }
  }

  // Fetches drug overdose death rates by state from CDC drug overdose dataset
  // Dataset: Drug Overdose Deaths (xkb8-kh2a) — VSRR provisional counts
  // Falls back to SAMHSA NSDUH state estimates for substance use prevalence
  async fetchSubstanceAbuseData(state: string): Promise<NeedDataPoint[]> {
    const fullState = toFullStateName(state);
    const points: NeedDataPoint[] = [];

    // 1. CDC drug overdose deaths (provisional, 12-month rolling)
    try {
      const overdoseRows = await fetchSocrata<OverdoseRow>(
        'https://data.cdc.gov/resource/xkb8-kh2a.json',
        {
          state: fullState,
          indicator: 'Number of Deaths',
          $order: 'year DESC',
          $limit: '10',
        },
      );

      for (const row of overdoseRows) {
        const yr = parseInt(row.year ?? '0', 10);
        const val = parseFloat(row.data_value ?? '');
        if (isNaN(yr) || isNaN(val)) continue;
        points.push({
          metric: 'drug_overdose_deaths',
          value: val,
          year: yr,
          geography: fullState,
          source: 'CDC VSRR, Drug Overdose Surveillance',
          citation: `CDC VSRR Provisional Drug Overdose Death Counts, ${yr}, ${fullState}`,
          category: 'health',
        });
        break; // only most recent
      }
    } catch {
      // non-fatal: continue to next source
    }

    // 2. SAMHSA NSDUH state estimates via CDC's Socrata drug-use dataset
    // Dataset: Behavioral Risk Factor Surveillance System (substance use module)
    try {
      const brfssRows = await fetchSocrata<Record<string, string>>(
        'https://data.cdc.gov/resource/dttw-5yxu.json',
        {
          locationdesc: fullState,
          class: 'Alcohol',
          $order: 'year DESC',
          $limit: '5',
        },
      );

      for (const row of brfssRows) {
        const yr = parseInt(row['year'] ?? '0', 10);
        const val = parseFloat(row['data_value'] ?? '');
        const topic = (row['topic'] ?? '').trim();
        if (isNaN(yr) || isNaN(val) || !topic) continue;
        const metricKey = `brfss_${topic.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
        points.push({
          metric: metricKey,
          value: val,
          year: yr,
          geography: fullState,
          source: 'CDC Behavioral Risk Factor Surveillance System (BRFSS)',
          citation: `CDC BRFSS, ${topic}, ${yr}, ${fullState}`,
          category: 'health',
        });
        break;
      }
    } catch {
      // non-fatal
    }

    return points;
  }
}
