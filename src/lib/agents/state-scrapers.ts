// State Housing Agency Scraper — fetches grant pages from five state housing
// agencies and extracts funding opportunities via Claude.
//
// Scrapes each agency URL with User-Agent "Benavora Grant Research Bot",
// sends HTML to Claude for structured extraction, deduplicates by name+source,
// and inserts new opportunities with category=housing_grant, source_type=government_state.
// A 2-second delay is applied between each URL fetch.

import { callClaude } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const STATE_SOURCES = [
  {
    name: "California HCD",
    urls: ["https://www.hcd.ca.gov/grants-funding/active-funding"],
    source: "hcd.ca.gov",
    category: "housing_grant",
  },
  {
    name: "Florida Housing",
    urls: ["https://www.floridahousing.org/programs"],
    source: "floridahousing.org",
    category: "housing_grant",
  },
  {
    name: "New York Homes",
    urls: ["https://hcr.ny.gov/funding-opportunities"],
    source: "hcr.ny.gov",
    category: "housing_grant",
  },
  {
    name: "Colorado Housing",
    urls: ["https://cdola.colorado.gov/grants"],
    source: "cdola.colorado.gov",
    category: "housing_grant",
  },
  {
    name: "Arizona Housing",
    urls: [
      "https://housing.az.gov/general-public/community-development-grants",
    ],
    source: "housing.az.gov",
    category: "housing_grant",
  },
] as const;

const USER_AGENT = "Benavora Grant Research Bot";
const DELAY_MS = 2_000;

interface RawExtracted {
  name?: unknown;
  description?: unknown;
  deadline?: unknown;
  amount_max?: unknown;
  amount_min?: unknown;
  url?: unknown;
  eligibility_requirements?: unknown;
}

export interface StateScrapersInput {
  _placeholder?: never;
}

export interface StateScrapersResult {
  sourcesScraped: number;
  pagesScraped: number;
  opportunitiesCreated: number;
  errors: { url: string; message: string }[];
}

export class StateScrapersAgent extends BaseAgent<
  StateScrapersInput,
  StateScrapersResult
> {
  readonly agentType: AgentType = "state_portal";

  constructor(options: BaseAgentOptions) {
    // Multi-state HTML scrape + Claude extraction (with inter-fetch delays)
    // needs more than 60s; cap at 270s to leave a 30s buffer under the 300s
    // Vercel function limit.
    super({ ...options, timeoutMs: options.timeoutMs ?? 270_000 });
  }

  protected async execute(): Promise<AgentExecution<StateScrapersResult>> {
    let pagesScraped = 0;
    let opportunitiesCreated = 0;
    let totalTokens = 0;
    const errors: { url: string; message: string }[] = [];
    let firstFetch = true;

    for (const stateSource of STATE_SOURCES) {
      for (const url of stateSource.urls) {
        if (!firstFetch) {
          await delay(DELAY_MS);
        }
        firstFetch = false;

        try {
          const { created, tokensUsed } = await this.scrapePage(
            url,
            stateSource.source,
            stateSource.category,
          );
          opportunitiesCreated += created;
          totalTokens += tokensUsed;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error.";
          errors.push({ url, message });
        }

        pagesScraped++;
      }
    }

    return {
      data: {
        sourcesScraped: STATE_SOURCES.length,
        pagesScraped,
        opportunitiesCreated,
        errors,
      },
      outputSummary: `State Scrapers: scraped ${pagesScraped} pages across ${STATE_SOURCES.length} agencies, created ${opportunitiesCreated} opportunities.`,
      itemsFound: pagesScraped,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: totalTokens,
    };
  }

  private async scrapePage(
    url: string,
    source: string,
    category: string,
  ): Promise<{ created: number; tokensUsed: number }> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new AgentError(
        `HTTP ${response.status}: ${response.statusText}`,
        "fetch_failed",
      );
    }

    const rawText = await response.text();
    const pageContent =
      rawText.length > 80_000 ? rawText.slice(0, 80_000) : rawText;

    const prompt = `Extract all grant and funding opportunities from this state housing agency webpage. Return JSON array with: name, description, deadline (ISO date or null), amount_max (number or null), amount_min (number or null), url (full URL), eligibility_requirements. If none found return []. Return ONLY valid JSON, no markdown.

Page content:
${pageContent}`;

    const claudeResult = await callClaude({ prompt, maxTokens: 2048 });
    const items = parseClaudeResponse(claudeResult.text);

    let created = 0;

    for (const raw of items) {
      const name = toStr(raw?.name);
      if (!name) continue;

      const { data: existing } = await this.client
        .from("opportunities")
        .select("id")
        .eq("organization_id", this.organizationId)
        .eq("name", name)
        .eq("source", source)
        .maybeSingle();

      if (existing) continue;

      const opp: Record<string, unknown> = {
        organization_id: this.organizationId,
        name,
        source,
        source_type: "government_state",
        category,
        status: "open",
      };

      const descStr = toStr(raw?.description);
      if (descStr) opp.description = descStr;

      const urlStr = toStr(raw?.url);
      if (urlStr) opp.url = urlStr;

      const elig = toStr(raw?.eligibility_requirements);
      if (elig) opp.eligibility_requirements = elig;

      const amtMax = raw?.amount_max;
      if (typeof amtMax === "number" && !isNaN(amtMax) && amtMax > 0) {
        opp.amount_max = amtMax;
      }

      const amtMin = raw?.amount_min;
      if (typeof amtMin === "number" && !isNaN(amtMin) && amtMin > 0) {
        opp.amount_min = amtMin;
      }

      const deadline = toStr(raw?.deadline);
      if (deadline && isIsoDate(deadline)) opp.deadline = deadline;

      const { error: insertError } = await this.client
        .from("opportunities")
        .insert(opp);

      if (!insertError) created++;
    }

    return { created, tokensUsed: claudeResult.usage.totalTokens };
  }
}

function parseClaudeResponse(text: string): RawExtracted[] {
  const clean = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    const parsed: unknown = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed as RawExtracted[];
    if (parsed !== null && typeof parsed === "object") {
      const candidate = (parsed as Record<string, unknown>)["opportunities"];
      if (Array.isArray(candidate)) return candidate as RawExtracted[];
    }
  } catch {
    // Claude returns plain text when no opportunities are found.
  }
  return [];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}
