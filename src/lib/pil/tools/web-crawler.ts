import { createHash } from "crypto";

import * as cheerio from "cheerio";
import robotsParser from "robots-parser";

import type { AgentContext } from "@/lib/pil/agent-runner";
import type { Tool, ToolResult } from "@/lib/pil/tools";
import { serializePilError } from "@/lib/pil/serialize-error";

// T-CRAWL (PROSPECT_INTELLIGENCE_AGENTS.md's HTTP/Web Crawler + Document
// Retrieval tool). Fetches a URL, strips boilerplate markup, and returns
// clean text for an agent to turn into pil_evidence claims.
//
// pil_source_snapshots.evidence_id is NOT NULL (schema §4.2) -- a snapshot
// row can only be created once the evidence row it belongs to already
// exists, which this tool has no way to know (it isn't told what claim the
// crawled content supports, only a URL). So this tool does NOT call
// sources.ts's recordSnapshot itself; instead it returns everything a
// caller needs (source_url, content_hash, captured_at, http_status) under
// `data.snapshot` so the calling agent can recordEvidence(...) first, then
// recordSnapshot({ evidence_id: <that row's id>, ...result.data.snapshot }).

const TOOL_NAME = "web_crawl";
const USER_AGENT = "BenavoraPIL/1.0";
const FETCH_TIMEOUT_MS = 30_000;
const ROBOTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const COST_PER_CRAWL_USD = 0.001;

type Robot = ReturnType<typeof robotsParser>;

const robotsCache = new Map<string, { robots: Robot; expiresAt: number }>();

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getRobots(origin: string): Promise<Robot> {
  const cached = robotsCache.get(origin);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.robots;
  }

  const robotsUrl = `${origin}/robots.txt`;
  let body = "";
  try {
    const response = await fetchWithTimeout(robotsUrl, FETCH_TIMEOUT_MS);
    if (response.ok) {
      body = await response.text();
    }
  } catch {
    // A missing/erroring robots.txt means "no restrictions" per the robots
    // exclusion convention -- fall through with empty content.
  }

  const robots = robotsParser(robotsUrl, body);
  robotsCache.set(origin, { robots, expiresAt: Date.now() + ROBOTS_CACHE_TTL_MS });
  return robots;
}

function extractText(html: string): { text: string; title: string } {
  const $ = cheerio.load(html);
  $("script, style, nav").remove();
  const title = $("title").first().text().trim();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return { text, title };
}

export const webCrawlTool: Tool = {
  name: TOOL_NAME,
  description:
    "Fetches a URL (30s timeout, respects robots.txt), strips script/style/nav markup, and returns clean text plus title.",

  async execute(params: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
    if (!context.tools.includes(TOOL_NAME)) {
      return {
        success: false,
        data: null,
        cost_usd: 0,
        error: `Tool "${TOOL_NAME}" is not in the permitted tool set for agent ${context.agentCode}`,
      };
    }

    const url = params.url;
    if (typeof url !== "string" || url.length === 0) {
      return { success: false, data: null, cost_usd: 0, error: "web_crawl requires a string `url` param" };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { success: false, data: null, cost_usd: 0, error: `Invalid URL: ${url}` };
    }

    const origin = `${parsed.protocol}//${parsed.host}`;
    const robots = await getRobots(origin);
    if (robots.isAllowed(url, USER_AGENT) === false) {
      return {
        success: false,
        data: null,
        cost_usd: 0,
        error: `robots.txt disallows crawling ${url} for ${USER_AGENT}`,
      };
    }

    try {
      const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      const html = await response.text();
      const { text, title } = extractText(html);
      const capturedAt = new Date().toISOString();
      const contentHash = createHash("sha256").update(text, "utf8").digest("hex");

      return {
        success: response.ok,
        data: {
          text,
          title,
          url,
          http_status: response.status,
          snapshot: {
            source_url: url,
            snapshot_storage_path: `pil-crawl-snapshots/${contentHash}.txt`,
            content_hash: contentHash,
            http_status: response.status,
            captured_at: capturedAt,
          },
        },
        cost_usd: COST_PER_CRAWL_USD,
        error: response.ok ? undefined : `HTTP ${response.status} fetching ${url}`,
      };
    } catch (err) {
      const message = serializePilError(err);
      return { success: false, data: null, cost_usd: 0, error: `web_crawl failed for ${url}: ${message}` };
    }
  },
};

export default webCrawlTool;
