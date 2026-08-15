// California Grants Portal (grants.ca.gov) client — real RSS/XML parser, not
// an HTML scraper. Per STATE_PORTAL_SCOPING_2026-08-13.md §3 #1, the portal is
// WordPress-generated and ships a stable RSS feed at /grants/feed/ with
// title/link/description/pubDate and, inside content:encoded, a real <dl> of
// Agency/Department Name + Application Close Date — dramatically lower
// fragility risk than the regex/HTML approach the existing
// portal-scraper.ts/portal-config.ts stub uses (that stub is NOT reused here,
// per the scoping doc's item 5 — this is a clean, standalone addition).
//
// Nonprofit-eligibility signal (scoping doc §5 item 1, flagged unconfirmed):
// live-checked this session — the feed's content:encoded field does NOT
// carry the `applicant_type-nonprofit` CSS class or any "Applicant Type" dl
// field (confirmed by a direct grep of a live-fetched feed: zero matches for
// either). That class only appears on the non-feed HTML archive page's
// <article> elements. Rather than one secondary HTML fetch per grant (100
// items in a full feed sweep — too slow and too much load against
// Contracts §21's 5s same-domain delay), this client fetches a bounded
// number of archive listing pages (10 per grants.ca.gov/grants/ + /page/N/,
// confirmed live to hold ~10 <article> each) and cross-references by
// permalink URL, which is identical between the feed's <link> and the
// archive article's <h2 class="entry-title"><a href>. Grants whose permalink
// isn't covered by the fetched archive pages get `nonprofitEligible: null`
// (unknown), never a fabricated `false`.

import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";

import { decodeHtmlEntities } from "@/lib/utils/formatters";

const CA_GRANTS_FEED_URL = "https://www.grants.ca.gov/grants/feed/";
const CA_GRANTS_ARCHIVE_BASE = "https://www.grants.ca.gov/grants/";

const USER_AGENT = "Mozilla/5.0 (compatible; Benavora/1.0; grant-research-bot)";

// Contracts §21: minimum 5-second delay between requests to the same domain.
const SAME_DOMAIN_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CaGrantsPortalNormalizedOpportunity {
  /** The grant's permalink — stable, unique, used as the dedup key. */
  externalUrl: string;
  name: string;
  description: string | null;
  agency: string | null;
  /** ISO-8601 (YYYY-MM-DD) application close date, or null when not parseable. */
  deadline: string | null;
  /** Raw "Type" dl value from content:encoded — typically "active" or "forecasted". */
  feedStatus: string | null;
  pubDate: string | null;
  /** true = confirmed nonprofit-eligible, false = never observed (not emitted — see module header), null = unknown/not covered by the fetched archive pages. */
  nonprofitEligible: boolean | null;
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  if (typeof val === "object" && "__cdata" in (val as Record<string, unknown>)) {
    return toStr((val as Record<string, unknown>).__cdata);
  }
  if (typeof val === "object" && "#text" in (val as Record<string, unknown>)) {
    return toStr((val as Record<string, unknown>)["#text"]);
  }
  return String(val).trim();
}

// content:encoded's dl entries use human date text like
// "Mon, 01 Feb 2027 12:00:00 +0000" in the <time datetime="..."> attribute.
function parseCloseDateIso(contentEncodedHtml: string): string | null {
  const $ = cheerio.load(contentEncodedHtml);
  let closeDateText = "";
  let timeAttr = "";

  $("dt").each((_i, dt) => {
    const label = $(dt).text().trim();
    if (label !== "Application Close Date") return;
    const dd = $(dt).next("dd");
    const time = dd.find("time");
    if (time.length > 0) {
      timeAttr = time.attr("datetime") ?? "";
    }
    closeDateText = dd.text().trim();
  });

  const raw = timeAttr || closeDateText;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseAgency(contentEncodedHtml: string): string | null {
  const $ = cheerio.load(contentEncodedHtml);
  let agency = "";
  $("dt").each((_i, dt) => {
    const label = $(dt).text().trim();
    if (label !== "Agency/Department Name") return;
    agency = $(dt).next("dd").text().trim();
  });
  return agency || null;
}

function parseType(contentEncodedHtml: string): string | null {
  const $ = cheerio.load(contentEncodedHtml);
  let type = "";
  $("dt").each((_i, dt) => {
    const label = $(dt).text().trim();
    if (label !== "Type") return;
    type = $(dt).next("dd").text().trim();
  });
  return type || null;
}

/**
 * Fetches and parses the CA Grants Portal RSS/XML feed. Returns opportunities
 * normalised toward the `opportunities` table shape, with
 * `nonprofitEligible: null` for every item (the caller cross-references
 * against `fetchNonprofitEligibleUrls` separately, since that requires its
 * own set of HTTP requests against a different endpoint).
 */
export async function fetchCaGrantsPortalFeed(): Promise<
  CaGrantsPortalNormalizedOpportunity[]
> {
  const response = await fetch(CA_GRANTS_FEED_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, text/xml" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`CA Grants Portal feed returned HTTP ${response.status}.`);
  }
  const xml = await response.text();

  const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: "__cdata" });
  const parsed = parser.parse(xml) as {
    rss?: { channel?: { item?: unknown } };
  };

  const rawItems = parsed.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  const results: CaGrantsPortalNormalizedOpportunity[] = [];
  for (const raw of items as Record<string, unknown>[]) {
    const externalUrl = toStr(raw.link);
    const name = decodeHtmlEntities(toStr(raw.title));
    if (!externalUrl || !name) continue;

    const contentEncoded = toStr(raw["content:encoded"]);

    results.push({
      externalUrl,
      name,
      description: decodeHtmlEntities(toStr(raw.description)) || null,
      agency: contentEncoded ? parseAgency(contentEncoded) : null,
      deadline: contentEncoded ? parseCloseDateIso(contentEncoded) : null,
      feedStatus: contentEncoded ? parseType(contentEncoded) : null,
      pubDate: toStr(raw.pubDate) || null,
      nonprofitEligible: null,
    });
  }

  return results;
}

/**
 * Fetches up to `maxPages` of the CA Grants Portal's HTML archive listing
 * (grants.ca.gov/grants/, /grants/page/2/, ...) and returns the set of
 * permalink URLs whose <article> carries the `applicant_type-nonprofit` CSS
 * class — the only place this repo found that signal to actually exist (see
 * module header). Stops early if a page 404s or returns zero articles.
 * Applies the Contracts §21 5s same-domain delay between requests.
 */
export async function fetchNonprofitEligibleUrls(
  maxPages = 10,
): Promise<Set<string>> {
  const eligible = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) await sleep(SAME_DOMAIN_DELAY_MS);

    const url = page === 1 ? CA_GRANTS_ARCHIVE_BASE : `${CA_GRANTS_ARCHIVE_BASE}page/${page}/`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      break;
    }

    if (!response.ok) break;

    const html = await response.text();
    const $ = cheerio.load(html);
    const articles = $("article");
    if (articles.length === 0) break;

    articles.each((_i, article) => {
      const classAttr = $(article).attr("class") ?? "";
      if (!classAttr.split(/\s+/).includes("applicant_type-nonprofit")) return;
      const href = $(article).find("h2.entry-title a").attr("href");
      if (href) eligible.add(href.trim());
    });
  }

  return eligible;
}
