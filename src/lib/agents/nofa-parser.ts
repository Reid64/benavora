// NOFA Parser Agent — downloads federal grant PDFs from opportunity_documents
// and extracts structured data to enrich opportunity records.
//
// Per-run behaviour:
//   1. Loads the target opportunity and its PDF document URLs.
//   2. Downloads each PDF (30s timeout per file), parses text with pdf-parse.
//   3. Sends parsed text to Claude with a structured extraction prompt.
//   4. Merges extracted fields across all PDFs (first non-empty wins).
//   5. UPDATEs the opportunity with extracted values, but ONLY for fields that
//      are currently null/empty in the database — never overwrites populated data.
//   6. Logs the run to agent_runs with agent_type = government_research.
//
// The exported runNofaBatch() function processes all opportunities where
// opportunity_documents is not null AND description is null.

import pdfParse from "pdf-parse";

import { callClaude } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
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

async function downloadAndParsePdf(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/pdf,*/*" },
    });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
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
  readonly agentType: AgentType = "government_research";

  constructor(options: BaseAgentOptions) {
    // PDF download + Claude extraction can take minutes for large NOFAs.
    // Cap at 270s to leave a 30s buffer under the 300s Vercel function limit.
    super({ ...options, timeoutMs: options.timeoutMs ?? 270_000 });
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

    if (oppErr || !oppData) {
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
          tokensUsed: 0,
        },
        outputSummary: `NOFA parser: no PDF documents for opportunity ${opportunityId}.`,
        itemsFound: 0,
        itemsProcessed: 0,
        tokensUsed: 0,
      };
    }

    // 2. Download each PDF, parse text, extract structured fields via Claude.
    // First non-empty value wins across multiple PDFs.
    let totalTokens = 0;
    let pdfsProcessed = 0;
    const merged: Record<string, unknown> = {};

    for (const doc of documents) {
      const text = await downloadAndParsePdf(doc.url);
      if (!text || text.trim().length < 100) continue;
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
      data: { opportunityId, enrichedFields, pdfsProcessed, tokensUsed: totalTokens },
      outputSummary:
        `NOFA parser: processed ${pdfsProcessed} PDF(s) for opportunity ${opportunityId}; ` +
        `enriched fields: ${enrichedFields.length > 0 ? enrichedFields.join(", ") : "none"}.`,
      itemsFound: pdfsProcessed,
      itemsProcessed: enrichedFields.length,
      tokensUsed: totalTokens,
    };
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
