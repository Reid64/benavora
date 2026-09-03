// HUD Monitor Agent — fetches HUD's funding opportunities page and uses Claude
// to extract structured grant data.
//
// Per-run behaviour:
//   1. Fetches HTML from the HUD funding opportunities page (no auth required).
//   2. Sends the HTML to Claude which returns a JSON array of opportunities.
//   3. Deduplicates against existing opportunities by name + source before insert.
//   4. Inserts new records and returns the discovered list.
//
// Field mapping (task spec):
//   category    = housing_grant
//   source      = hud.gov
//   source_type = government_federal  (nearest valid DB enum value)

import { callClaude } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import { fetchWithRetry } from "@/lib/agents/research/http-retry";
import type { AgentType } from "@/types/agents";

const HUD_URL =
  "https://www.hud.gov/program_offices/spm/gmomgmt/grantsinfo/fundingopps";

export interface HudMonitorInput {
  /** Optional keywords to guide Claude's extraction focus. */
  keywords?: string[];
}

export interface HudOpportunity {
  name: string;
  description: string | null;
  deadline: string | null;
  amount_max: number | null;
  url: string | null;
  source: "hud.gov";
}

export interface HudMonitorResult {
  opportunities: HudOpportunity[];
  count: number;
  opportunitiesCreated: number;
}

// Raw shape Claude is asked to return
interface RawHudOpportunity {
  name?: unknown;
  description?: unknown;
  deadline?: unknown;
  amount_max?: unknown;
  url?: unknown;
}

// --- Helpers -----------------------------------------------------------------

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function toNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  // Strip currency symbols and commas before parsing
  const cleaned = toStr(val).replace(/[$,]/g, "");
  const n = Number(cleaned);
  return isFinite(n) && n > 0 ? n : null;
}

function normaliseDate(val: unknown): string | null {
  const s = toStr(val);
  if (!s) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return match ? (match[1] ?? null) : null;
}

function parseClaudeResponse(text: string): RawHudOpportunity[] {
  const clean = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    const parsed: unknown = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed as RawHudOpportunity[];
    if (parsed !== null && typeof parsed === "object") {
      const candidate = (parsed as Record<string, unknown>)["opportunities"];
      if (Array.isArray(candidate)) return candidate as RawHudOpportunity[];
    }
  } catch {
    // Claude returns plain text when no opportunities found
  }
  return [];
}

// --- Agent ------------------------------------------------------------------

export class HudMonitorAgent extends BaseAgent<HudMonitorInput, HudMonitorResult> {
  readonly agentType: AgentType = "hud_monitor";

  protected async execute(
    input: HudMonitorInput,
  ): Promise<AgentExecution<HudMonitorResult>> {
    // Fetch HUD page HTML
    let html: string;
    try {
      const response = await fetchWithRetry(
        () =>
          fetch(HUD_URL, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (compatible; Benavora/1.0; grant-research-bot)",
              Accept: "text/html,application/xhtml+xml",
            },
            signal: AbortSignal.timeout(25_000),
          }),
        { attempts: 3 },
      );
      if (!response.ok) {
        throw new AgentError(
          `HUD page returned HTTP ${response.status}.`,
          "portal_error",
          502,
        );
      }
      html = await response.text();
    } catch (err) {
      if (err instanceof AgentError) throw err;
      throw new AgentError(
        `Failed to fetch HUD page: ${err instanceof Error ? err.message : "network error"}`,
        "fetch_failed",
        502,
      );
    }

    // Truncate to ~80KB to stay within token limits
    const truncatedHtml = html.length > 80_000 ? html.slice(0, 80_000) : html;

    const keywordClause =
      input.keywords && input.keywords.length > 0
        ? ` Focus especially on grants related to: ${input.keywords.join(", ")}.`
        : "";

    const prompt = `You are analyzing HUD's (Department of Housing and Urban Development) grant funding opportunities page.${keywordClause}

Extract ALL grant and funding opportunities listed on this page.

Return ONLY a JSON array. Each element must follow this exact shape (use null for any missing field):
{
  "name": string,
  "description": string | null,
  "deadline": string | null,
  "amount_max": number | null,
  "url": string | null
}

Rules:
- "name": the official program or opportunity name (required — skip entries without a clear name).
- "description": a concise summary of the grant purpose (1-3 sentences), otherwise null.
- "deadline": use YYYY-MM-DD format if determinable, otherwise null.
- "amount_max": the maximum award amount as a plain number (e.g. 500000 for $500,000), otherwise null.
- "url": the direct link to the opportunity or NOFA page if present, otherwise null.
- If no opportunities are found, return an empty array: []
- Do NOT wrap the array in markdown fences or any other text. Return only raw JSON.

Page HTML:
${truncatedHtml}`;

    let claudeResult: Awaited<ReturnType<typeof callClaude>>;
    try {
      claudeResult = await callClaude({ prompt, maxTokens: 2048 });
    } catch (err) {
      throw new AgentError(
        `Claude extraction failed: ${err instanceof Error ? err.message : "unknown error"}`,
        "claude_error",
        502,
      );
    }

    const extracted = parseClaudeResponse(claudeResult.text);

    const opportunities: HudOpportunity[] = extracted.map((item) => ({
      name: toStr(item.name),
      description: toStr(item.description) || null,
      deadline: normaliseDate(item.deadline),
      amount_max: toNumber(item.amount_max),
      url: toStr(item.url) || null,
      source: "hud.gov" as const,
    }));

    let opportunitiesCreated = 0;

    for (const opp of opportunities) {
      if (!opp.name) continue;

      // Dedup by name + source
      const { data: existing } = await this.client
        .from("opportunities")
        .select("id")
        .eq("organization_id", this.organizationId)
        .eq("name", opp.name)
        .eq("source", "hud.gov")
        .maybeSingle();
      if (existing) continue;

      // Also dedup by url if present
      if (opp.url) {
        const { data: byUrl } = await this.client
          .from("opportunities")
          .select("id")
          .eq("organization_id", this.organizationId)
          .eq("url", opp.url)
          .maybeSingle();
        if (byUrl) continue;
      }

      const row: Record<string, unknown> = {
        organization_id: this.organizationId,
        name: opp.name,
        category: "housing_grant",
        source: "hud.gov",
        source_type: "government_federal",
        status: "open",
      };

      if (opp.description) row.description = opp.description;
      if (opp.deadline) row.deadline = opp.deadline;
      if (opp.amount_max !== null) row.amount_max = opp.amount_max;
      if (opp.url) row.url = opp.url;

      const { error } = await this.client.from("opportunities").insert(row);
      if (!error) opportunitiesCreated++;
    }

    return {
      data: { opportunities, count: opportunities.length, opportunitiesCreated },
      outputSummary: `HUD monitor found ${opportunities.length} opportunity(ies); ${opportunitiesCreated} new record(s) created.`,
      itemsFound: opportunities.length,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: claudeResult.usage.totalTokens,
    };
  }
}
