import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";

import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import { fetchCompliant } from "@/lib/donor-discovery/crawler-core";

/**
 * Shared web-extraction engine (DONOR_DISCOVERY_ARCHITECTURE.md §2B).
 *
 * Visits a company/foundation's own website once, pulls the homepage plus a
 * handful of likely subpages, and asks Claude to extract a structured record
 * — either the existing foundation-enrichment shape or the new Donor
 * Discovery donor_prospect shape. Both callers (foundation enrichment lanes
 * and the Donor Discovery worker) share this one implementation so a new
 * prospect category never needs its own scraper.
 *
 * Worker-safe: no module-load side effects (the Anthropic client is built
 * lazily on first call), and all network access goes through crawler-core's
 * `fetchCompliant` — never a bare `fetch` — so the same rate limiting,
 * robots.txt, and ToS checks apply regardless of caller.
 */

const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_MAX_TOKENS = 2048;
const MAX_TEXT_CHARS = 30_000;
const MAX_SUBPAGES = 4;
const ADAPTER_NAME = "web-extractor";

// ── Public types ─────────────────────────────────────────────────────────────

export type WebExtractionSchema = "foundation" | "donor_prospect";

export interface FoundationExtraction {
  giving_focus_areas: string[];
  application_process: string | null;
  application_url: string | null;
  accepts_unsolicited: boolean | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_address: string | null;
  key_people: Array<{ name: string; title: string }>;
  geographic_focus: string | null;
}

export interface DonorProspectExtraction {
  has_giving_program: boolean | null;
  has_donation_form: boolean | null;
  donation_form_url: string | null;
  csr_page_url: string | null;
  giving_focus_areas: string[];
  decision_contacts: Array<{
    name: string;
    title: string;
    email: string | null;
    phone: string | null;
  }>;
  service_area: string | null;
}

export interface WebExtractionResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
}

// ── Anthropic client (lazy — no module-load side effects) ──────────────────

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }
  anthropicClient = createTrackedAnthropic({ apiKey }, "web-extractor");
  return anthropicClient;
}

// ── URL handling ─────────────────────────────────────────────────────────────

function normalizeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate).href;
  } catch {
    return null;
  }
}

// ── Subpage discovery ────────────────────────────────────────────────────────

interface SubpageCategory {
  key: string;
  regex: RegExp;
}

// One category per likely subpage, in priority order — capped at
// MAX_SUBPAGES so at most one link per category is ever fetched.
const SUBPAGE_CATEGORIES: SubpageCategory[] = [
  { key: "about", regex: /\babout([-_]?us)?\b/i },
  { key: "grants_giving", regex: /\b(grants?|giving|csr|corporate[-_]?(social[-_]?)?responsibility)\b/i },
  { key: "apply_donate", regex: /\b(apply|application|donate|donation|give[-_]?back)\b/i },
  { key: "contact", regex: /\bcontact([-_]?us)?\b/i },
];

function findSubpageLinks(homepageHtml: string, baseUrl: string): string[] {
  const $ = cheerio.load(homepageHtml);
  const origin = new URL(baseUrl).origin;
  const found = new Map<string, string>();
  const seenUrls = new Set<string>([baseUrl]);

  $("a[href]").each((_i, el) => {
    if (found.size >= SUBPAGE_CATEGORIES.length) return;

    const href = $(el).attr("href") ?? "";
    const linkText = $(el).text() ?? "";
    const haystack = `${href} ${linkText}`.toLowerCase();

    for (const category of SUBPAGE_CATEGORIES) {
      if (found.has(category.key)) continue;
      if (!category.regex.test(haystack)) continue;

      let absoluteUrl: string;
      try {
        absoluteUrl = new URL(href, baseUrl).href;
      } catch {
        continue;
      }
      if (!absoluteUrl.startsWith(origin) || seenUrls.has(absoluteUrl)) continue;

      found.set(category.key, absoluteUrl);
      seenUrls.add(absoluteUrl);
      break;
    }
  });

  return Array.from(found.values()).slice(0, MAX_SUBPAGES);
}

