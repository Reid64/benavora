// Corporate Scraper Agent — scrapes major corporate foundation and giving pages,
// extracts structured grant opportunity data via Claude, and inserts new records.
//
// Fetches 5 corporate URLs with a 1-second delay between each, sends each page's
// HTML to Claude for extraction, deduplicates by name+source, and inserts
// opportunities with source_type=corporate_giving.

import { callClaude } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import type { Database } from "@/types/database";

type FunderCategory = Database["public"]["Enums"]["funder_category"];

interface CorporateTarget {
  url: string;
  source: string;
  category: FunderCategory;
}

const CORPORATE_TARGETS: CorporateTarget[] = [
  {
    url: "https://corporate.homedepot.com/newsroom/foundation",
    source: "The Home Depot Foundation",
    category: "corporate_foundation",
  },
  {
    url: "https://walmart.org/how-we-give/local-community-grants",
    source: "Walmart.org",
    category: "corporate_donation",
  },
  {
    url: "https://www.wellsfargo.com/about/corporate-responsibility/community-giving/",
    source: "Wells Fargo",
    category: "corporate_foundation",
  },
  {
    url: "https://about.bankofamerica.com/en/making-an-impact/charitable-foundation-funding",
    source: "Bank of America",
    category: "corporate_foundation",
  },
  {
    url: "https://www.jpmorganchase.com/impact/communities",
    source: "JPMorgan Chase",
    category: "corporate_foundation",
  },
];

interface RawExtracted {
  name?: unknown;
  description?: unknown;
  deadline?: unknown;
  amount_max?: unknown;
  url?: unknown;
  eligibility_requirements?: unknown;
}

export interface CorporateScraperInput {
  _placeholder?: never;
}

export interface CorporateScraperResult {
  targetsRun: number;
  opportunitiesCreated: number;
  errors: { source: string; url: string; message: string }[];
}

export class CorporateScraperAgent extends BaseAgent<
  CorporateScraperInput,
  CorporateScraperResult
> {
  readonly agentType: AgentType = "corporate_research";

  constructor(options: BaseAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
  }

  protected async execute(
    // unused
  ): Promise<AgentExecution<CorporateScraperResult>> {
    let opportunitiesCreated = 0;
    let totalTokens = 0;
    const errors: { source: string; url: string; message: string }[] = [];

    for (let i = 0; i < CORPORATE_TARGETS.length; i++) {
      // 1-second delay between requests (not before the first one).
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }

      const target = CORPORATE_TARGETS[i];
      if (!target) continue;

      try {
        const { created, tokensUsed } = await this.scrapeTarget(target);
        opportunitiesCreated += created;
        totalTokens += tokensUsed;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        errors.push({ source: target.source, url: target.url, message });
      }
    }

    return {
      data: {
        targetsRun: CORPORATE_TARGETS.length,
        opportunitiesCreated,
        errors,
      },
      outputSummary: `Corporate: scraped ${CORPORATE_TARGETS.length} pages, created ${opportunitiesCreated} opportunities.`,
      itemsFound: CORPORATE_TARGETS.length,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: totalTokens,
    };
  }

  private async scrapeTarget(
    target: CorporateTarget,
  ): Promise<{ created: number; tokensUsed: number }> {
    const response = await fetch(target.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Benavora/1.0; grant-research-bot)",
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

    const prompt = `Extract grant opportunities. Return JSON array: name, description, deadline (ISO or null), amount_max (number or null), url, eligibility_requirements. If none return []. ONLY valid JSON.

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
        .eq("source", target.source)
        .maybeSingle();

      if (existing) continue;

      // Provenance requirement (AR-17.6): url is the only stored source this
      // agent has for any enriched field below.
      const urlStr = toStr(raw?.url);
      if (!urlStr) continue;

      const opp: Record<string, unknown> = {
        organization_id: this.organizationId,
        name,
        source: target.source,
        source_type: "corporate_giving",
        category: target.category,
        status: "open",
        url: urlStr,
      };

      const descStr = toStr(raw?.description);
      if (descStr) opp.description = descStr;

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

