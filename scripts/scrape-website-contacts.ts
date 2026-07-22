// ============================================================================
// BENAVORA — nonprofit website contact scraping via Crawlee's CheerioCrawler
//
// For nonprofits that already have a website, crawls a handful of likely
// contact pages (home, /contact, /about, /staff, /leadership, /team) and
// regex-extracts emails, phone numbers, and an officer/executive name.
// Pure HTTP crawling (CheerioCrawler — no browser, no JS execution): fast,
// low memory, and Crawlee handles retries/concurrency/robots.txt for us.
//
// NO API key, no LLM call — this is the cheap regex-only pass. Unlike
// scripts/enrich-website-contacts.ts (Claude-powered, tier 2), this script
// doesn't distinguish "the general inbox" from "the ED's personal email";
// it just takes the first usable address it finds per org as officer_email
// and keeps the full deduped set (comma-joined) as contact_emails.
//
// Idempotent / COALESCE semantics: never overwrites a non-NULL column.
// Idle misses are left untouched (not stamped), so pagination walks forward
// by id (keyset cursor) rather than re-querying the same filter from the
// top each batch — otherwise a batch that finds nothing would re-select the
// same 200 rows forever within a single run.
// State-partitioned: pass --states TX,CA,FL, same convention as
// scripts/enrich-propublica-contacts.ts.
//
//   pnpm scrape:contacts
//   pnpm scrape:contacts -- --states TX,CA,FL
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { parseArgs } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CheerioCrawler, type CheerioCrawlingContext } from "crawlee";
import ws from "ws";

// ---- Config -----------------------------------------------------------------
const BATCH_SIZE = 200;
const MAX_CONCURRENCY = 8;
const REQUEST_HANDLER_TIMEOUT_SECS = 15;
const BATCH_DELAY_MS = 500;
const LOG_EVERY_BATCHES = 1;

const CONTACT_PATHS = ["/contact", "/about", "/staff", "/leadership", "/team"];
const MAX_PAGES_PER_ORG = 1 + CONTACT_PATHS.length; // homepage + the 5 above

const TITLE_KEYWORDS = ["Executive Director", "Chief Executive Officer", "President", "CEO", "Director"];
const NAME_WINDOW = 100;

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/g;
const FILE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|ico|bmp|pdf|docx?|xlsx?|css|js|woff2?|ttf|eot|zip)$/i;

// ---- Helpers ----------------------------------------------------------------
function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseStatesArg(): string[] | null {
  try {
    const { values } = parseArgs({ options: { states: { type: "string" } } });
    if (!values.states) return null;
    return values.states.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  } catch {
    return null;
  }
}

interface NonprofitRow {
  id: string;
  website: string;
  officer_email: string | null;
  contact_emails: string | null;
  phone: string | null;
  officer_name: string | null;
}

interface PageUserData {
  orgId: string;
}

interface OrgResult {
  emails: Set<string>;
  phones: Set<string>;
  officerName: string | null;
}

function filterEmails(raw: string[]): string[] {
  const deduped = Array.from(new Set(raw.map((e) => e.trim().toLowerCase())));
  const clean = deduped.filter(
    (e) => !FILE_EXT_RE.test(e) && !e.startsWith("noreply@") && !e.startsWith("no-reply@")
  );
  const nonInfo = clean.filter((e) => !e.startsWith("info@"));
  return nonInfo.length > 0 ? nonInfo : clean;
}

