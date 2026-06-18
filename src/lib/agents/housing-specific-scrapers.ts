// Housing-Specific Scrapers Agent - NeighborWorks + Federal Home Loan Banks.
//
// These are housing-specific funders directly relevant to housing nonprofits.
// Same pattern as the TDHCA scraper: fetch HTML, send to Claude for structured
// extraction, insert discovered housing-grant opportunities. Each page's source
// is its hostname so results dedupe per funder. category = housing_grant.
// (source_type uses the valid enum value private_foundation - there is no
// "housing_specific" source_type in the schema.)

import { callClaude } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const HOUSING_URLS = [
  "https://www.neighborworks.org/grants",
  "https://www.fhlb-pgh.com/community-investment/grants",
  "https://www.fhlbdm.com/products-services/community/",
] as const;

const USER_AGENT = "Benavora Grant Research Bot";

interface RawExtracted {
  name?: unknown;
  description?: unknown;
  deadline?: unknown;
  amount_max?: unknown;
  url?: unknown;
  eligibility_requirements?: unknown;
}

export interface HousingScrapersInput {
  _placeholder?: never;
}

export interface HousingScrapersResult {
  pagesScraped: number;
  opportunitiesCreated: number;
  errors: { url: string; message: string }[];
}

export class HousingSpecificScrapersAgent extends BaseAgent<
  HousingScrapersInput,
  HousingScrapersResult
> {
  readonly agentType: AgentType = "government_research";

  protected async execute(): Promise<
    AgentExecution<HousingScrapersResult>
  > {
    let opportunitiesCreated = 0;
    let totalTokens = 0;
    const errors: { url: string; message: string }[] = [];

    for (const url of HOUSING_URLS) {
      try {
        const { created, tokensUsed } = await this.scrapePage(url);
        opportunitiesCreated += created;
        totalTokens += tokensUsed;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        errors.push({ url, message });
      }
    }

    return {
      data: {
        pagesScraped: HOUSING_URLS.length,
        opportunitiesCreated,
        errors,
      },
      outputSummary: `Housing-specific scrapers: scraped ${HOUSING_URLS.length} pages, created ${opportunitiesCreated} opportunities.`,
      itemsFound: HOUSING_URLS.length,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: totalTokens,
    };
  }

  private async scrapePage(
    url: string,
  ): Promise<{ created: number; tokensUsed: number }> {
    const source = hostname(url);

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

    const prompt = `Extract housing grant opportunities from this funder page. Return a JSON array; each item: name, description, deadline (ISO date or null), amount_max (number or null), url, eligibility_requirements. If none, return []. ONLY valid JSON, no prose.

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
        source_type: "private_foundation",
        category: "housing_grant",
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

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
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

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(s);
}