// ── Text cleaning ────────────────────────────────────────────────────────────

function htmlToCleanText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function buildSiteText(pages: Array<{ url: string; html: string }>): string {
  const combined = pages
    .map(({ url, html }) => `--- ${url} ---\n${htmlToCleanText(html)}`)
    .join("\n\n");
  return combined.slice(0, MAX_TEXT_CHARS);
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const FOUNDATION_JSON_SHAPE = `{
  "giving_focus_areas": string[],
  "application_process": string | null,
  "application_url": string | null,
  "accepts_unsolicited": boolean | null,
  "contact_email": string | null,
  "contact_phone": string | null,
  "contact_address": string | null,
  "key_people": [{ "name": string, "title": string }],
  "geographic_focus": string | null
}`;

const DONOR_PROSPECT_JSON_SHAPE = `{
  "has_giving_program": boolean | null,
  "has_donation_form": boolean | null,
  "donation_form_url": string | null,
  "csr_page_url": string | null,
  "giving_focus_areas": string[],
  "decision_contacts": [{ "name": string, "title": string, "email": string | null, "phone": string | null }],
  "service_area": string | null
}`;

function buildFoundationPrompt(siteText: string): string {
  return `You are extracting structured facts about a grantmaking foundation from its own website text. Read the text below and return ONLY a single JSON object matching this exact shape — no prose, no markdown code fences, no explanation:

${FOUNDATION_JSON_SHAPE}

Rules:
- Use null (not an empty string) for any field you cannot find evidence for in the text.
- giving_focus_areas and key_people default to [] when nothing is found — never omit the key.
- accepts_unsolicited is true only if the site explicitly says it accepts unsolicited applications/inquiries, false only if it explicitly says it does NOT, otherwise null.
- application_url must be an absolute URL (https://...) copied verbatim from the text if present, otherwise null.
- Do not invent facts that are not present in the text.

WEBSITE TEXT:
${siteText}`;
}

function buildDonorProspectPrompt(siteText: string): string {
  return `You are extracting structured facts about a potential corporate/business donor from its own website text, for a nonprofit's donor prospecting tool. Read the text below and return ONLY a single JSON object matching this exact shape — no prose, no markdown code fences, no explanation:

${DONOR_PROSPECT_JSON_SHAPE}

Rules:
- Use null (not an empty string) for any boolean/string field you cannot find evidence for in the text.
- giving_focus_areas and decision_contacts default to [] when nothing is found — never omit the key.
- has_giving_program: true if the company describes any charitable giving, sponsorship, community investment, or philanthropy program; false if it is clearly a normal business site with no such mention; null if unclear.
- has_donation_form: true only if a donation/sponsorship request form or application is described or linked; donation_form_url is that form's absolute URL if found, else null.
- csr_page_url is the absolute URL of a dedicated CSR/community/giving-back page if one exists, else null.
- decision_contacts should list named individuals (with title, and email/phone only if published) who appear responsible for giving/sponsorship/community-relations decisions — do not include generic sales/support contacts.
- Do not invent facts that are not present in the text.

WEBSITE TEXT:
${siteText}`;
}

// ── JSON response parsing ────────────────────────────────────────────────────

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

function parseJsonResponse(
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const candidate = extractJsonObject(stripCodeFences(raw));
  try {
    const value: unknown = JSON.parse(candidate);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, error: "Claude response was not a JSON object" };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse JSON from Claude response: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Field coercion helpers (defensive against a slightly malformed model response) ──

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asBoolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function asKeyPeople(v: unknown): Array<{ name: string; title: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ name: string; title: string }> = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const name = asStringOrNull((item as Record<string, unknown>).name);
    if (!name) continue;
    out.push({ name, title: asStringOrNull((item as Record<string, unknown>).title) ?? "" });
  }
  return out;
}

