// Cold Outreach Agent - AGENTS.md Agent 11.
//
// Extracts contact information from companies that have no corporate giving page
// (funders with has_giving_page = false, or an ad-hoc company scan). It fetches
// the company website server-side, asks Claude to pull out general emails,
// contact-form URLs, phone numbers, and key personnel, scores each lead's
// giving_likelihood, and writes the results to outreach_contacts.
//
// Phase note (AGENTS.md Agent 11): Phase 1 uses a plain server-side HTTP request
// for static pages; Phase 3 adds Playwright for JavaScript-rendered sites. The
// agent degrades gracefully - if the page can't be fetched it still records a
// single company-level lead so the user can follow up manually.
//
// Contracts honored: outreach_contacts are scoped by organization_id and kept
// separate from CRM contacts until converted (BEHAVIORAL_CONTRACTS §13); the run
// logs to agent_runs and tracks tokens via BaseAgent (§15).

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import type { TablesInsert } from "@/types/database";

export type GivingLikelihood = "high" | "medium" | "low";

export interface ColdOutreachInput {
  /** Company to scan. Required - used as the company_name on every lead. */
  companyName: string;
  /** Company website to extract from. Optional; without it no page is fetched. */
  websiteUrl?: string | null;
  /** Funder this scan originated from (has_giving_page = false), if any. */
  funderId?: string | null;
}

/** One extracted lead, before it is written to outreach_contacts. */
export interface ExtractedOutreachContact {
  contactName: string | null;
  email: string | null;
  phone: string | null;
  contactFormUrl: string | null;
  companyType: string | null;
  givingLikelihood: GivingLikelihood;
}

export interface ColdOutreachResult {
  companyName: string;
  contactsCreated: number;
  contacts: ExtractedOutreachContact[];
}

export interface ColdOutreachOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

/** Cap on page text sent to the model, to keep input tokens bounded. */
const MAX_PAGE_CHARS = 12_000;
/** Per-fetch timeout for the website request (the page may be slow or down). */
const FETCH_TIMEOUT_MS = 15_000;

export class ColdOutreachAgent extends BaseAgent<
  ColdOutreachInput,
  ColdOutreachResult
> {
  readonly agentType: AgentType = "cold_outreach";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: ColdOutreachOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? 300_000 });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: ColdOutreachInput,
  ): Promise<AgentExecution<ColdOutreachResult>> {
    const companyName = input.companyName.trim();
    if (companyName === "") {
      throw new AgentError("A company name is required.", "invalid_input", 400);
    }

    const websiteUrl = normalizeUrl(input.websiteUrl);
    const pageText = websiteUrl ? await fetchPageText(websiteUrl) : null;

    let extracted: ExtractedOutreachContact[] = [];
    let tokensUsed = 0;

    if (pageText && pageText.trim() !== "") {
      const { system, prompt } = buildExtractionPrompt(
        companyName,
        websiteUrl,
        pageText,
      );
      const response = await callClaude({
        system,
        prompt,
        model: this.model,
        maxTokens: this.maxTokens,
      });
      tokensUsed = response.usage.totalTokens;
      extracted = parseExtractionResponse(response.text);
    }

    // Always leave at least one lead so a failed/empty extraction is still
    // actionable - the user gets a company-level row to follow up on.
    if (extracted.length === 0) {
      extracted = [
        {
          contactName: null,
          email: null,
          phone: null,
          contactFormUrl: null,
          companyType: null,
          givingLikelihood: "low",
        },
      ];
    }

    const rows: TablesInsert<"outreach_contacts">[] = extracted.map(
      (contact) => ({
        organization_id: this.organizationId,
        company_name: companyName,
        contact_name: contact.contactName,
        email: contact.email,
        phone: contact.phone,
        contact_form_url: contact.contactFormUrl,
        source_url: websiteUrl,
        company_type: contact.companyType,
        giving_likelihood: contact.givingLikelihood,
        status: "new",
      }),
    );

    const { data: inserted, error: insertError } = await this.client
      .from("outreach_contacts")
      .insert(rows)
      .select("id");

    if (insertError) {
      throw new AgentError(
        "Failed to save the extracted contacts.",
        "write_failed",
      );
    }

    const contactsCreated = inserted?.length ?? rows.length;

    return {
      data: { companyName, contactsCreated, contacts: extracted },
      outputSummary: `Extracted ${contactsCreated} outreach contact${
        contactsCreated === 1 ? "" : "s"
      } for ${companyName}.`,
      itemsFound: contactsCreated,
      itemsProcessed: contactsCreated,
      tokensUsed,
    };
  }
}

