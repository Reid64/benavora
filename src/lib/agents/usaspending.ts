// USAspending.gov Historical Awards Agent.
//
// Queries the public USAspending.gov award-search API (no key required) for
// historical federal awards matching the organization's research keywords, and
// stores them in historical_awards. This is competitive intelligence: who got
// funded, how much, by which agency, and for what - what funders ACTUALLY
// funded vs what they say they fund.

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const USASPENDING_URL =
  "https://api.usaspending.gov/api/v2/search/spending_by_award/";
const SOURCE = "usaspending.gov";

/** Grant/assistance award type codes (block, formula, project, cooperative). */
const AWARD_TYPE_CODES = ["02", "03", "04", "05"];

const DEFAULT_KEYWORD = "housing transitional reentry recovery rural Texas";

export interface UsaspendingInput {
  /** Optional override; defaults to the org's research keywords. */
  keyword?: string;
}

export interface UsaspendingResult {
  awardsFound: number;
  awardsStored: number;
}

type RawAward = Record<string, unknown>;

export class UsaspendingAgent extends BaseAgent<
  UsaspendingInput,
  UsaspendingResult
> {
  // Historical federal award data is government research intelligence.
  // p5a-002 (2026-09-15): was "government_research", colliding with the
  // canonical research/government-grants.ts writer. Renamed to its own
  // distinct DB enum value (already live) so agent_runs is attributable.
  readonly agentType: AgentType = "government_research_usaspending";

  protected async execute(
    input: UsaspendingInput,
  ): Promise<AgentExecution<UsaspendingResult>> {
    const keyword =
      (input.keyword && input.keyword.trim()) || (await this.resolveKeyword());

    const body = {
      filters: {
        award_type_codes: AWARD_TYPE_CODES,
        keyword,
      },
      fields: [
        "Award ID",
        "Recipient Name",
        "Award Amount",
        "Award Date",
        "Awarding Agency",
        "Description",
      ],
      page: 1,
      limit: 25,
      sort: "Award Amount",
      order: "desc",
    };

    const res = await fetch(USASPENDING_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Benavora Grant Research Bot",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      throw new AgentError(
        `USAspending API HTTP ${res.status}: ${res.statusText}`,
        "fetch_failed",
      );
    }

    const json = (await res.json()) as { results?: RawAward[] };
    const results = Array.isArray(json.results) ? json.results : [];

    let stored = 0;
    for (const r of results) {
      const awardId = str(r["Award ID"]) || str(r["internal_id"]);
      if (!awardId) continue;

      const row = {
        organization_id: this.organizationId,
        recipient_name: str(r["Recipient Name"]) || null,
        award_amount: num(r["Award Amount"]),
        award_date: isoDate(str(r["Award Date"])),
        awarding_agency: str(r["Awarding Agency"]) || null,
        description: str(r["Description"]) || null,
        award_id: awardId,
        source: SOURCE,
      };

      const { error } = await this.client
        .from("historical_awards")
        .upsert(row, { onConflict: "organization_id,award_id" });
      if (!error) stored++;
    }

    return {
      data: { awardsFound: results.length, awardsStored: stored },
      outputSummary: `USAspending: found ${results.length} awards, stored ${stored} (keyword: "${keyword}").`,
      itemsFound: results.length,
      itemsProcessed: stored,
      tokensUsed: 0,
    };
  }

  /** Use the org's configured research keywords; fall back to a housing default. */
  private async resolveKeyword(): Promise<string> {
    const { data } = await this.client
      .from("platform_config")
      .select("value")
      .eq("organization_id", this.organizationId)
      .eq("key", "research_config")
      .maybeSingle();
    const row = data as { value: string } | null;
    if (row?.value) {
      try {
        const cfg = JSON.parse(row.value) as { primary_keywords?: string[] };
        if (Array.isArray(cfg.primary_keywords) && cfg.primary_keywords.length > 0) {
          return cfg.primary_keywords.slice(0, 8).join(" ");
        }
      } catch {
        // fall through to default
      }
    }
    return DEFAULT_KEYWORD;
  }
}

function str(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function num(val: unknown): number | null {
  const n = typeof val === "number" ? val : Number(val);
  return Number.isFinite(n) ? n : null;
}

function isoDate(s: string): string | null {
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}
