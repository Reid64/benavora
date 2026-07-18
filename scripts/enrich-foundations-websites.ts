// ============================================================================
// BENAVORA — foundation_directory website contact scraper
//
// Lightweight companion to scripts/enrich-foundations-web.ts (which calls
// Claude to extract a full structured "foundation" profile). This script
// makes NO LLM calls — it fetches each foundation's website (+ /contact,
// /about), strips HTML, and pulls contact emails, phone numbers, and officer
// names with plain string/regex matching. Cheap, fast, no token cost.
//
// Population: foundation_directory rows with a website that this script
// hasn't scraped yet (enrichment->>'website_scraped_at' IS NULL), largest
// foundations (by asset_amount) first, 200 per invocation.
//
// Note: foundation_directory also has dedicated contact_emails/
// contact_phones/officers columns (migration 058). This script deliberately
// writes its findings into enrichment.contact_emails / enrichment.contact_phones
// / enrichment.officers instead, matching the jsonb-merge shape
// enrich-foundations-web.ts and enrich-foundations-990.ts already use for
// this column, rather than repurposing those dedicated columns.
//
//   pnpm enrich:websites
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

const FETCH_TIMEOUT_MS = 10_000;
const REQUEST_DELAY_MS = 2_000;
const LIMIT = 200;
const LOG_EVERY = 25;
const PATH_SUFFIXES = ["", "/contact", "/about"];

const OFFICER_TITLES = [
  "Executive Director",
  "Founder",
  "President",
  "Vice President",
  "Chief Executive Officer",
  "CEO",
  "Chief Financial Officer",
  "CFO",
  "Chairman",
  "Chairwoman",
  "Board Chair",
  "Treasurer",
  "Secretary",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FoundationRow {
  id: string;
  ein: string;
  name: string;
  website: string;
  enrichment: Record<string, unknown> | null;
}

async function loadCandidates(
  admin: ReturnType<typeof createAdminClient>,
): Promise<FoundationRow[]> {
  const { data, error } = await admin
    .from("foundation_directory")
    .select("id, ein, name, website, enrichment")
    .not("website", "is", null)
    .is("enrichment->>website_scraped_at", null)
    .order("asset_amount", { ascending: false, nullsFirst: false })
    .limit(LIMIT);

  if (error) fatal(`could not load candidate rows: ${error.message}`);
  return (data ?? []) as FoundationRow[];
}

// ----------------------------------------------------------------------------
// Fetch — 10s timeout, treats network errors / non-2xx / non-HTML responses
// as "no content" rather than fatal so one dead site never halts the batch.
// ----------------------------------------------------------------------------
async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BenavoraBot/1.0)" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function resolveUrl(base: string, suffix: string): string | null {
  try {
    const normalized = /^https?:\/\//i.test(base) ? base : `https://${base}`;
    const parsed = new URL(normalized);
    if (!suffix) return parsed.toString();
    parsed.pathname = (parsed.pathname.replace(/\/$/, "") || "") + suffix;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Extraction — plain string/regex matching over raw HTML and a stripped-tag
// text version. No LLM calls.
// ----------------------------------------------------------------------------
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const EMAIL_RE = /[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}/g;
const EMAIL_EXCLUDE_RE = /\.(png|jpe?g|gif|svg|webp|css|js)$|example\.(com|org)$|sentry\.io$|wixpress\.com$/i;

function extractEmails(html: string, text: string): string[] {
  const found = new Set<string>();
  for (const match of `${html}\n${text}`.match(EMAIL_RE) ?? []) {
    const email = match.toLowerCase();
    if (EMAIL_EXCLUDE_RE.test(email)) continue;
    found.add(email);
  }
  return [...found].slice(0, 5);
}

const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;

function extractPhones(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.match(PHONE_RE) ?? []) {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 10) continue;
    found.add(match.trim());
  }
  return [...found].slice(0, 5);
}

const NAME_PART = "[A-Z][a-zA-Z'.-]+";
const NAME_RE = `${NAME_PART}(?:\\s+${NAME_PART}){1,2}`;
const TITLE_ALTERNATION = OFFICER_TITLES.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const TITLE_THEN_NAME_RE = new RegExp(`\\b(${TITLE_ALTERNATION})\\s*[:,-]?\\s+(${NAME_RE})`, "g");
const NAME_THEN_TITLE_RE = new RegExp(`\\b(${NAME_RE})\\s*[,-]\\s*(${TITLE_ALTERNATION})\\b`, "g");

interface Officer {
  name: string;
  title: string;
}

function extractOfficers(text: string): Officer[] {
  const found = new Map<string, Officer>();

  for (const match of text.matchAll(TITLE_THEN_NAME_RE)) {
    const title = match[1]?.trim();
    const name = match[2]?.trim();
    if (!title || !name) continue;
    found.set(name.toLowerCase(), { name, title });
  }
  for (const match of text.matchAll(NAME_THEN_TITLE_RE)) {
    const name = match[1]?.trim();
    const title = match[2]?.trim();
    if (!title || !name) continue;
    if (!found.has(name.toLowerCase())) found.set(name.toLowerCase(), { name, title });
  }

  return [...found.values()].slice(0, 10);
}