// --- website fetch -----------------------------------------------------------

/** Add a scheme if the user entered a bare host; return null for empty input. */
function normalizeUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Fetch a page and return a whitespace-collapsed, tag-stripped text excerpt.
 * Returns null on any failure (bad URL, non-OK status, timeout) - the agent
 * tolerates this and records a manual-follow-up lead instead of throwing.
 */
async function fetchPageText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "BenavoraOutreachBot/1.0" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return htmlToText(html).slice(0, MAX_PAGE_CHARS);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Crude HTML → text: drop scripts/styles and tags, collapse whitespace. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// --- prompt ------------------------------------------------------------------

function buildExtractionPrompt(
  companyName: string,
  websiteUrl: string | null,
  pageText: string,
): { system: string; prompt: string } {
  const system = [
    "You extract outreach contact details for a nonprofit's fundraising team from a company's web page.",
    "",
    "RULES:",
    "1. Use ONLY information present in the provided page text. Never invent emails, names, phone numbers, or URLs.",
    "2. Return general/department emails (info@, giving@, community@) and any named personnel with their role.",
    "3. Score giving_likelihood for the company: 'high' for construction/building/real-estate/local businesses or pages mentioning community giving, sponsorships, or donations; 'medium' if some community involvement is implied; 'low' otherwise.",
    "4. Omit a field you cannot find (use null). Return at most 5 contacts, best leads first.",
    "5. Respond with ONLY a JSON array, no prose and no code fences, each element exactly:",
    '{"contact_name": string|null, "email": string|null, "phone": string|null, "contact_form_url": string|null, "company_type": string|null, "giving_likelihood": "high"|"medium"|"low"}',
  ].join("\n");

  const prompt = [
    `## Company\n${companyName}${websiteUrl ? `\nWebsite: ${websiteUrl}` : ""}`,
    "",
    "## Page text",
    pageText,
    "",
    "Extract the outreach contacts now. Return ONLY the JSON array described above.",
  ].join("\n");

  return { system, prompt };
}

// --- response parsing --------------------------------------------------------

function toLikelihood(value: unknown): GivingLikelihood {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return v === "high" || v === "medium" || v === "low" ? v : "low";
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Parse the model's JSON array of contacts. Tolerant of stray prose or code
 * fences around the array. Drops elements that have no usable contact channel
 * (no name, email, phone, or form URL) so empty stubs aren't persisted.
 */
export function parseExtractionResponse(
  text: string,
): ExtractedOutreachContact[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const contacts: ExtractedOutreachContact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const contact: ExtractedOutreachContact = {
      contactName: toStringOrNull(obj.contact_name),
      email: toStringOrNull(obj.email),
      phone: toStringOrNull(obj.phone),
      contactFormUrl: toStringOrNull(obj.contact_form_url),
      companyType: toStringOrNull(obj.company_type),
      givingLikelihood: toLikelihood(obj.giving_likelihood),
    };
    const hasChannel =
      contact.contactName ||
      contact.email ||
      contact.phone ||
      contact.contactFormUrl;
    if (hasChannel) contacts.push(contact);
    if (contacts.length >= 5) break;
  }
  return contacts;
}
