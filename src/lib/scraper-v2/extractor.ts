// extractStructured — Extraction layer for the Universal Scraper
// (UNIVERSAL_SCRAPER_PRD.md §3.3).
//
// This is the actual generality mechanism the PRD is built around (§1, §2):
// instead of a per-site regex/tag parser that breaks whenever a source's
// markup changes (the exact failure that killed the old IRS 990 parser
// twice), a page's readable text plus a caller-supplied JSON field list is
// handed to Claude, which returns only the fields it can genuinely find on
// the page. A new "scrape target type" is a new schema, not new parsing
// code.
//
// Two stages:
//   1. Readability (@mozilla/readability, via jsdom) strips nav/footer/ad
//      chrome down to the page's actual content — an existing, maintained
//      library, not hand-rolled tag stripping.
//   2. Claude is given that text + the keyword context + the caller's
//      schema, and is forced (tool_choice) to call a single structured tool
//      whose fields it must LEAVE OUT if a value isn't actually present ---
//      never fabricate one. Missing fields are filled in as `null` by this
//      module after the call, so the return shape always has every
//      requested key regardless of what Claude chose to report.

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import Anthropic from "@anthropic-ai/sdk";
import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import { DEFAULT_MODEL } from "../ai/claude";

/**
 * Caller-supplied output schema: field name -> primitive type, matching the
 * PRD §3.5 CLI example (`--schema '{"org_name":"string","website":"string",...}'`).
 * Any type string other than "number"/"boolean" is treated as "string".
 */
export type ExtractionFieldType = "string" | "number" | "boolean";
export type ExtractionSchema = Record<string, ExtractionFieldType | string>;

export type ExtractedFieldValue = string | number | boolean | null;

export interface ExtractStructuredResult {
  /** One entry per requested schema field, always present. Fields Claude couldn't find on the page are explicitly `null` — never omitted, never invented. */
  data: Record<string, ExtractedFieldValue>;
  /** Readability's own article title, if it found one. Diagnostic only — not part of the caller's schema. */
  extractedTitle: string | null;
  /** Length of the readable text actually sent to Claude (post-truncation). 0 means there was no extractable text at all, and the Claude call was skipped entirely. */
  extractedTextLength: number;
  /** True if Readability found no parseable "article" (common on directory/listing/contact-style pages) and this fell back to the raw document body text instead. */
  readabilityFallback: boolean;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

// Keeps the extraction call small and cheap — a handful of schema fields
// essentially never need more than this much surrounding context to answer.
const MAX_CONTENT_CHARS = 15_000;
const TOOL_NAME = "extract_structured_data";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }
  client = createTrackedAnthropic({ apiKey }, "extractor");
  return client;
}

function normalizeFieldType(type: string): ExtractionFieldType {
  return type === "number" || type === "boolean" ? type : "string";
}

/**
 * Strips chrome via Readability, falling back to the raw document body text
 * when Readability can't identify an "article" — expected for the
 * directory/listing/contact-page style targets this scraper actually hits,
 * not just long-form news content. Never hand-rolls HTML tag stripping.
 */
function extractReadableText(
  html: string,
  sourceUrl?: string,
): { text: string; title: string | null; usedFallback: boolean } {
  const dom = new JSDOM(html, sourceUrl ? { url: sourceUrl } : undefined);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (article?.textContent && article.textContent.trim().length > 0) {
    return { text: article.textContent.trim(), title: article.title ?? null, usedFallback: false };
  }

  const bodyText = dom.window.document.body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return { text: bodyText, title: dom.window.document.title || null, usedFallback: true };
}

function buildToolSchema(schema: ExtractionSchema): Anthropic.Tool {
  const properties: Record<string, { type: ExtractionFieldType; description: string }> = {};
  for (const [field, rawType] of Object.entries(schema)) {
    properties[field] = {
      type: normalizeFieldType(rawType),
      description: `The ${field} value, taken verbatim from the page content below. Omit this property entirely if it is not actually present on the page — never guess or infer a plausible-sounding value.`,
    };
  }

  return {
    name: TOOL_NAME,
    description:
      "Report the requested fields as found in the page content. Only include a field if its value is genuinely stated in the content — omit any field you cannot find there. Never invent, guess, or infer a value for a missing field.",
    input_schema: {
      type: "object",
      properties,
      // Deliberately no `required` list: the whole point of this tool is
      // that Claude must be free to leave a field out rather than backfill
      // it with a fabricated value.
    },
  };
}

