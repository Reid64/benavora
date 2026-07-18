// ============================================================================
// BENAVORA — nonprofit website contact enrichment (tier 2) for the
// nonprofits table
//
// For nonprofits that have a discovered website but no enrichment yet
// (last_enriched_at IS NULL), crawls a small set of likely contact/about/team
// pages, extracts emails, phone numbers, social links, and an executive
// officer contact + staff list, and writes them back (migration 099).
// Concurrency-limited with p-limit (5), 1s delay between domains to stay
// polite to hosting providers. Since last_enriched_at flips from null to a
// timestamp as soon as a row is written, an enriched row drops out of the
// WHERE filter on the very next query — the database is the checkpoint, so a
// killed run resumes cleanly, same convention as scripts/enrich-foundations-propublica.ts.
//
//   pnpm enrich:websites
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import * as cheerio from "cheerio";
import pLimit from "p-limit";

const BATCH_SIZE = 500;
const CONCURRENCY = 5;
const DOMAIN_DELAY_MS = 1_000;
const FETCH_TIMEOUT_MS = 8_000;
const LOG_EVERY = 100;

const CONTACT_PATHS = ["", "/contact", "/contact-us", "/about", "/staff", "/team", "/leadership"];

const JUNK_EMAIL_PREFIXES = [
  "info@",
  "hello@",
  "support@",
  "noreply@",
  "webmaster@",
  "admin@",
  "donate@",
  "volunteer@",
  "contact@",
];

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

const EXECUTIVE_KEYWORDS = ["director", "president", "ceo", "executive", "founder", "officer"];

type SocialKey = "linkedin_url" | "facebook_url" | "twitter_url" | "instagram_url";

