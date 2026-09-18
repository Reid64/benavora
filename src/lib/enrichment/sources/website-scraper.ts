import * as cheerio from "cheerio";
import { launchChromium } from "@/lib/browser/launch-chromium";

export interface ContactInfo {
  emails: string[];
  phones: string[];
  officers: Array<{ name: string; title: string }>;
  social_media: Record<string, string>;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; BenavOra/1.0; +https://benavora.com/bot)";

const CONTACT_PATH_PATTERNS = [
  "contact",
  "about",
  "about-us",
  "connect",
  "get-in-touch",
  "reach-us",
  "team",
  "staff",
  "leadership",
];

const JUNK_EMAIL_PREFIXES = [
  "noreply@",
  "no-reply@",
  "donotreply@",
  "webmaster@",
  "admin@",
  "support@",
];

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

const EXECUTIVE_TITLES = [
  "Executive Director",
  "President",
  "CEO",
  "Director",
  "Board Chair",
  "Founder",
];

function extractEmails(text: string): string[] {
  const found = text.match(EMAIL_REGEX) ?? [];
  return found.filter(
    (e) => !JUNK_EMAIL_PREFIXES.some((prefix) => e.toLowerCase().startsWith(prefix))
  );
}

function extractPhones(text: string): string[] {
  return text.match(PHONE_REGEX) ?? [];
}

function extractOfficers(
  $: cheerio.CheerioAPI
): Array<{ name: string; title: string }> {
  const officers: Array<{ name: string; title: string }> = [];
  const seen = new Set<string>();

  $("*").each((_i, el) => {
    const text = $(el).text().trim();
    for (const title of EXECUTIVE_TITLES) {
      if (text.includes(title) && text.length < 300) {
        const lines = text.split(/\n|\r/).map((l) => l.trim()).filter(Boolean);
        const titleIdx = lines.findIndex((l) => l.includes(title));
        const nameLine =
          titleIdx > 0 ? lines[titleIdx - 1] : lines[titleIdx + 1];
        if (nameLine && nameLine.length > 2 && nameLine.length < 60) {
          const key = `${nameLine}|${title}`;
          if (!seen.has(key)) {
            seen.add(key);
            officers.push({ name: nameLine, title });
          }
        }
      }
    }
  });

  return officers;
}

function extractSocialMedia(
  $: cheerio.CheerioAPI
): Record<string, string> {
  const social: Record<string, string> = {};
  const patterns: Record<string, RegExp> = {
    facebook: /facebook\.com\/[^"'\s)>]+/,
    twitter: /(?:twitter|x)\.com\/[^"'\s)>]+/,
    linkedin: /linkedin\.com\/[^"'\s)>]+/,
  };

  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    for (const [platform, regex] of Object.entries(patterns)) {
      if (!social[platform] && regex.test(href)) {
        social[platform] = href;
      }
    }
  });

  return social;
}

function parseContactInfo(html: string): ContactInfo {
  const $ = cheerio.load(html);
  const bodyText = $("body").text();

  const emails = extractEmails(bodyText);
  const phones = extractPhones(bodyText);
  const officers = extractOfficers($);
  const social_media = extractSocialMedia($);

  return { emails, phones, officers, social_media };
}

function mergeContactInfo(results: ContactInfo[]): ContactInfo {
  const emails = [...new Set(results.flatMap((r) => r.emails))];
  const phones = [...new Set(results.flatMap((r) => r.phones))];
  const social_media = Object.assign({}, ...results.map((r) => r.social_media));

  const officerKeys = new Set<string>();
  const officers: Array<{ name: string; title: string }> = [];
  for (const r of results) {
    for (const o of r.officers) {
      const key = `${o.name}|${o.title}`;
      if (!officerKeys.has(key)) {
        officerKeys.add(key);
        officers.push(o);
      }
    }
  }

  return { emails, phones, officers, social_media };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function findContactLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const origin = new URL(baseUrl).origin;
  const links: string[] = [];

  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    const lower = href.toLowerCase();
    if (CONTACT_PATH_PATTERNS.some((p) => lower.includes(p))) {
      try {
        const abs = new URL(href, origin).href;
        if (abs.startsWith(origin)) links.push(abs);
      } catch {
        // ignore malformed hrefs
      }
    }
  });

  return [...new Set(links)].slice(0, 5);
}

export class WebsiteScraper {
  async scrapeContactInfo(websiteUrl: string): Promise<ContactInfo> {
    let homepageHtml = "";
    try {
      homepageHtml = await fetchHtml(websiteUrl);
    } catch {
      return { emails: [], phones: [], officers: [], social_media: {} };
    }

    const results: ContactInfo[] = [parseContactInfo(homepageHtml)];

    const contactLinks = findContactLinks(homepageHtml, websiteUrl);
    for (const link of contactLinks) {
      await sleep(2_000);
      try {
        const html = await fetchHtml(link);
        results.push(parseContactInfo(html));
      } catch {
        // skip pages that fail
      }
    }

    const merged = mergeContactInfo(results);

    const isJsRendered =
      merged.emails.length === 0 &&
      merged.phones.length === 0 &&
      merged.officers.length === 0 &&
      homepageHtml.length < 1024;

    if (isJsRendered) {
      return this.scrapeWithPlaywright(websiteUrl);
    }

    return merged;
  }

  async scrapeWithPlaywright(websiteUrl: string): Promise<ContactInfo> {
    let playwright: typeof import("playwright") | undefined;
    try {
      playwright = await import("playwright");
    } catch {
      return { emails: [], phones: [], officers: [], social_media: {} };
    }

    const browser = await launchChromium(playwright.chromium, { headless: true });
    const results: ContactInfo[] = [];

    try {
      const context = await browser.newContext({ userAgent: USER_AGENT });
      const page = await context.newPage();

      await page.goto(websiteUrl, { timeout: 15_000, waitUntil: "networkidle" });
      const homepageHtml = await page.content();
      results.push(parseContactInfo(homepageHtml));

      const contactLinks = findContactLinks(homepageHtml, websiteUrl);
      for (const link of contactLinks) {
        await sleep(2_000);
        try {
          await page.goto(link, { timeout: 15_000, waitUntil: "networkidle" });
          const html = await page.content();
          results.push(parseContactInfo(html));
        } catch {
          // skip pages that fail
        }
      }

      await context.close();
    } finally {
      await browser.close();
    }

    return mergeContactInfo(results);
  }
}