// ----------------------------------------------------------------------------
// Per-foundation scrape — fetches base/contact/about pages sequentially,
// waiting 2s after each request, merging extraction results across every
// page that responded.
// ----------------------------------------------------------------------------
interface ScrapeResult {
  emails: string[];
  phones: string[];
  officers: Officer[];
  pagesFetched: number;
}

async function scrapeFoundation(websiteRaw: string): Promise<ScrapeResult> {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const officers = new Map<string, Officer>();
  let pagesFetched = 0;

  for (const suffix of PATH_SUFFIXES) {
    const url = resolveUrl(websiteRaw, suffix);
    if (!url) continue;

    const html = await fetchHtml(url);
    await sleep(REQUEST_DELAY_MS);
    if (!html) continue;

    pagesFetched++;
    const text = stripHtml(html);
    for (const e of extractEmails(html, text)) emails.add(e);
    for (const p of extractPhones(text)) phones.add(p);
    for (const o of extractOfficers(text)) officers.set(o.name.toLowerCase(), o);
  }

  return {
    emails: [...emails].slice(0, 5),
    phones: [...phones].slice(0, 5),
    officers: [...officers.values()].slice(0, 10),
    pagesFetched,
  };
}

// ----------------------------------------------------------------------------
// Enrichment jsonb merge — dedupe against whatever this key already held
// rather than clobbering it.
// ----------------------------------------------------------------------------
function mergeStringArray(existing: unknown, fresh: string[]): string[] {
  const base = Array.isArray(existing)
    ? (existing as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  return [...new Set([...base, ...fresh])];
}

function mergeOfficers(existing: unknown, fresh: Officer[]): Officer[] {
  const map = new Map<string, Officer>();
  if (Array.isArray(existing)) {
    for (const entry of existing as unknown[]) {
      if (entry && typeof entry === "object" && "name" in entry && "title" in entry) {
        const officer = entry as Officer;
        map.set(String(officer.name).toLowerCase(), officer);
      }
    }
  }
  for (const officer of fresh) map.set(officer.name.toLowerCase(), officer);
  return [...map.values()];
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  const admin = createAdminClient();

  console.log("Scraping foundation websites for contact emails, phones, and officers");
  console.log(`Limit: ${LIMIT}, timeout: ${FETCH_TIMEOUT_MS}ms, delay: ${REQUEST_DELAY_MS}ms\n`);

  const candidates = await loadCandidates(admin);
  ok("load candidates", `${candidates.length} row(s) with a website not yet scraped`);

  let processed = 0;
  let emailsFound = 0;
  let phonesFound = 0;
  let officersFound = 0;
  let failed = 0;

  for (const row of candidates) {
    processed++;
    const existingEnrichment = row.enrichment ?? {};
    const nowIso = new Date().toISOString();

    try {
      const result = await scrapeFoundation(row.website);

      const enrichment: Record<string, unknown> = {
        ...existingEnrichment,
        contact_emails: mergeStringArray(existingEnrichment.contact_emails, result.emails),
        contact_phones: mergeStringArray(existingEnrichment.contact_phones, result.phones),
        officers: mergeOfficers(existingEnrichment.officers, result.officers),
        website_scraped_at: nowIso,
      };

      const { error } = await admin
        .from("foundation_directory")
        .update({ enrichment })
        .eq("id", row.id);

      if (error) {
        failed++;
        fail(`update ${row.ein}`, error);
      } else {
        if (result.emails.length > 0) emailsFound++;
        if (result.phones.length > 0) phonesFound++;
        if (result.officers.length > 0) officersFound++;
      }
    } catch (err) {
      failed++;
      fail(`scrape ${row.ein}`, err);
      // Still mark this row scraped so a permanently broken site drops out
      // of the WHERE filter instead of occupying the LIMIT window forever.
      await admin
        .from("foundation_directory")
        .update({ enrichment: { ...existingEnrichment, website_scraped_at: nowIso } })
        .eq("id", row.id);
    }

    if (processed % LOG_EVERY === 0 || processed === candidates.length) {
      console.log(
        `  … ${processed}/${candidates.length} scraped — emails ${emailsFound}, phones ${phonesFound}, officers ${officersFound}, failed ${failed}`,
      );
    }
  }

  console.log("\nDone.");
  console.log(`  Foundations scraped: ${processed}`);
  console.log(`  Gained emails:       ${emailsFound}`);
  console.log(`  Gained phones:       ${phonesFound}`);
  console.log(`  Gained officers:     ${officersFound}`);
  console.log(`  Failed:              ${failed}`);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
