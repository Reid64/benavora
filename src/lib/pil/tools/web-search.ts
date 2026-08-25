import { createHash } from "crypto";

import { callClaudeWithTools, type ClaudeToolSpec } from "@/lib/ai/claude";
import type { AgentContext } from "@/lib/pil/agent-runner";
import type { Tool, ToolResult } from "@/lib/pil/tools";

// T-WEB (Search Provider Adapter, open web). Uses Claude's server-side
// web_search tool (web_search_20250305, the same GA tool
// src/lib/ai/claude.ts's callClaudeWithWebSearch already uses -- see that
// function's comment for why the pinned SDK needs a cast here too). This
// tool calls callClaudeWithTools directly instead of
// callClaudeWithWebSearch because it needs the raw `web_search_tool_result`
// content blocks (structured title/url list) rather than a synthesized
// prose answer.
//
// The wire format for web_search_tool_result content items does not expose
// a plain-text snippet field (only title/url/page_age plus an
// encrypted_content blob usable only as a citation reference back to
// Anthropic, not readable locally) -- so `snippet` is always "" here. See
// news-search.ts for the same limitation and pattern.

const TOOL_NAME = "web_search";
const COST_PER_SEARCH_USD = 0.01;

interface RawSearchResultItem {
  type?: string;
  title?: string;
  url?: string;
  page_age?: string;
}

interface RawSearchResultBlock {
  type?: string;
  content?: RawSearchResultItem[];
}

export function extractRawSearchResults(
  content: unknown[],
): Array<{ title: string; url: string; snippet: string; publishedAt: string | null }> {
  const results: Array<{ title: string; url: string; snippet: string; publishedAt: string | null }> = [];
  for (const block of content) {
    const b = block as RawSearchResultBlock;
    if (b.type !== "web_search_tool_result" || !Array.isArray(b.content)) continue;
    for (const item of b.content) {
      if (!item || item.type !== "web_search_result" || !item.url) continue;
      results.push({
        title: item.title ?? item.url,
        url: item.url,
        snippet: "",
        publishedAt: item.page_age ?? null,
      });
    }
  }
  return results;
}

export const webSearchTool: Tool = {
  name: TOOL_NAME,
  description: "Searches the open web via Claude's server-side web_search tool and returns structured results.",

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
      return { success: false, data: null, cost_usd: 0, error: "web_search requires a string `query` param" };
    }
    const limit = typeof params.limit === "number" && params.limit > 0 ? params.limit : 10;

    const webSearchServerTool = {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: limit,
    } as unknown as ClaudeToolSpec;

    try {
      const response = await callClaudeWithTools({
        messages: [{ role: "user", content: query }],
        system: "Search the web for the user's query. Do not summarize -- the caller reads the raw search results.",
        tools: [webSearchServerTool],
      });

      const results = extractRawSearchResults(response.content).slice(0, limit);
      const capturedAt = new Date().toISOString();

      return {
        success: true,
        data: {
          query,
          results,
          snapshots: results.map((r) => ({
            source_url: r.url,
            snapshot_storage_path: `pil-web-search-snapshots/${createHash("sha256").update(`${r.url}${r.title}${capturedAt}`, "utf8").digest("hex")}.json`,
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
      return { success: false, data: null, cost_usd: 0, error: `web_search failed for "${query}": ${message}` };
    }
  },
};

export default webSearchTool;
