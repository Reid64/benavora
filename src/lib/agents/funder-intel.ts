// Funder Intelligence Agent - extracts structured funding intelligence from a
// funder's public website and upserts it into funder_intelligence.
//
// The agent fetches the funder's website (best-effort, falls back to any
// existing description), sends the content to Claude for structured extraction,
// then upserts the result into funder_intelligence and timestamps last_scraped_at.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import type { Json } from "@/types/database";

const MAX_CONTENT_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 15_000;

export interface FunderIntelInput {
  funderId: string;
}

export interface FunderIntelResult {
  funderId: string;
  intelId: string;
  priorities: string[];
  recentGrants: Json;
  boardMembers: Json;
  reviewCriteria: string | null;
  fundingCycles: string | null;
  averageGrantSize: number | null;
  totalAnnualGiving: number | null;
  applicationTips: string | null;
}

export interface FunderIntelAgentOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

export class FunderIntelAgent extends BaseAgent<
  FunderIntelInput,
  FunderIntelResult
> {
  readonly agentType: AgentType = "funder_intel";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: FunderIntelAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: FunderIntelInput,
  ): Promise<AgentExecution<FunderIntelResult>> {
    const { data: funder, error } = await this.client
      .from("funders")
      .select("id, name, website, description")
      .eq("id", input.funderId)
      .eq("organization_id", this.organizationId)
      .single();

    if (error || !funder) {
      throw new AgentError("Funder not found.", "not_found", 404);
    }

    const pageText = funder.website
      ? await fetchPageText(funder.website as string)
      : "";

    const rawContent = [
      pageText,
      (funder.description as string | null) ?? "",
    ]
      .filter((s) => s.trim() !== "")
      .join("\n\n")
      .slice(0, MAX_CONTENT_CHARS);

    if (rawContent.trim() === "") {
      throw new AgentError(
        "No content available for this funder - add a website or description first.",
        "no_content",
        422,
      );
    }

    const response = await callClaude({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(funder.name as string, rawContent),
      model: this.model,
      maxTokens: this.maxTokens,
    });

    const intel = parseIntelResponse(response.text);

    const now = new Date().toISOString();
    const { data: row, error: upsertError } = await this.client
      .from("funder_intelligence")
      .upsert(
        {
          organization_id: this.organizationId,
          funder_id: input.funderId,
          priorities: intel.priorities,
          recent_grants: intel.recentGrants as Json,
          board_members: intel.boardMembers as Json,
          review_criteria: intel.reviewCriteria,
          funding_cycles: intel.fundingCycles,
          average_grant_size: intel.averageGrantSize,
          total_annual_giving: intel.totalAnnualGiving,
          application_tips: intel.applicationTips,
          last_scraped_at: now,
          // Provenance (AR-17.6): funders.website is a live, mutable value on
          // a different table -- if it changes later, the source URL actually
          // fetched for THIS snapshot would otherwise be unrecoverable. Store
          // it alongside the page text it produced, in the same write.
          raw_data: {
            pageText: pageText.slice(0, 5000),
            sourceUrl: (funder.website as string | null) ?? null,
          } as Json,
          updated_at: now,
        },
        { onConflict: "organization_id,funder_id" },
      )
      .select("id")
      .single();

    if (upsertError || !row) {
      throw new AgentError(
        "Failed to save funder intelligence.",
        "write_failed",
      );
    }

    return {
      data: {
        funderId: input.funderId,
        intelId: row.id as string,
        priorities: intel.priorities,
        recentGrants: intel.recentGrants as Json,
        boardMembers: intel.boardMembers as Json,
        reviewCriteria: intel.reviewCriteria,
        fundingCycles: intel.fundingCycles,
        averageGrantSize: intel.averageGrantSize,
        totalAnnualGiving: intel.totalAnnualGiving,
        applicationTips: intel.applicationTips,
      },
      outputSummary: `Extracted intelligence for "${funder.name}": ${intel.priorities.length} priorities, ${Array.isArray(intel.recentGrants) ? (intel.recentGrants as unknown[]).length : 0} recent grants.`,
      itemsFound: 1,
      itemsProcessed: 1,
      tokensUsed: response.usage.totalTokens,
    };
  }
}

// --- prompt ------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a grant research analyst. Extract structured funding intelligence from a funder's website content. Return ONLY valid JSON matching this schema - no prose, no markdown fences:

{
  "priorities": ["string", ...],
  "recentGrants": [{"recipient": "string", "amount": number|null, "year": number|null, "purpose": "string"}, ...],
  "boardMembers": [{"name": "string", "title": "string|null"}, ...],
  "reviewCriteria": "string|null",
  "fundingCycles": "string|null",
  "averageGrantSize": number|null,
  "totalAnnualGiving": number|null,
  "applicationTips": "string|null"
}

Rules:
- Only include what the source text actually states; use null for anything absent.
- priorities: list of funding focus areas/themes (max 10).
- recentGrants: list of named grant awards mentioned (max 20).
- boardMembers: list of board or committee members mentioned (max 20).
- reviewCriteria: scoring criteria or review process description.
- fundingCycles: when they accept applications (e.g. "rolling", "twice yearly", "deadline March 1").
- averageGrantSize: typical or stated average award in USD as a number.
- totalAnnualGiving: total annual giving in USD as a number.
- applicationTips: practical advice for applicants extracted from the text.`;

function buildPrompt(funderName: string, content: string): string {
  return `Funder: ${funderName}\n\nWebsite content:\n${content}`;
}

// --- response parsing --------------------------------------------------------

interface RawIntel {
  priorities: string[];
  recentGrants: Json;
  boardMembers: Json;
  reviewCriteria: string | null;
  fundingCycles: string | null;
  averageGrantSize: number | null;
  totalAnnualGiving: number | null;
  applicationTips: string | null;
}

function parseIntelResponse(text: string): RawIntel {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AgentError(
      "The intelligence model returned an unreadable response.",
      "bad_model_output",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AgentError(
      "The intelligence model returned malformed JSON.",
      "bad_model_output",
    );
  }

  const obj = (raw ?? {}) as Record<string, unknown>;

  const priorities = Array.isArray(obj.priorities)
    ? obj.priorities
        .map((p) => (typeof p === "string" ? p.trim() : ""))
        .filter((p) => p !== "")
    : [];

  const recentGrants = Array.isArray(obj.recentGrants)
    ? (obj.recentGrants as Json)
    : ([] as Json);

  const boardMembers = Array.isArray(obj.boardMembers)
    ? (obj.boardMembers as Json)
    : ([] as Json);

  return {
    priorities,
    recentGrants,
    boardMembers,
    reviewCriteria: toStringOrNull(obj.reviewCriteria),
    fundingCycles: toStringOrNull(obj.fundingCycles),
    averageGrantSize: toNumericOrNull(obj.averageGrantSize),
    totalAnnualGiving: toNumericOrNull(obj.totalAnnualGiving),
    applicationTips: toStringOrNull(obj.applicationTips),
  };
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function toNumericOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// --- fetch -------------------------------------------------------------------

async function fetchPageText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "BenavoraFunderIntelBot/1.0" },
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