function asDecisionContacts(v: unknown): DonorProspectExtraction["decision_contacts"] {
  if (!Array.isArray(v)) return [];
  const out: DonorProspectExtraction["decision_contacts"] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = asStringOrNull(rec.name);
    if (!name) continue;
    out.push({
      name,
      title: asStringOrNull(rec.title) ?? "",
      email: asStringOrNull(rec.email),
      phone: asStringOrNull(rec.phone),
    });
  }
  return out;
}

function normalizeFoundationExtraction(value: Record<string, unknown>): FoundationExtraction {
  return {
    giving_focus_areas: asStringArray(value.giving_focus_areas),
    application_process: asStringOrNull(value.application_process),
    application_url: asStringOrNull(value.application_url),
    accepts_unsolicited: asBoolOrNull(value.accepts_unsolicited),
    contact_email: asStringOrNull(value.contact_email),
    contact_phone: asStringOrNull(value.contact_phone),
    contact_address: asStringOrNull(value.contact_address),
    key_people: asKeyPeople(value.key_people),
    geographic_focus: asStringOrNull(value.geographic_focus),
  };
}

function normalizeDonorProspectExtraction(value: Record<string, unknown>): DonorProspectExtraction {
  return {
    has_giving_program: asBoolOrNull(value.has_giving_program),
    has_donation_form: asBoolOrNull(value.has_donation_form),
    donation_form_url: asStringOrNull(value.donation_form_url),
    csr_page_url: asStringOrNull(value.csr_page_url),
    giving_focus_areas: asStringArray(value.giving_focus_areas),
    decision_contacts: asDecisionContacts(value.decision_contacts),
    service_area: asStringOrNull(value.service_area),
  };
}

// ── Public entry point ───────────────────────────────────────────────────────

export function extractFromWebsite(
  url: string,
  schema: "foundation",
): Promise<WebExtractionResult<FoundationExtraction>>;
export function extractFromWebsite(
  url: string,
  schema: "donor_prospect",
): Promise<WebExtractionResult<DonorProspectExtraction>>;
export async function extractFromWebsite(
  url: string,
  schema: WebExtractionSchema,
): Promise<WebExtractionResult<FoundationExtraction | DonorProspectExtraction>> {
  try {
    const homepageUrl = normalizeUrl(url);
    if (!homepageUrl) {
      return { ok: false, data: null, error: `Invalid URL: "${url}"` };
    }

    const homepage = await fetchCompliant(homepageUrl, { adapterName: ADAPTER_NAME });
    if (!homepage.ok || !homepage.html) {
      return {
        ok: false,
        data: null,
        error: `Homepage fetch failed (${homepage.blockedReason ?? `HTTP ${homepage.status}`})`,
      };
    }

    const pages: Array<{ url: string; html: string }> = [{ url: homepageUrl, html: homepage.html }];

    const subpageUrls = findSubpageLinks(homepage.html, homepageUrl);
    for (const subpageUrl of subpageUrls) {
      const result = await fetchCompliant(subpageUrl, { adapterName: ADAPTER_NAME });
      if (result.ok && result.html) {
        pages.push({ url: subpageUrl, html: result.html });
      }
    }

    const siteText = buildSiteText(pages);
    if (!siteText.trim()) {
      return { ok: false, data: null, error: "No extractable text content found on site" };
    }

    const prompt = schema === "foundation" ? buildFoundationPrompt(siteText) : buildDonorProspectPrompt(siteText);

    const message = await getClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const parsed = parseJsonResponse(rawText);
    if (!parsed.ok) {
      return { ok: false, data: null, error: parsed.error };
    }

    return {
      ok: true,
      data:
        schema === "foundation"
          ? normalizeFoundationExtraction(parsed.value)
          : normalizeDonorProspectExtraction(parsed.value),
    };
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}
