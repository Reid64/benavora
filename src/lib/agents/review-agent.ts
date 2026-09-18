// Review Agent - AGENTS.md Agent 08.
//
// Performs a critical quality review of an application's draft before submission:
// section-by-section scores, specific issues, suggested improvements, and an
// overall readiness score. It grounds the review in the organization's verified
// Knowledge Base so the model can flag claims the draft makes that aren't
// supported by real data (BEHAVIORAL_CONTRACTS §9). The structured review is
// stored as a note on the application and returned to the caller.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { buildReviewPrompt } from "@/lib/ai/prompts/review";
import {
  AgentError,
  BaseAgent,
  withCause,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

/** How many KB entries to supply as the factual basis for the review. */
const MAX_KB_FACTS = 8;
/** Truncate each KB fact to keep the prompt bounded. */
const KB_FACT_MAX_CHARS = 600;

export interface ReviewInput {
  applicationId: string;
}

export interface ReviewSection {
  name: string;
  score: number;
  issues: string[];
  suggestions: string[];
}

export interface ReviewResult {
  applicationId: string;
  overallReadiness: number;
  sections: ReviewSection[];
  generalIssues: string[];
  summary: string;
}

export interface ReviewAgentOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

export class ReviewAgent extends BaseAgent<ReviewInput, ReviewResult> {
  readonly agentType: AgentType = "review";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: ReviewAgentOptions) {
    // Section-by-section KB-grounded review is a single but heavy Claude call;
    // needs more than the 60s default. Cap at 270s to leave a 30s buffer under
    // the 300s Vercel function limit (same as grants-gov.ts, nofa-parser.ts,
    // sam-gov.ts, state-scrapers.ts, tdhca-scraper.ts).
    super({ ...options, timeoutMs: options.timeoutMs ?? 270_000 });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: ReviewInput,
  ): Promise<AgentExecution<ReviewResult>> {
    const applicationId = input.applicationId;

    this.setPhase("fetching application");
    const { data: app, error } = await this.client
      .from("applications")
      .select("id, opportunity_id, draft_content")
      .eq("id", applicationId)
      .eq("organization_id", this.organizationId)
      .single();

    if (error || !app) {
      throw new AgentError("Application not found.", "not_found", 404);
    }

    const draft = (app.draft_content as string | null) ?? "";
    if (draft.trim() === "") {
      throw new AgentError(
        "There is no draft to review on this application.",
        "no_draft",
        400,
      );
    }

    this.setPhase("fetching opportunity and knowledge base");
    const [oppRes, kbRes] = await Promise.all([
      this.client
        .from("opportunities")
        .select(
          "name, category, funder_id, description, eligibility_requirements",
        )
        .eq("id", app.opportunity_id)
        .eq("organization_id", this.organizationId)
        .single(),
      this.client
        .from("knowledge_base")
        .select("title, content")
        .eq("organization_id", this.organizationId)
        .order("is_proven", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(MAX_KB_FACTS),
    ]);

    if (oppRes.error || !oppRes.data) {
      throw new AgentError("Opportunity not found.", "not_found", 404);
    }
    const opp = oppRes.data;

    const funderRes = opp.funder_id
      ? await this.client
          .from("funders")
          .select("name")
          .eq("id", opp.funder_id)
          .eq("organization_id", this.organizationId)
          .single()
      : { data: null };

    const knowledgeFacts = (kbRes.data ?? []).map((entry) => {
      const content = (entry.content as string).trim().slice(0, KB_FACT_MAX_CHARS);
      return `${entry.title as string}: ${content}`;
    });

    const { system, prompt } = buildReviewPrompt({
      opportunity: {
        name: opp.name as string,
        category: opp.category as string,
        funderName: (funderRes.data?.name as string | null | undefined) ?? null,
        description: (opp.description as string | null) ?? null,
        eligibilityRequirements:
          (opp.eligibility_requirements as string | null) ?? null,
      },
      draftContent: draft,
      knowledgeFacts,
    });

    this.setPhase("calling claude for review");
    const response = await callClaude({
      system,
      prompt,
      model: this.model,
      maxTokens: this.maxTokens,
    });

    this.setPhase("parsing claude response");
    const parsed = parseReviewResponse(response.text);

    this.setPhase("saving review note");
    // Persist the review as a note on the application (best effort).
    await this.client.from("notes").insert({
      organization_id: this.organizationId,
      application_id: applicationId,
      content: formatReviewNote(parsed),
      author_id: this.triggeredBy,
    });

    return {
      data: { applicationId, ...parsed },
      outputSummary: `Reviewed "${opp.name}" - readiness ${parsed.overallReadiness}/100, ${parsed.sections.length} section(s).`,
      itemsFound: parsed.sections.length,
      itemsProcessed: parsed.sections.length,
      tokensUsed: response.usage.totalTokens,
    };
  }
}

// --- formatting --------------------------------------------------------------

function formatReviewNote(review: Omit<ReviewResult, "applicationId">): string {
  const lines: string[] = [
    `**Review** - overall readiness ${review.overallReadiness}/100`,
    "",
    review.summary,
  ];
  for (const section of review.sections) {
    lines.push("", `### ${section.name} (${section.score}/100)`);
    for (const issue of section.issues) lines.push(`- Issue: ${issue}`);
    for (const s of section.suggestions) lines.push(`- Suggestion: ${s}`);
  }
  if (review.generalIssues.length > 0) {
    lines.push("", "### General");
    for (const g of review.generalIssues) lines.push(`- ${g}`);
  }
  return lines.join("\n");
}

// --- response parsing --------------------------------------------------------

function clampScore(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v !== "");
}

/**
 * Parse the structured review JSON. Tolerant of stray prose/code fences. Throws
 * AgentError when no JSON object is present so the run is logged as failed.
 */
export function parseReviewResponse(
  text: string,
): Omit<ReviewResult, "applicationId"> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AgentError(
      "The review model returned an unreadable response.",
      "bad_model_output",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new AgentError(
      withCause("The review model returned malformed JSON.", err),
      "bad_model_output",
    );
  }

  const obj = (raw ?? {}) as {
    overallReadiness?: unknown;
    sections?: unknown;
    generalIssues?: unknown;
    summary?: unknown;
  };

  const sections: ReviewSection[] = Array.isArray(obj.sections)
    ? obj.sections
        .map((s) => {
          const sec = (s ?? {}) as Record<string, unknown>;
          const name = typeof sec.name === "string" ? sec.name.trim() : "";
          if (name === "") return null;
          return {
            name,
            score: clampScore(sec.score),
            issues: toStringArray(sec.issues),
            suggestions: toStringArray(sec.suggestions),
          } satisfies ReviewSection;
        })
        .filter((s): s is ReviewSection => s !== null)
    : [];

  return {
    overallReadiness: clampScore(obj.overallReadiness),
    sections,
    generalIssues: toStringArray(obj.generalIssues),
    summary:
      typeof obj.summary === "string" && obj.summary.trim() !== ""
        ? obj.summary.trim()
        : "No summary was provided by the model.",
  };
}
