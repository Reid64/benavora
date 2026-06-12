// Review prompt template — AGENTS.md Agent 08 (Review).
//
// Builds the system + user prompt for a critical quality review of a drafted
// application before submission. The reviewer checks for claims not supported by
// the organization's verified data, overly optimistic projections, vague
// language, tone/grammar issues, alignment with the funder's priorities, missing
// sections, weak arguments, and risky claims. It returns a structured,
// section-by-section review as JSON so the agent can store and surface it.

import { humanizeEnum } from "@/lib/utils/formatters";

export interface ReviewOpportunityContext {
  name: string;
  category: string;
  funderName: string | null;
  description: string | null;
  eligibilityRequirements: string | null;
}

export interface ReviewContext {
  opportunity: ReviewOpportunityContext;
  /** The draft under review. */
  draftContent: string;
  /**
   * Verified organizational facts the draft's claims should be checkable
   * against. Kept short — titles + content of the relevant KB entries.
   */
  knowledgeFacts: string[];
}

export interface ReviewPrompt {
  system: string;
  prompt: string;
}

function renderKnowledge(facts: string[]): string {
  if (facts.length === 0) {
    return "No verified Knowledge Base facts were supplied. Flag any factual claim in the draft that cannot be independently verified as a credibility risk.";
  }
  return facts.map((f) => `- ${f}`).join("\n");
}

/**
 * Build the review prompt. The model returns a single JSON object with an
 * overall readiness score, per-section scores and issues, and general issues.
 */
export function buildReviewPrompt(context: ReviewContext): ReviewPrompt {
  const system = [
    "You are a critical grant reviewer evaluating a draft application before submission.",
    "",
    "RULES:",
    "1. Be rigorous and specific. Flag factual claims not supported by the verified organizational data provided.",
    "2. Call out overly optimistic projections, vague language where specifics are needed, grammar and tone issues, missing sections, weak arguments, and risky claims that could harm credibility.",
    "3. Judge alignment with the funder's stated priorities.",
    "4. Scores are integers 0-100. Be honest — a low score with clear fixes is more useful than false reassurance.",
    "5. Respond with ONLY a single JSON object, no prose and no code fences, in exactly this shape:",
    JSON.stringify({
      overallReadiness: "<integer 0-100>",
      sections: [
        {
          name: "<section name>",
          score: "<integer 0-100>",
          issues: ["<specific issue>"],
          suggestions: ["<specific improvement>"],
        },
      ],
      generalIssues: ["<cross-cutting issue not tied to one section>"],
      summary: "<2-3 sentence overall assessment>",
    }),
  ].join("\n");

  const oppLines: string[] = [
    `- Opportunity: ${context.opportunity.name}`,
    `- Funder: ${context.opportunity.funderName ?? "Unspecified funder"}`,
    `- Category: ${humanizeEnum(context.opportunity.category)}`,
  ];
  if (context.opportunity.description) {
    oppLines.push(`- What the funder wants: ${context.opportunity.description}`);
  }
  if (context.opportunity.eligibilityRequirements) {
    oppLines.push(
      `- Eligibility / requirements: ${context.opportunity.eligibilityRequirements}`,
    );
  }

  const prompt = [
    "# Task",
    "Review the draft application below critically and return your structured assessment.",
    "",
    "## Opportunity details",
    oppLines.join("\n"),
    "",
    "## Verified organizational facts (the draft's claims should be checkable against these)",
    renderKnowledge(context.knowledgeFacts),
    "",
    "## Draft under review",
    context.draftContent.trim() || "(The draft is empty.)",
    "",
    "## Output",
    "Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}
