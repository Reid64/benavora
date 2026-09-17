// Grant Summary Agent - AGENTS.md Agent 01.
//
// Turns a raw opportunity (a URL and/or pasted description) into structured,
// actionable fields. It optionally fetches the source page server-side, sends
// the text to Claude for extraction, then patches the opportunity record with
// the structured fields it parses back.
//
// Per BEHAVIORAL_CONTRACTS §9 the model extracts only what the source states and
// returns null for anything absent; this agent only writes fields the model
// actually populated, so it enriches an opportunity without clobbering existing
// data. If no source text is available it flags the opportunity for manual entry
// rather than inventing fields.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { buildOpportunitySummaryPrompt } from "@/lib/ai/prompts/opportunity-summary";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

/** Recurrence values the schema/prompt allow. */
const RECURRENCES = ["one_time", "annual", "quarterly", "rolling"] as const;
type Recurrence = (typeof RECURRENCES)[number];

/** Cap on fetched page content to keep prompt size bounded. */
const MAX_CONTENT_CHARS = 16_000;
/** Per-fetch timeout, well within the agent's overall 60s ceiling. */
const FETCH_TIMEOUT_MS = 15_000;

export interface GrantSummaryInput {
  opportunityId: string;
  /** Optional pasted description text to extract from in addition to the URL. */
  rawText?: string;
}

/** The structured fields extracted from the source. */
export interface OpportunitySummary {
  funderName: string | null;
  programName: string | null;
  amountMin: number | null;
  amountMax: number | null;
  amountAvailable: number | null;
  deadline: string | null;
  eligibilityRequirements: string | null;
  requiredDocuments: string[] | null;
  applicationMethod: string | null;
  geographicRestrictions: string | null;
  recurrence: Recurrence | null;
  summary: string;
}

export interface GrantSummaryResult {
  opportunityId: string;
  /** True when no source text was available and no extraction was attempted. */
  needsManualEntry: boolean;
  summary: OpportunitySummary | null;
  /** The opportunity field names that were updated. */
  updatedFields: string[];
}

export interface GrantSummaryAgentOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

export class GrantSummaryAgent extends BaseAgent<
  GrantSummaryInput,
  GrantSummaryResult
> {
  readonly agentType: AgentType = "grant_summary";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: GrantSummaryAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? 300_000 });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: GrantSummaryInput,
  ): Promise<AgentExecution<GrantSummaryResult>> {
    const opportunityId = input.opportunityId;

    const { data: opp, error } = await this.client
      .from("opportunities")
      .select("id, name, category, url, description")
      .eq("id", opportunityId)
      .eq("organization_id", this.organizationId)
      .single();

    if (error || !opp) {
      throw new AgentError("Opportunity not found.", "not_found", 404);
    }

    // Assemble source text: fetched page (best effort) + pasted text + any
    // existing description. If none of these yield content, flag for manual entry.
    const pageText = opp.url ? await fetchPageText(opp.url as string) : "";
    const parts = [
      pageText,
      (input.rawText ?? "").trim(),
      (opp.description as string | null) ?? "",
    ].filter((p) => p && p.trim() !== "");
    const rawContent = parts.join("\n\n").slice(0, MAX_CONTENT_CHARS);

    if (rawContent.trim() === "") {
      return {
        data: {
          opportunityId,
          needsManualEntry: true,
          summary: null,
          updatedFields: [],
        },
        outputSummary: `No source text for "${opp.name}" - flagged for manual entry.`,
        itemsFound: 0,
        itemsProcessed: 0,
        tokensUsed: 0,
      };
    }

    const { system, prompt } = buildOpportunitySummaryPrompt({
      opportunityName: opp.name as string,
      category: opp.category as string,
      url: (opp.url as string | null) ?? null,
      rawContent,
    });

    const response = await callClaude({
      system,
      prompt,
      model: this.model,
      maxTokens: this.maxTokens,
    });

    const summary = parseSummaryResponse(response.text);

    // Patch only the fields the model populated so we never overwrite existing
    // data with nulls. The 2-3 sentence summary always refreshes the description.
    const patch: Record<string, unknown> = {
      description: summary.summary,
      updated_at: new Date().toISOString(),
    };
    const setIf = (key: string, value: unknown) => {
      if (value !== null && value !== undefined) patch[key] = value;
    };
    setIf("amount_min", summary.amountMin);
    setIf("amount_max", summary.amountMax);
    setIf("amount_available", summary.amountAvailable);
    setIf("deadline", summary.deadline);
    setIf("eligibility_requirements", summary.eligibilityRequirements);
    setIf("required_documents", summary.requiredDocuments);
    setIf("application_method", summary.applicationMethod);
    setIf("geographic_restrictions", summary.geographicRestrictions);
    setIf("recurrence", summary.recurrence);

    const { error: updateError } = await this.client
      .from("opportunities")
      .update(patch)
      .eq("id", opportunityId)
      .eq("organization_id", this.organizationId);

    if (updateError) {
      throw new AgentError(
        "Failed to save the opportunity summary.",
        "write_failed",
      );
    }

    const updatedFields = Object.keys(patch).filter((k) => k !== "updated_at");

    return {
      data: {
        opportunityId,
        needsManualEntry: false,
        summary,
        updatedFields,
      },
      outputSummary: `Summarized "${opp.name}" and updated ${updatedFields.length} field(s).`,
      itemsFound: 1,
      itemsProcessed: 1,
      tokensUsed: response.usage.totalTokens,
    };
  }
}

