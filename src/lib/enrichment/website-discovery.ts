import { WebSearchSource, type SearchResult } from "@/lib/enrichment/sources/web-search";

/**
 * Fallback website discovery for foundation_directory rows with no
 * website_url — used by scripts/enrich-foundations-web.ts before it attempts
 * a web-extraction pass. Queries the same SearXNG-backed WebSearchSource the
 * interactive enrichment job uses, but applies its own aggregator exclusion
 * list and fuzzy-name verification rather than WebSearchSource's built-in
 * "official website" heuristic, since a false-positive here would poison the
 * enrichment jsonb for that foundation permanently.
 */

const AGGREGATOR_DOMAINS = [
  "guidestar.org",
  "propublica.org",
  "causeiq.org",
  "charitynavigator.org",
  "instrumentl.com",
  "linkedin.com",
  "facebook.com",
];

export interface WebsiteDiscoveryResult {
  url: string;
  confidence: number;
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isAggregator(url: string): boolean {
  const host = extractHostname(url);
  return AGGREGATOR_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fraction of the foundation name's significant tokens found in the haystack text. */
function nameMatchScore(orgName: string, haystack: string): number {
  const nameTokens = normalize(orgName)
    .split(" ")
    .filter((t) => t.length > 2);
  if (nameTokens.length === 0) return 0;

  const haystackTokens = new Set(normalize(haystack).split(" "));
  const matched = nameTokens.filter((t) => haystackTokens.has(t)).length;
  return matched / nameTokens.length;
}

/**
 * Searches for a foundation's own website via SearXNG and returns the top
 * organic (non-aggregator) result if its title/snippet fuzzy-matches the
 * foundation's name closely enough (similarity > 0.5). Returns null if
 * SearXNG is unavailable, yields nothing usable, or the top result doesn't
 * clear the confidence threshold.
 */
export async function discoverWebsite(
  name: string,
  city?: string | null,
  state?: string | null,
): Promise<WebsiteDiscoveryResult | null> {
  const locationParts = [city, state].filter((p): p is string => Boolean(p)).join(" ");
  const query = `${name} foundation${locationParts ? " " + locationParts : ""}`;

  let results: SearchResult[];
  try {
    results = await new WebSearchSource().searchSearXNG(query);
  } catch {
    return null;
  }

  const topOrganic = results.find((r) => r.url && !isAggregator(r.url));
  if (!topOrganic) return null;

  const confidence = nameMatchScore(name, `${topOrganic.title} ${topOrganic.snippet}`);
  if (confidence <= 0.5) return null;

  return { url: topOrganic.url, confidence };
}
