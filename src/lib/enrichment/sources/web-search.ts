import * as cheerio from "cheerio";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const EXCLUDED_DOMAINS = [
  "facebook.com",
  "twitter.com",
  "linkedin.com",
  "instagram.com",
  "youtube.com",
  "guidestar.org",
  "candid.org",
  "charitynavigator.org",
  "yelp.com",
  "bbb.org",
  "irs.gov",
  "sec.gov",
  "bloomberg.com",
  "dnb.com",
];

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isExcluded(url: string): boolean {
  const host = extractHostname(url);
  return EXCLUDED_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

function scoreDomain(url: string, orgName: string): number {
  const host = extractHostname(url);
  let score = 0;

  if (host.endsWith(".org")) score += 20;
  if (host.endsWith(".com")) score += 5;

  const nameParts = orgName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 3);

  for (const part of nameParts) {
    if (host.includes(part)) score += 15;
  }

  return score;
}

export class WebSearchSource {
  private searxngUrl: string;

  constructor() {
    this.searxngUrl = process.env.SEARXNG_URL ?? "http://localhost:8080";
  }

  async searchForWebsite(
    orgName: string,
    city?: string,
    state?: string
  ): Promise<string | null> {
    const locationParts = [city, state].filter(Boolean).join(" ");
    const query = `${orgName}${locationParts ? " " + locationParts : ""} official website`;

    let results: SearchResult[] = [];

    const searxResults = await this.searchSearXNG(query);
    if (searxResults.length > 0) {
      results = searxResults;
    } else {
      results = await this.searchDuckDuckGo(query);
    }

    const candidates = results
      .slice(0, 5)
      .filter((r) => !isExcluded(r.url))
      .map((r) => ({ ...r, score: scoreDomain(r.url, orgName) }))
      .sort((a, b) => b.score - a.score);

    for (const candidate of candidates) {
      const valid = await this.validateUrl(candidate.url);
      if (valid) return candidate.url;
    }

    return null;
  }

  async searchDuckDuckGo(query: string): Promise<SearchResult[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": BROWSER_UA },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) return [];

      const html = await res.text();
      const $ = cheerio.load(html);
      const results: SearchResult[] = [];

      $(".result").each((_i, el) => {
        const titleEl = $(el).find(".result__title a");
        const snippetEl = $(el).find(".result__snippet");
        const rawUrl =
          titleEl.attr("href") ?? $(el).find(".result__url").text().trim();

        const title = titleEl.text().trim();
        const snippet = snippetEl.text().trim();

        let resolvedUrl = rawUrl;
        try {
          const parsed = new URL(rawUrl);
          resolvedUrl =
            parsed.searchParams.get("uddg") ??
            parsed.searchParams.get("u") ??
            rawUrl;
        } catch {
          // use rawUrl as-is
        }

        if (resolvedUrl && title) {
          results.push({ title, url: resolvedUrl, snippet });
        }
      });

      return results;
    } catch {
      return [];
    }
  }

  async searchSearXNG(query: string): Promise<SearchResult[]> {
    try {
      const url = `${this.searxngUrl}/search?q=${encodeURIComponent(query)}&format=json`;
      const res = await fetch(url, {
        headers: { "User-Agent": BROWSER_UA },
        signal: AbortSignal.timeout(5_000),
      });

      if (!res.ok) return [];

      const data = (await res.json()) as {
        results?: Array<{ url: string; title: string; content?: string }>;
      };

      return (data.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.content ?? "",
      }));
    } catch {
      return [];
    }
  }

  async validateUrl(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": BROWSER_UA },
        signal: AbortSignal.timeout(5_000),
        redirect: "follow",
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