// --- source fetching ---------------------------------------------------------

/**
 * Fetch a URL server-side and reduce it to readable text. Best effort: any
 * failure (network, timeout, non-OK status) returns "" so the agent can fall
 * back to pasted/existing text and flag for manual entry if nothing remains.
 */
async function fetchPageText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "BenavoraGrantSummaryBot/1.0" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    return htmlToText(html);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Strip scripts/styles/tags and collapse whitespace to plain text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// --- response parsing --------------------------------------------------------

function toIntOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Parse the extraction JSON. Tolerant of stray prose/code fences: scans for the
 * first balanced object. Throws AgentError on unreadable/invalid output so the
 * run is logged as failed (agents never fail silently).
 */
export function parseSummaryResponse(text: string): OpportunitySummary {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AgentError(
      "The summary model returned an unreadable response.",
      "bad_model_output",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AgentError(
      "The summary model returned malformed JSON.",
      "bad_model_output",
    );
  }

  const obj = (raw ?? {}) as Record<string, unknown>;

  const recRaw =
    typeof obj.recurrence === "string"
      ? obj.recurrence.trim().toLowerCase()
      : "";
  const recurrence = (RECURRENCES as readonly string[]).includes(recRaw)
    ? (recRaw as Recurrence)
    : null;

  const docs = Array.isArray(obj.requiredDocuments)
    ? obj.requiredDocuments
        .map((d) => (typeof d === "string" ? d.trim() : ""))
        .filter((d) => d !== "")
    : null;

  const deadline = toStringOrNull(obj.deadline);
  // Keep only an ISO-style date; ignore anything the model couldn't normalize.
  const validDeadline =
    deadline && /^\d{4}-\d{2}-\d{2}/.test(deadline) ? deadline : null;

  return {
    funderName: toStringOrNull(obj.funderName),
    programName: toStringOrNull(obj.programName),
    amountMin: toIntOrNull(obj.amountMin),
    amountMax: toIntOrNull(obj.amountMax),
    amountAvailable: toIntOrNull(obj.amountAvailable),
    deadline: validDeadline,
    eligibilityRequirements: toStringOrNull(obj.eligibilityRequirements),
    requiredDocuments: docs && docs.length > 0 ? docs : null,
    applicationMethod: toStringOrNull(obj.applicationMethod),
    geographicRestrictions: toStringOrNull(obj.geographicRestrictions),
    recurrence,
    summary:
      toStringOrNull(obj.summary) ??
      "No summary was provided by the model.",
  };
}
