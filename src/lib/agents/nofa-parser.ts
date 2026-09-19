// NOFA Parser Agent — downloads federal grant PDFs from opportunity_documents
// and extracts structured data to enrich opportunity records.
//
// Per-run behaviour:
//   1. Loads the target opportunity and its PDF document URLs.
//   2. Downloads each document (30s timeout). PDFs are mirrored to Supabase
//      Storage for inline viewing and parsed with pdf-parse; HTML announcements
//      (grants.gov serves a meta-refresh stub) are followed to the real page and
//      stripped to text - they are NOT mirrored (Supabase serves stored HTML as
//      text/plain) so the detail view links to the original instead.
//   3. Sends parsed text to Claude with a structured extraction prompt.
//   4. Merges extracted fields across all PDFs (first non-empty wins).
//   5. UPDATEs the opportunity with extracted values, but ONLY for fields that
//      are currently null/empty in the database — never overwrites populated data.
//   6. Logs the run to agent_runs with agent_type =
//      government_research_nofa_parser (renamed 2026-09-15, p5a-002 — was
//      government_research, colliding with research/government-grants.ts).
//
// The exported runNofaBatch() function processes all opportunities where
// opportunity_documents is not null AND description is null.

import { callClaude } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  causeOf,
  withCause,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import type { SupabaseClient } from "@supabase/supabase-js";

// Cap PDF text sent to Claude. Full NOFAs can be 100K+ chars; this keeps
// token cost reasonable while still capturing all the structured fields.
const MAX_PDF_TEXT_CHARS = 60_000;

// DB fields populated from NOFA extraction (maps 1:1 to opportunities columns).
const DB_FIELDS = [
  "description",
  "eligibility_requirements",
  "amount_available",
  "amount_min",
  "amount_max",
  "deadline",
  "geographic_restrictions",
  "application_method",
  "required_documents",
  "recurrence",
] as const;

type DbField = (typeof DB_FIELDS)[number];

interface OpportunityDocument {
  title?: string;
  url: string;
  /** Public Supabase Storage URL once the document is mirrored for in-app viewing. */
  storedUrl?: string;
}

// Public bucket holding mirrored NOFA documents (PDF or HTML federal public
// docs), so the detail page can show them inline via a persistent iframe URL.
const NOFA_BUCKET = "nofa-pdfs";

