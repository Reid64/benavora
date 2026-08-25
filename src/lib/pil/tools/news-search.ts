import { createHash } from "crypto";

import { callClaudeWithTools, type ClaudeToolSpec } from "@/lib/ai/claude";
import type { AgentContext } from "@/lib/pil/agent-runner";
import type { Tool, ToolResult } from "@/lib/pil/tools";
import { extractRawSearchResults } from "@/lib/pil/tools/web-search";

// T-NEWS (News/Search Connector). No standalone news API is configured for
// this project (no NEWS_API_KEY-shaped env var anywhere in this codebase),
// so this reuses the same underlying capability as web-search.ts -- Claude's
// server-side web_search tool -- scoped toward news coverage via the system
// prompt and an optional dateFrom/dateTo hint appended to the query, since
// web_search_20250305 has no native date-range parameter. Same snippet
// limitation as web-search.ts: the wire format carries no readable snippet
// text, only title/url/page_age.

const TOOL_NAME = "news_search";
const COST_PER_SEARCH_USD = 0.005;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export const newsSearchTool: Tool = {
  name: TOOL_NAME,
  description: "Searches for recent news coverage via Claude's server-side web_search tool, scoped to a date range when given.",

  async execute(params: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
    if (!context.tools.includes(TOOL_NAME)) {
      return {
        success: false,
        data: null,
        cost_usd: 0,
        error: `Tool "${TOOL_NAME}" is not in the permitted tool set for agent ${context.agentCode}`,
      };
    }

    const query = params.query;
    if (typeof query !== "string" || query.length === 0) {
      return { success: false, data: null, cost_usd: 0, error: "news_search requires a string `query` param" };
    }
    const dateFrom = typeof params.dateFrom === "string" ? params.dateFrom : undefined;
    const dateTo = typeof params.dateTo === "string" ? params.dateTo : undefined;
    const limit = typeof params.limit === "number" && params.limit > 0 ? params.limit : 10;

    const dateHint =
      dateFrom || dateTo
        ? ` Restrict results to news published ${dateFrom ? `after ${dateFrom}` : ""}${dateFrom && dateTo ? " and " : ""}${dateTo ? `before ${dateTo}` : ""}.`
        : "";

    const newsSearchServerTool = {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: limit,
    } as unknown as ClaudeToolSpec;

    try {
      const response = await callClaudeWithTools({
        messages: [{ role: "user", content: `${query} news` }],
        system: `Search for recent news coverage of the user's query. Do not summarize -- the caller reads the raw search results.${dateHint}`,
        tools: [newsSearchServerTool],
      });

      const results = extractRawSearchResults(response.content)
        .slice(0, limit)
        .map((r) => ({
          title: r.title,
          url: r.url,
          publishedAt: r.publishedAt,
          snippet: r.snippet,
          source: hostnameOf(r.url),
        }));

      const capturedAt = new Date().toISOString();

      return {
        success: true,
        data: {
          query,
          dateFrom: dateFrom ?? null,
          dateTo: dateTo ?? null,
          results,
          snapshots: results.map((r) => ({
            source_url: r.url,
            snapshot_storage_path: `pil-news-search-snapshots/${createHash("sha256").update(`${r.url}${r.title}${capturedAt}`, "utf8").digest("hex")}.json`,
            content_hash: createHash("sha256").update(`${r.url}${r.title}`, "utf8").digest("hex"),
            http_status: null,
            captured_at: capturedAt,
          })),
        },
        cost_usd: COST_PER_SEARCH_USD,
        tokens_used: response.usage.totalTokens,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, data: null, cost_usd: 0, error: `news_search failed for "${query}": ${message}` };
    }
  },
};

export default newsSearchTool;