function buildPrompt(text: string, keyword: string, schema: ExtractionSchema): string {
  const fieldList = Object.keys(schema)
    .map((field) => `- ${field}`)
    .join("\n");

  return `You are extracting structured data from a real web page for the search topic: "${keyword}".

Requested fields:
${fieldList}

Page content:
"""
${text}
"""

Call the ${TOOL_NAME} tool with only the fields whose values are genuinely stated in the page content above. Do not fabricate, guess, or infer a value that is not actually present in the text — if a requested field isn't on this page, leave it out of your tool call entirely rather than making one up.

If any requested field is a contact detail (an email, phone number, or person's name), keep this in mind while choosing which value to report: pages often contain contact information belonging to someone other than the organization itself. Prefer values that read as the organization's own official contact — addresses like info@/contact@/admin@/office@ or one on the organization's own domain, and phone numbers or names that appear near headings like "Contact Us," "Get in Touch," or "Contact Information," or in a footer/contact-page context. Deprioritize (do not treat as an automatic exclusion) contact details that read as belonging to an individual named in a byline, article credit, or quoted-source attribution — e.g. text following "By [Name]," a reporter/author credit at the top or bottom of a news article, or an email/phone tied to a named journalist covering a story the organization has republished on its own site (a common pattern for a nonprofit's "News" or "Press" page). This is a judgment call, not a hard rule: some organizations' real official contact will genuinely sit near article-style text, so if that is clearly the organization's own contact, still report it. When you cannot tell whether a specific value belongs to the organization itself versus an unrelated individual mentioned on the page, leave that field out rather than guessing.`;
}

/**
 * Extracts structured data matching `outputSchema` from `pageContent` (raw
 * HTML), in the context of `keyword`. Every requested field is present in
 * the result; a field Claude did not find genuinely present on the page
 * comes back as `null`, never a fabricated guess (PRD §3.3).
 */
export async function extractStructured(
  pageContent: string,
  keyword: string,
  outputSchema: ExtractionSchema,
  sourceUrl?: string,
): Promise<ExtractStructuredResult> {
  const nullResult: Record<string, ExtractedFieldValue> = {};
  for (const field of Object.keys(outputSchema)) nullResult[field] = null;

  const { text, title, usedFallback } = extractReadableText(pageContent, sourceUrl);
  const truncated = text.slice(0, MAX_CONTENT_CHARS);

  if (truncated.trim().length === 0) {
    // No extractable text at all (e.g. a JS-only page the fetch layer
    // couldn't render, or a genuinely empty document). Every field is
    // honestly null — there is nothing worth spending a Claude call on.
    console.error(`[extractStructured] no readable text extracted from page for keyword "${keyword}" — all fields null`);
    return {
      data: nullResult,
      extractedTitle: title,
      extractedTextLength: 0,
      readabilityFallback: usedFallback,
      model: DEFAULT_MODEL,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  const tool = buildToolSchema(outputSchema);
  const prompt = buildPrompt(truncated, keyword, outputSchema);

  const message = await getClient().messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    tools: [tool],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME,
  );

  const data: Record<string, ExtractedFieldValue> = { ...nullResult };
  if (toolUse) {
    const input = toolUse.input as Record<string, unknown>;
    for (const field of Object.keys(outputSchema)) {
      const value = input[field];
      data[field] = typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
    }
  } else {
    console.error(`[extractStructured] Claude did not return a ${TOOL_NAME} tool_use block for keyword "${keyword}" — all fields null`);
  }

  return {
    data,
    extractedTitle: title,
    extractedTextLength: truncated.length,
    readabilityFallback: usedFallback,
    model: message.model,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      totalTokens: message.usage.input_tokens + message.usage.output_tokens,
    },
  };
}