function normalizePhone(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function extractOfficerName(text: string): string | null {
  for (const title of TITLE_KEYWORDS) {
    const idx = text.indexOf(title);
    if (idx === -1) continue;
    const start = Math.max(0, idx - NAME_WINDOW);
    const end = Math.min(text.length, idx + title.length + NAME_WINDOW);
    const window = text.slice(start, end);
    const match = window.match(/[A-Z][a-z]+(?:\s[A-Z]\.)?\s[A-Z][a-z]+(?:\s[A-Z][a-z]+)?/);
    if (match) return match[0].trim();
  }
  return null;
}

function buildOrgUrls(website: string): string[] {
  try {
    const origin = new URL(website).origin;
    return [origin, ...CONTACT_PATHS.map((p) => `${origin}${p}`)];
  } catch {
    return [];
  }
}

async function scrapeBatch(
  db: SupabaseClient,
  rows: NonprofitRow[],
  stats: { processed: number; updated: number; emailsFound: number; phonesFound: number }
) {
  const results = new Map<string, OrgResult>();
  const requests: { url: string; userData: PageUserData }[] = [];

  for (const row of rows) {
    results.set(row.id, { emails: new Set(), phones: new Set(), officerName: null });
    for (const url of buildOrgUrls(row.website).slice(0, MAX_PAGES_PER_ORG)) {
      requests.push({ url, userData: { orgId: row.id } });
    }
  }

  if (requests.length === 0) return;

  const crawler = new CheerioCrawler({
    maxConcurrency: MAX_CONCURRENCY,
    // Crawlee has no native "N requests per domain" cap — the per-org limit
    // of MAX_PAGES_PER_ORG is enforced structurally above (only that many
    // URLs are ever enqueued per org). This total is just a batch-wide
    // safety ceiling. (navigationTimeoutSecs isn't a CheerioCrawler option —
    // it's browser-crawler-only; CheerioCrawler makes plain HTTP requests
    // with no navigation phase, so requestHandlerTimeoutSecs is the
    // equivalent knob here.)
    maxRequestsPerCrawl: requests.length,
    requestHandlerTimeoutSecs: REQUEST_HANDLER_TIMEOUT_SECS,
    async requestHandler({ $, request, log: crawlerLog }: CheerioCrawlingContext) {
      const userData = request.userData as PageUserData;
      const org = results.get(userData.orgId);
      if (!org) return;

      const bodyText = $("body").text();
      const mailtoEmails = $('a[href^="mailto:"]')
        .map((_, el) => ($(el).attr("href") ?? "").replace(/^mailto:/i, "").split("?")[0] ?? "")
        .get()
        .filter(Boolean);

      const rawEmails = [...(bodyText.match(EMAIL_REGEX) ?? []), ...mailtoEmails];
      for (const email of filterEmails(rawEmails)) org.emails.add(email);

      const phones = bodyText.match(PHONE_REGEX) ?? [];
      for (const phone of phones) org.phones.add(normalizePhone(phone));

      if (!org.officerName) {
        const name = extractOfficerName(bodyText);
        if (name) org.officerName = name;
      }

      crawlerLog.debug(`Scraped ${request.url}`);
    },
    async failedRequestHandler({ request, log: crawlerLog }) {
      crawlerLog.debug(`Failed: ${request.url}`);
    },
  });

  await crawler.run(requests);

  for (const row of rows) {
    stats.processed++;
    const result = results.get(row.id);
    if (!result) continue;

    const update: Record<string, string> = {};

    if (row.contact_emails === null && result.emails.size > 0) {
      update.contact_emails = Array.from(result.emails).join(",");
    }
    if (row.officer_email === null && result.emails.size > 0) {
      update.officer_email = Array.from(result.emails)[0]!;
    }
    if (row.phone === null && result.phones.size > 0) {
      update.phone = Array.from(result.phones)[0]!;
    }
    if (row.officer_name === null && result.officerName) {
      update.officer_name = result.officerName;
    }

    if (Object.keys(update).length > 0) {
      const { error } = await db.from("nonprofits").update(update).eq("id", row.id);
      if (!error) {
        stats.updated++;
        if (update.contact_emails) stats.emailsFound++;
        if (update.phone) stats.phonesFound++;
      }
    }
  }
}

// ws's constructor overloads (some accept `address: null` for lazy-connect)
// aren't structurally assignable to realtime-js's WebSocketLikeConstructor
// as-is; ws is otherwise a drop-in WebSocketLike implementation, so re-type
// it through `unknown` rather than widen with `any`.
type WsTransport = new (address: string | URL, subprotocols?: string | string[]) => WebSocket;

async function main() {
  const states = parseStatesArg();

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: {} }, realtime: { transport: ws as unknown as WsTransport } }
  );

  const stateLabel = states ? states.join(",") : "ALL";
  log(`Website contact scraping starting — states: ${stateLabel}`);

  const stats = { processed: 0, updated: 0, emailsFound: 0, phonesFound: 0 };
  let batchNum = 0;
  let cursor: string | null = null;

  while (true) {
    batchNum++;

    let query = db
      .from("nonprofits")
      .select("id, website, officer_email, contact_emails, phone, officer_name")
      .not("website", "is", null)
      .or("officer_email.is.null,contact_emails.is.null")
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);

    if (cursor) {
      query = query.gt("id", cursor);
    }
    if (states && states.length > 0) {
      query = query.in("state", states);
    }

    const { data: rows, error } = await query as { data: NonprofitRow[] | null; error: unknown };

    if (error) {
      log(`FATAL: DB query failed — ${JSON.stringify(error)}`);
      break;
    }

    if (!rows || rows.length === 0) {
      log(
        `All candidates exhausted. Total processed: ${stats.processed} | Updated: ${stats.updated} | Emails found: ${stats.emailsFound} | Phones found: ${stats.phonesFound}`
      );
      break;
    }

    cursor = rows[rows.length - 1]!.id;

    await scrapeBatch(db, rows, stats);

    if (batchNum % LOG_EVERY_BATCHES === 0) {
      log(
        `Batch ${batchNum}: ${rows.length} orgs processed | ${stats.updated} updated so far | ${stats.emailsFound} email hits | ${stats.phonesFound} phone hits`
      );
    }

    await sleep(BATCH_DELAY_MS);
  }

  log(
    `COMPLETE — ${stats.processed} processed | ${stats.updated} updated | ${stats.emailsFound} email hits | ${stats.phonesFound} phone hits`
  );
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