const SOCIAL_PATTERNS: Record<SocialKey, RegExp> = {
  linkedin_url: /linkedin\.com\/[^"'\s)>]+/i,
  facebook_url: /facebook\.com\/[^"'\s)>]+/i,
  twitter_url: /twitter\.com\/[^"'\s)>]+/i,
  instagram_url: /instagram\.com\/[^"'\s)>]+/i,
};

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface NonprofitRow {
  id: string;
  ein: string;
  website: string;
}

interface StaffContact {
  name: string;
  title: string;
  email: string | null;
}

interface PageExtract {
  emails: string[];
  phones: string[];
  social: Partial<Record<SocialKey, string>>;
  officerEmail: string | null;
  staffContacts: StaffContact[];
}

function isJunkEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return JUNK_EMAIL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function extractSocial($: cheerio.CheerioAPI): Partial<Record<SocialKey, string>> {
  const social: Partial<Record<SocialKey, string>> = {};
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    for (const key of Object.keys(SOCIAL_PATTERNS) as SocialKey[]) {
      if (!social[key] && SOCIAL_PATTERNS[key].test(href)) {
        social[key] = href;
      }
    }
  });
  return social;
}

function nearExecutiveContext(text: string): boolean {
  const lower = text.toLowerCase();
  return EXECUTIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

function extractOfficerEmailAndStaff($: cheerio.CheerioAPI): {
  officerEmail: string | null;
  staffContacts: StaffContact[];
} {
  let officerEmail: string | null = null;
  const staffContacts: StaffContact[] = [];
  const seen = new Set<string>();

  $("a[href^='mailto:']").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    const email = href.replace(/^mailto:/i, "").split("?")[0].trim();
    if (!email || isJunkEmail(email)) return;

    const container = $(el).closest("div, li, tr, section, article, p");
    const contextText = (container.length ? container.text() : $(el).parent().text()).trim();
    if (contextText.length > 500 || !nearExecutiveContext(contextText)) return;

    if (!officerEmail) officerEmail = email;

    const lines = contextText.split(/\n|\r/).map((l) => l.trim()).filter(Boolean);
    const titleLineIdx = lines.findIndex((l) =>
      EXECUTIVE_KEYWORDS.some((kw) => l.toLowerCase().includes(kw)),
    );
    const titleLine = titleLineIdx >= 0 ? lines[titleLineIdx] : undefined;
    const nameLine =
      titleLineIdx > 0
        ? lines[titleLineIdx - 1]
        : titleLineIdx === 0
          ? lines[titleLineIdx + 1]
          : undefined;

    const name = nameLine && nameLine.length > 1 && nameLine.length < 60 ? nameLine : "Unknown";
    const title = titleLine && titleLine.length < 100 ? titleLine : "Unknown";
    const key = `${name}|${title}|${email}`;
    if (!seen.has(key)) {
      seen.add(key);
      staffContacts.push({ name, title, email });
    }
  });

  return { officerEmail, staffContacts };
}

function extractFromHtml(html: string): PageExtract {
  const $ = cheerio.load(html);
  const bodyText = $("body").text();

  const emailMatches = bodyText.match(EMAIL_REGEX) ?? [];
  const emails = [...new Set(emailMatches.filter((e) => !isJunkEmail(e)))];
  const phones = [...new Set(bodyText.match(PHONE_REGEX) ?? [])];
  const social = extractSocial($);
  const { officerEmail, staffContacts } = extractOfficerEmailAndStaff($);

  return { emails, phones, social, officerEmail, staffContacts };
}

function mergePageExtracts(pages: PageExtract[]): PageExtract {
  const emails = [...new Set(pages.flatMap((p) => p.emails))];
  const phones = [...new Set(pages.flatMap((p) => p.phones))];
  const social: Partial<Record<SocialKey, string>> = Object.assign({}, ...pages.map((p) => p.social));
  const officerEmail = pages.find((p) => p.officerEmail)?.officerEmail ?? null;

  const staffKeys = new Set<string>();
  const staffContacts: StaffContact[] = [];
  for (const page of pages) {
    for (const contact of page.staffContacts) {
      const key = `${contact.name}|${contact.title}|${contact.email}`;
      if (!staffKeys.has(key)) {
        staffKeys.add(key);
        staffContacts.push(contact);
      }
    }
  }

  return { emails, phones, social, officerEmail, staffContacts };
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function scrapeOrg(websiteUrl: string): Promise<PageExtract> {
  let origin: string;
  try {
    origin = new URL(websiteUrl).origin;
  } catch {
    origin = websiteUrl;
  }

  const pages: PageExtract[] = [];
  for (const path of CONTACT_PATHS) {
    const html = await fetchPage(`${origin}${path}`);
    if (html) pages.push(extractFromHtml(html));
  }

  return mergePageExtracts(pages);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    // ws's WebSocket type isn't structurally identical to realtime-js's
    // WebSocketLikeConstructor (event handler signatures differ); runtime
    // behavior is unaffected. Same pattern as scripts/batch-score-opportunities.ts.
    realtime: { transport: ws as any },
  });

  console.log("Nonprofit website contact enrichment — nonprofits table (tier 2)");
  console.log("Population: website IS NOT NULL AND last_enriched_at IS NULL");
  console.log(`Batch size: ${BATCH_SIZE}, concurrency: ${CONCURRENCY}\n`);

  const limit = pLimit(CONCURRENCY);
  const startedAt = Date.now();
  let processed = 0;
  let enriched = 0;
  let failed = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("nonprofits")
      .select("id, ein, website")
      .not("website", "is", null)
      .is("last_enriched_at", null)
      .order("revenue_amount", { ascending: false, nullsFirst: false })
      .limit(BATCH_SIZE);

    if (error) {
      fatal(`could not query nonprofits: ${error.message}`);
    }

    const batch = (data ?? []) as NonprofitRow[];
    if (batch.length === 0) break;

    await Promise.all(
      batch.map((org) =>
        limit(async () => {
          try {
            const extract = await scrapeOrg(org.website);
            await sleep(DOMAIN_DELAY_MS);

            const { error: updateError } = await supabase
              .from("nonprofits")
              .update({
                officer_email: extract.officerEmail,
                contact_emails: JSON.stringify(extract.emails),
                staff_contacts: JSON.stringify(extract.staffContacts),
                phone: extract.phones[0] ?? null,
                linkedin_url: extract.social.linkedin_url ?? null,
                facebook_url: extract.social.facebook_url ?? null,
                twitter_url: extract.social.twitter_url ?? null,
                instagram_url: extract.social.instagram_url ?? null,
                enrichment_tier: 2,
                last_enriched_at: new Date().toISOString(),
              })
              .eq("ein", org.ein);

            if (updateError) {
              failed++;
              fail(`update EIN ${org.ein}`, updateError);
            } else {
              enriched++;
            }
          } catch (err) {
            failed++;
            fail(`scrape EIN ${org.ein}`, err);
          }

          processed++;
          if (processed % LOG_EVERY === 0) {
            const elapsedMin = (Date.now() - startedAt) / 60_000;
            const rate = elapsedMin > 0 ? Math.round(processed / elapsedMin) : 0;
            console.log(
              `  … processed ${processed}, enriched ${enriched}, failed ${failed}, rate ${rate}/min`,
            );
          }
        }),
      ),
    );

    if (batch.length < BATCH_SIZE) break;
  }

  console.log("\nDone.");
  console.log(`  Records processed: ${processed}`);
  console.log(`  Enriched:          ${enriched}`);
  console.log(`  Failed:            ${failed}`);
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
