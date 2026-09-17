import Anthropic from '@anthropic-ai/sdk';
import { withClaudeLimit } from '@/lib/ai/claude-concurrency';
import { NeedDataPoint } from './sources/types';
import { CensusDataSource } from './sources/census-api';
import { HudDataSource } from './sources/hud-api';
import { BlsDataSource } from './sources/bls-api';
import { CdcDataSource } from './sources/cdc-api';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const census = new CensusDataSource();
const hud = new HudDataSource();
const bls = new BlsDataSource();
const cdc = new CdcDataSource();

// Category-to-source mapping: which categories each data source contributes
const CATEGORY_SOURCES: Record<string, string[]> = {
  poverty: ['census'],
  housing: ['census', 'hud'],
  demographics: ['census'],
  employment: ['bls'],
  health: ['cdc'],
};

// Select which sources to query based on requested categories
function sourcesForCategories(categories: string[]): Set<string> {
  const needed = new Set<string>();
  for (const cat of categories) {
    for (const src of CATEGORY_SOURCES[cat] ?? []) {
      needed.add(src);
    }
  }
  // If no categories specified, query all sources
  if (needed.size === 0) {
    ['census', 'hud', 'bls', 'cdc'].forEach((s) => needed.add(s));
  }
  return needed;
}

export class NeedStatementEngine {
  // Aggregates need data across Census, HUD, BLS, and CDC sources.
  // Geographic fallback chain: zip → county → state → national
  // (zip and national not currently supported by APIs — county and state are used)
  async gatherNeedData(
    geography: { state: string; county?: string; zip?: string },
    categories: string[],
  ): Promise<NeedDataPoint[]> {
    const { state, county } = geography;
    const sources = sourcesForCategories(categories);
    const results: NeedDataPoint[] = [];

    const tasks: Promise<NeedDataPoint[]>[] = [];

    if (sources.has('census')) {
      // Try county first, fall back to state if county returns empty
      if (county) {
        tasks.push(
          census.fetchPovertyData(state, county).then((pts) =>
            pts.length > 0 ? pts : census.fetchPovertyData(state),
          ),
          census.fetchHousingData(state, county).then((pts) =>
            pts.length > 0 ? pts : census.fetchHousingData(state),
          ),
          census.fetchDemographics(state, county).then((pts) =>
            pts.length > 0 ? pts : census.fetchDemographics(state),
          ),
        );
      } else {
        tasks.push(
          census.fetchPovertyData(state),
          census.fetchHousingData(state),
          census.fetchDemographics(state),
        );
      }
    }

    if (sources.has('hud')) {
      tasks.push(
        hud.fetchHomelessCounts(state),
        hud.fetchFairMarketRents(state, county),
      );
    }

    if (sources.has('bls')) {
      tasks.push(
        bls.fetchUnemploymentRate(state, county).then((pts) =>
          pts.length > 0 ? pts : bls.fetchUnemploymentRate(state),
        ),
        bls.fetchWageData(state),
      );
    }

    if (sources.has('cdc')) {
      tasks.push(
        cdc.fetchMortalityData(state),
        cdc.fetchSubstanceAbuseData(state),
      );
    }

    const batches = await Promise.allSettled(tasks);
    for (const batch of batches) {
      if (batch.status === 'fulfilled') {
        results.push(...batch.value);
      }
    }

    return results;
  }

  // Generates a data-backed need statement with inline citations using Claude.
  // Every statistic includes source, year, and proper citation format.
  async generateNeedStatement(
    orgProfile: Record<string, unknown>,
    needData: NeedDataPoint[],
    programCategory: string,
  ): Promise<{ statement: string; citations: string[] }> {
    if (needData.length === 0) {
      return {
        statement: 'Insufficient data available to generate a need statement. Please configure additional data sources.',
        citations: [],
      };
    }

    const citations = [...new Set(needData.map((d) => this.generateCitation(d)))];
    const dataTable = needData
      .map((d) => `- ${d.metric}: ${d.value} (${d.geography}, ${d.year}) — ${d.source}`)
      .join('\n');

    const orgName = (orgProfile['name'] as string | undefined) ?? 'the organization';
    const mission = (orgProfile['mission_statement'] as string | undefined) ?? '';
    const serviceArea = (orgProfile['service_area'] as string | undefined) ?? '';

    const prompt = `You are an expert grant writer specializing in need statements. Generate a compelling, evidence-based need statement for a grant application.

Organization: ${orgName}
Mission: ${mission}
Service Area: ${serviceArea}
Program Category: ${programCategory}

The following statistics have been retrieved from authoritative government sources. Use them to build the need statement. Reference each statistic with an inline citation in parentheses (e.g., "Bureau of Labor Statistics, 2023").

Available data:
${dataTable}

Instructions:
- Write 3-5 paragraphs establishing the need for this program
- Every statistical claim must include a parenthetical inline citation
- Move from national/state context to local specifics
- Connect the data to the organization's specific program
- Use present tense and active voice
- Do not fabricate statistics. Only use the data provided above.
- End with a clear statement of the gap this program fills

Return ONLY the need statement text, no preamble or commentary.`;

    const response = await withClaudeLimit(() =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    );

    const firstBlock = response.content[0];
    const statement = firstBlock?.type === 'text' ? firstBlock.text.trim() : '';

    return { statement, citations };
  }

  // Formats a NeedDataPoint into a proper bibliographic citation string
  generateCitation(dataPoint: NeedDataPoint): string {
    const { source, citation, year } = dataPoint;
    // If citation already looks complete, return it as-is
    if (citation.length > 30) return citation;
    // Otherwise build from source + year
    return `${source}, ${year}`;
  }
}