// Grants.gov documents are usually PDFs but some are HTML announcements
// (e.g. PAR-25-310-Full-Announcement.html). Detect HTML by Content-Type or file
// extension so we extract text via strip-tags rather than pdf-parse.
function isHtmlDocument(
  url: string,
  title: string,
  contentType: string,
): boolean {
  if (/text\/html/i.test(contentType)) return true;
  // Grants.gov download URLs are opaque (.../att/download/344872), so the
  // .html extension usually lives in the title, not the url - check both.
  const hasHtmlExt = (s: string) => /\.html?$/i.test(s.split(/[?#]/)[0] ?? s);
  return hasHtmlExt(url) || hasHtmlExt(title);
}

function sanitizeFilename(name: string, ext: "pdf" | "html"): string {
  const stem =
    name
      .replace(/\.(pdf|html?|htm)$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[._]+|[._]+$/g, "")
      .slice(0, 120) || "nofa";
  return `${stem}.${ext}`;
}

// Dependency-free HTML -> text: drop script/style blocks, strip tags, decode the
// common entities, and collapse whitespace.
function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// grants.gov serves HTML attachments as a tiny <meta http-equiv="refresh"> stub
// that points at the real announcement (e.g. grants.nih.gov). Extract that target
// so we can follow one hop to the actual content.
function extractMetaRefreshUrl(html: string): string | null {
  const m =
    /http-equiv=["']?refresh["']?[^>]*content=["'][^"']*?url=\s*['"]?([^'"\s>]+)/i.exec(
      html,
    );
  return m && m[1] ? m[1] : null;
}

interface OpportunityRow {
  id: string;
  organization_id: string;
  opportunity_documents: unknown;
  description: string | null;
  eligibility_requirements: string | null;
  amount_available: number | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  geographic_restrictions: string | null;
  application_method: string | null;
  required_documents: string[] | null;
  recurrence: string | null;
}

interface ClaudeExtraction {
  description?: string | null;
  eligibility_requirements?: string | null;
  amount_available?: number | null;
  amount_min?: number | null;
  amount_max?: number | null;
  deadline?: string | null;
  geographic_restrictions?: string | null;
  application_method?: string | null;
  required_documents?: string[] | null;
  recurrence?: string | null;
  key_priorities?: string[] | null;
}

export interface NofaParserInput {
  opportunityId: string;
}

export interface NofaParserResult {
  opportunityId: string;
  enrichedFields: string[];
  pdfsProcessed: number;
  /** PDFs successfully mirrored to Supabase Storage. */
  storedCount: number;
  tokensUsed: number;
}

function isEmptyValue(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "string" && val.trim() === "") return true;
  if (Array.isArray(val) && val.length === 0) return true;
  return false;
}

function parseDocuments(raw: unknown): OpportunityDocument[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is OpportunityDocument =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).url === "string",
  );
}

type PdfParseFn = (buf: Buffer) => Promise<{ text?: string }>;
let pdfParserPromise: Promise<PdfParseFn> | null = null;

/**
 * Lazily load pdf-parse. The package's index.js runs debug code at import that
 * reads a bundled test PDF (`./test/data/05-versions-space.pdf`) and crashes in
 * serverless bundles, so we import the INNER module (`pdf-parse/lib/pdf-parse.js`)
 * which has no such side effect, wrapped in try/catch so any failure surfaces as
 * a clear AgentError instead of a silent route crash. Memoized per cold start.
 */
async function getPdfParser(): Promise<PdfParseFn> {
  if (!pdfParserPromise) {
    pdfParserPromise = (async () => {
      try {
        // @ts-expect-error - no type declarations for the inner module path
        const mod = await import("pdf-parse/lib/pdf-parse.js");
        const fn = (mod.default ?? mod) as PdfParseFn;
        if (typeof fn !== "function") {
          throw new Error("pdf-parse export is not callable");
        }
        return fn;
      } catch (err) {
        pdfParserPromise = null; // allow a later retry
        throw new AgentError(
          "PDF parsing is unavailable on the server (pdf-parse failed to load): " +
            (err instanceof Error ? err.message : String(err)),
          "pdf_parse_unavailable",
        );
      }
    })();
  }
  return pdfParserPromise;
}

async function downloadDocument(
  url: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/pdf,text/html,*/*" },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    return { buffer: Buffer.from(await response.arrayBuffer()), contentType };
  } catch {
    return null;
  }
}

/**
 * Extract text from a downloaded document: HTML is stripped to text directly,
 * PDFs go through pdf-parse. Non-fatal: returns null on any failure - the stored
 * document is still viewable in-app, so we never abort the run over extraction.
 */
async function extractDocumentText(
  buffer: Buffer,
  isHtml: boolean,
): Promise<string | null> {
  if (isHtml) {
    try {
      return stripHtml(buffer.toString("utf8")) || null;
    } catch {
      return null;
    }
  }
  try {
    const pdfParse = await getPdfParser();
    const parsed = await pdfParse(buffer);
    return parsed.text ?? null;
  } catch {
    return null;
  }
}

async function extractWithClaude(
  pdfText: string,
): Promise<{ extraction: ClaudeExtraction; tokensUsed: number }> {
  const capped = pdfText.slice(0, MAX_PDF_TEXT_CHARS);
  const prompt =
    `Extract from this NOFA (Notice of Funding Availability): description (2-3 sentences), eligibility_requirements, amount_available, amount_min, amount_max, deadline (ISO date), geographic_restrictions, application_method, required_documents (string array), recurrence, key_priorities (string array). Return JSON only.\n\nNOFA text:\n` +
    capped;

  const res = await callClaude({
    prompt,
    maxTokens: 2048,
    temperature: 0,
  });

  // Strip markdown code fences if the model wraps the output.
  const raw = res.text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let extraction: ClaudeExtraction = {};
  try {
    extraction = JSON.parse(raw) as ClaudeExtraction;
  } catch {
    // JSON parse failed — return empty extraction; caller falls back gracefully.
  }

  return { extraction, tokensUsed: res.usage.totalTokens };
}

export class NofaParserAgent extends BaseAgent<NofaParserInput, NofaParserResult> {
  // p5a-002 (2026-09-15): was "government_research", colliding with the
  // canonical research/government-grants.ts writer. Renamed to its own
  // distinct DB enum value (already live) so agent_runs is attributable.
  readonly agentType: AgentType = "government_research_nofa_parser";

  constructor(options: BaseAgentOptions) {
    // PDF download + Claude extraction can take minutes for large NOFAs.
    // Cap at 270s to leave a 30s buffer under the 300s Vercel function limit.
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
  }

  protected async execute(
    input: NofaParserInput,
  ): Promise<AgentExecution<NofaParserResult>> {
    const { opportunityId } = input;

    // 1. Load the opportunity and all its stored document URLs.
    const { data: oppData, error: oppErr } = await this.client
      .from("opportunities")
      .select(
        "id, organization_id, opportunity_documents, description, eligibility_requirements, amount_available, amount_min, amount_max, deadline, geographic_restrictions, application_method, required_documents, recurrence",
      )
      .eq("id", opportunityId)
      .eq("organization_id", this.organizationId)
      .single();

    if (oppErr) {
      console.error(
        `[NofaParserAgent.execute] query failed for opportunityId=${opportunityId}: ${causeOf(oppErr)}`,
      );
      throw new AgentError(
        withCause(`Failed to load opportunity ${opportunityId}.`, oppErr),
        "db_error",
      );
    }
    if (!oppData) {
      throw new AgentError(
        `Opportunity ${opportunityId} not found.`,
        "opportunity_not_found",
        404,
      );
    }

    const opp = oppData as unknown as OpportunityRow;
    const documents = parseDocuments(opp.opportunity_documents);

    if (documents.length === 0) {
      return {
        data: {
          opportunityId,
          enrichedFields: [],
          pdfsProcessed: 0,
          storedCount: 0,
          tokensUsed: 0,
        },
        outputSummary: `NOFA parser: no PDF documents for opportunity ${opportunityId}.`,
        itemsFound: 0,
        itemsProcessed: 0,
        tokensUsed: 0,
      };
    }

    // 2. For each PDF: download -> mirror to Supabase Storage (for in-app
    // viewing) -> parse text -> extract structured fields via Claude. First
    // non-empty value wins across multiple PDFs. PDF parsing failures are
    // non-fatal so the stored (viewable) PDFs are always saved.
    let totalTokens = 0;
    let pdfsProcessed = 0;
    let storedCount = 0;
    const merged: Record<string, unknown> = {};
    const updatedDocs: OpportunityDocument[] = [];

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]!;
      let storedUrl = doc.storedUrl;

      const downloaded = await downloadDocument(doc.url);
      if (downloaded) {
        const isHtml = isHtmlDocument(
          doc.url,
          doc.title ?? "",
          downloaded.contentType,
        );

        let contentBuffer = downloaded.buffer;

        if (isHtml) {
          // grants.gov serves HTML as a meta-refresh stub pointing at the real
          // announcement; follow one hop to get the actual content. We do NOT
          // mirror HTML to storage - Supabase serves stored HTML as text/plain
          // (anti-XSS) so it can't render in an iframe; the detail view links to
          // the original instead. We still extract its text to enrich fields.
          const target = extractMetaRefreshUrl(
            downloaded.buffer.toString("utf8"),
          );
          if (target) {
            const real = await downloadDocument(target);
            if (real) contentBuffer = real.buffer;
          }
        } else {
          // PDF: mirror to storage so the detail page can show it inline.
          const filename = sanitizeFilename(doc.title ?? `nofa-${i + 1}`, "pdf");
          const uploaded = await this.uploadDocument(
            contentBuffer,
            opportunityId,
            filename,
            "application/pdf",
          );
          if (uploaded) {
            storedUrl = uploaded;
            storedCount++;
          }
        }

        const text = await extractDocumentText(contentBuffer, isHtml);
        if (text && text.trim().length >= 100) {
          pdfsProcessed++;
          const { extraction, tokensUsed } = await extractWithClaude(text);
          totalTokens += tokensUsed;

          const allKeys: (keyof ClaudeExtraction)[] = [
            ...DB_FIELDS,
            "key_priorities",
          ];
          for (const key of allKeys) {
            if (isEmptyValue(merged[key]) && !isEmptyValue(extraction[key])) {
              merged[key] = extraction[key];
            }
          }
        }
      }

      updatedDocs.push({
        title: doc.title,
        url: doc.url,
        ...(storedUrl ? { storedUrl } : {}),
      });
    }

    // 3. Build the UPDATE patch: only fields where the DB value is null/empty.
    const dbValues: Record<DbField, unknown> = {
      description: opp.description,
      eligibility_requirements: opp.eligibility_requirements,
      amount_available: opp.amount_available,
      amount_min: opp.amount_min,
      amount_max: opp.amount_max,
      deadline: opp.deadline,
      geographic_restrictions: opp.geographic_restrictions,
      application_method: opp.application_method,
      required_documents: opp.required_documents,
      recurrence: opp.recurrence,
    };

    const patch: Record<string, unknown> = {};
    const enrichedFields: string[] = [];

    for (const field of DB_FIELDS) {
      if (isEmptyValue(dbValues[field]) && !isEmptyValue(merged[field])) {
        patch[field] = merged[field];
        enrichedFields.push(field);
      }
    }

    // Persist opportunity_documents (preserving each source document's
    // original url, plus any mirrored storedUrl) whenever a PDF was stored
    // OR any field below was enriched from these documents. Provenance
    // requirement (AR-17.6): opportunity_documents is this agent's only
    // stored source pointer for the DB_FIELDS it writes below — gating it on
    // storedCount alone (the old behavior) let an HTML-only enrichment pass
    // write description/deadline/etc. in the same UPDATE with no source
    // record refreshed at all.
    if (storedCount > 0 || enrichedFields.length > 0) {
      patch.opportunity_documents = updatedDocs;
    }

    // 4. Apply the patch only if there is something new to write.
    if (Object.keys(patch).length > 0) {
      const { error: updateErr } = await this.client
        .from("opportunities")
        .update(patch)
        .eq("id", opportunityId)
        .eq("organization_id", this.organizationId);

      if (updateErr) {
        throw new AgentError(
          `Failed to update opportunity: ${updateErr.message}`,
          "update_failed",
        );
      }
    }

    return {
      data: { opportunityId, enrichedFields, pdfsProcessed, storedCount, tokensUsed: totalTokens },
      outputSummary:
        `NOFA parser: stored ${storedCount} PDF(s), parsed ${pdfsProcessed} for opportunity ${opportunityId}; ` +
        `enriched fields: ${enrichedFields.length > 0 ? enrichedFields.join(", ") : "none"}.`,
      itemsFound: pdfsProcessed,
      itemsProcessed: enrichedFields.length,
      tokensUsed: totalTokens,
    };
  }

  /**
   * Mirror a document buffer into the public nofa-pdfs bucket and return its
   * public URL. Idempotent (upsert). Returns null on any failure (non-fatal).
   */
  private async uploadDocument(
    buffer: Buffer,
    opportunityId: string,
    filename: string,
    contentType: string,
  ): Promise<string | null> {
    try {
      const path = `${this.organizationId}/nofa/${opportunityId}/${filename}`;
      const { error } = await this.client.storage
        .from(NOFA_BUCKET)
        .upload(path, buffer, { contentType, upsert: true });
      if (error) return null;
      const { data } = this.client.storage.from(NOFA_BUCKET).getPublicUrl(path);
      return data.publicUrl ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Batch enrichment: processes all opportunities where opportunity_documents is
 * not null (and contains at least one entry) AND description is null.
 *
 * Pass the service-role Supabase client so the query spans all organizations.
 * A session client works too but only sees the authenticated org's records.
 */
export async function runNofaBatch(
  client: SupabaseClient,
  triggeredBy: string | null = null,
): Promise<{ processed: number; enriched: number }> {
  const { data: rows } = await client
    .from("opportunities")
    .select("id, organization_id")
    .not("opportunity_documents", "is", null)
    .is("description", null)
    .limit(100);

  const candidates = (rows ?? []) as Array<{
    id: string;
    organization_id: string;
  }>;

  let processed = 0;
  let enriched = 0;

  for (const row of candidates) {
    // Skip rows where opportunity_documents resolved to an empty array.
    const agent = new NofaParserAgent({
      client,
      organizationId: row.organization_id,
      triggeredBy,
    });

    try {
      const outcome = await agent.run({ opportunityId: row.id });
      processed++;
      enriched += outcome.data.enrichedFields.length;
    } catch {
      // Non-fatal: log failures are written by BaseAgent; continue the batch.
    }
  }

  return { processed, enriched };
}
