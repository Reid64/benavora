// ============================================================================
// BENAVORA — nonprofit website contact enrichment (tier 2) for the
// nonprofits table
//
// Claude-powered rewrite of this script. The prior version fetched pages with
// plain cheerio/regex parsing and targeted `last_enriched_at IS NULL` — but
// `website` is only ever populated by scripts/enrich-990-xml.ts (tier 1),
// which stamps `last_enriched_at` in the very same update, so no row with a
// non-null website could ever have a null last_enriched_at and that filter
// could never match a real row. This version targets nonprofits that DO have
// a last_enriched_at (from tier 1) but still lack officer_email, re-checked
// on a 30-day cooldown so a site with no discoverable contact info isn't
// hammered every run.
//
// For each candidate: fetch /about, /contact, /staff, /leadership, /team
// under the site's origin (5s timeout per page, skip on failure), hand the
// first 3000 chars of the combined HTML to Claude (claude-sonnet-4-6,
// max_tokens 200) to extract an executive director name/email, a general
// email, and a phone number, validate each field, and write only the columns
// that are still NULL on the existing row (COALESCE semantics — see
// scripts/enrich-990-xml.ts's header for why this is done via a
// fetch-then-conditionally-update query builder rather than a raw
// `ON CONFLICT ... COALESCE(...)` string: the values come from untrusted
// third-party HTML/model output, so they must stay parameterized).
//
// A row is always stamped with last_enriched_at after being attempted (even
// when nothing was extracted), so a dead/uncontactable site cools down for 30
// days instead of being re-selected on every subsequent run.
//
//   pnpm enrich:nonprofit-websites
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

import { callClaude } from "@/lib/ai/claude";

const BATCH_LIMIT = 500;
const FETCH_TIMEOUT_MS = 5_000;
const REQUEST_DELAY_MS = 2_000;
const MAX_HTML_CHARS = 3000;
const COOLDOWN_DAYS = 30;
const LOG_EVERY = 25;
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_MAX_TOKENS = 200;

const CONTACT_PATHS = ["/about", "/contact", "/staff", "/leadership", "/team"];

const SYSTEM_PROMPT =
  "Extract contact information from this nonprofit website HTML. Return JSON only: " +
  "{ executive_director_name: string|null, executive_director_email: string|null, general_email: string|null, phone: string|null }. " +
  "If not found, return null for that field.";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /(\d{3}[-.]?\d{3}[-.]?\d{4})/;

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
  name: string;
  website: string;
  officer_name: string | null;
  phone: string | null;
  contact_emails: string | null;
}

interface ExtractedContact {
  executive_director_name: string | null;
  executive_director_email: string | null;
  general_email: string | null;
  phone: string | null;
}

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && EMAIL_REGEX.test(value.trim());
}

function isValidPhone(value: unknown): value is string {
  return typeof value === "string" && PHONE_REGEX.test(value);
}

function isValidName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || /\d/.test(trimmed)) return false;
  return trimmed.split(/\s+/).filter(Boolean).length >= 2;
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

function parseExtraction(raw: string): Record<string, unknown> | null {
  const candidate = extractJsonObject(stripCodeFences(raw));
  try {
    const value: unknown = JSON.parse(candidate);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

async function fetchContactPages(website: string): Promise<string | null> {
  let origin: string;
  try {
    origin = new URL(website).origin;
  } catch {
    return null;
  }

  let combined = "";
  for (const path of CONTACT_PATHS) {
    const html = await fetchPage(`${origin}${path}`);
    if (html) combined += html;
  }

  return combined ? combined.slice(0, MAX_HTML_CHARS) : null;
}

async function extractContactInfo(html: string): Promise<ExtractedContact | null> {
  const response = await callClaude({
    system: SYSTEM_PROMPT,
    prompt: html,
    model: CLAUDE_MODEL,
    maxTokens: CLAUDE_MAX_TOKENS,
  });

  const parsed = parseExtraction(response.text);
  if (!parsed) return null;

  return {
    executive_director_name: asStringOrNull(parsed.executive_director_name),
    executive_director_email: asStringOrNull(parsed.executive_director_email),
    general_email: asStringOrNull(parsed.general_email),
    phone: asStringOrNull(parsed.phone),
  };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    fatal("Missing ANTHROPIC_API_KEY");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    // ws's WebSocket type isn't structurally identical to realtime-js's
    // WebSocketLikeConstructor (event handler signatures differ); runtime
    // behavior is unaffected. Same pattern as scripts/enrich-990-xml.ts.
    realtime: { transport: ws as any },
  }) as SupabaseClient;

  console.log("Nonprofit website contact enrichment — nonprofits table (tier 2)");
  console.log(
    `Population: website IS NOT NULL AND officer_email IS NULL AND last_enriched_at < NOW() - ${COOLDOWN_DAYS}d\n`,
  );

  const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("nonprofits")
    .select("id, ein, name, website, officer_name, phone, contact_emails")
    .not("website", "is", null)
    .is("officer_email", null)
    .lt("last_enriched_at", cutoff)
    .limit(BATCH_LIMIT);

  if (error) {
    fatal(`could not query nonprofits: ${error.message}`);
  }

  const batch = (data ?? []) as unknown as NonprofitRow[];
  if (batch.length === 0) {
    console.log("Nothing to do — no candidates matched.");
    return;
  }

  console.log(`${batch.length} candidates this run\n`);

  let processed = 0;
  let enriched = 0;
  let skipped = 0;
  let failed = 0;

  for (const org of batch) {
    processed++;

    try {
      const html = await fetchContactPages(org.website);

      if (!html) {
        skipped++;
        const { error: touchError } = await admin
          .from("nonprofits")
          .update({ last_enriched_at: new Date().toISOString() })
          .eq("ein", org.ein);
        if (touchError) fail(`cooldown-stamp EIN ${org.ein}`, touchError);
      } else {
        const extracted = await extractContactInfo(html);

        const update: Record<string, unknown> = {};
        if (extracted) {
          if (org.officer_name === null && isValidName(extracted.executive_director_name)) {
            update.officer_name = extracted.executive_director_name;
          }
          if (isValidEmail(extracted.executive_director_email)) {
            update.officer_email = extracted.executive_director_email;
          }
          if (org.contact_emails === null && isValidEmail(extracted.general_email)) {
            update.contact_emails = extracted.general_email;
          }
          if (org.phone === null && isValidPhone(extracted.phone)) {
            update.phone = extracted.phone;
          }
        }

        if (Object.keys(update).length > 0) {
          update.enrichment_tier = 2;
        }
        update.last_enriched_at = new Date().toISOString();

        const { error: updateError } = await admin.from("nonprofits").update(update).eq("ein", org.ein);
        if (updateError) {
          failed++;
          fail(`update EIN ${org.ein}`, updateError);
        } else if (Object.keys(update).length > 1) {
          enriched++;
        } else {
          skipped++;
        }
      }
    } catch (err) {
      failed++;
      fail(`process EIN ${org.ein}`, err);
    }

    if (processed % LOG_EVERY === 0 || processed === batch.length) {
      console.log(`  … processed ${processed}/${batch.length}, enriched ${enriched}, skipped ${skipped}, failed ${failed}`);
    }

    if (processed < batch.length) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log("\nDone.");
  console.log(`  Records processed: ${processed}`);
  console.log(`  Enriched:          ${enriched}`);
  console.log(`  Skipped:           ${skipped} (no contact pages found / nothing new extracted)`);
  console.log(`  Failed:            ${failed}`);
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
