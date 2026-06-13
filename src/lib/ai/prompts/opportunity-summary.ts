// Opportunity Summary prompt template - AGENTS.md Agent 01 (Grant Summary).
//
// Builds the system + user prompt that turns a raw opportunity page (or pasted
// description) into structured, actionable fields: funder/program name, funding
// amount or range, deadline, eligibility requirements, required documents,
// application method, geographic restrictions, recurrence, and a short summary.
//
// The model returns ONLY a single JSON object so the agent can parse it and
// patch the opportunity record. As with every extraction prompt the model must
// report what the source actually says and use null where a fact is absent -
// it never invents figures, dates, or requirements (BEHAVIORAL_CONTRACTS §9).

export interface OpportunitySummaryPromptInput {
  /** The opportunity's current name, for context. */
  opportunityName: string;
  /** The opportunity's category enum value, for context. */
  category: string;
  /** Source URL, if one was fetched. */
  url: string | null;
  /** Raw text to extract from: fetched page content and/or pasted description. */
  rawContent: string;
}

export interface OpportunitySummaryPrompt {
  system: string;
  prompt: string;
}

/**
 * Build the extraction prompt. The agent supplies whatever raw text it has
 * (fetched page body, a pasted description, or both); the model extracts the
 * structured fields and returns them as JSON.
 */
export function buildOpportunitySummaryPrompt(
  input: OpportunitySummaryPromptInput,
): OpportunitySummaryPrompt {
  const system = [
    "You are a grants analyst extracting structured data from a funding opportunity.",
    "",
    "RULES:",
    "1. Extract ONLY what the provided text actually states. Never invent amounts, dates, deadlines, or requirements.",
    "2. Use null for any field the text does not establish. Do not guess.",
    "3. Express money as plain integers in US dollars (no symbols, commas, or words).",
    "4. Express the deadline as an ISO 8601 date (YYYY-MM-DD) if a specific date is stated; otherwise null.",
    '5. recurrence must be exactly one of "one_time", "annual", "quarterly", "rolling", or null.',
    "6. Respond with ONLY a single JSON object, no prose and no code fences, in exactly this shape:",
    JSON.stringify({
      funderName: "<string or null>",
      programName: "<string or null>",
      amountMin: "<integer or null>",
      amountMax: "<integer or null>",
      amountAvailable: "<integer or null>",
      deadline: "<YYYY-MM-DD or null>",
      eligibilityRequirements: "<string or null>",
      requiredDocuments: "<array of strings or null>",
      applicationMethod: "<string or null>",
      geographicRestrictions: "<string or null>",
      recurrence: "<one_time|annual|quarterly|rolling or null>",
      summary: "<2-3 sentence plain-language summary of what the funder wants>",
    }),
  ].join("\n");

  const contextLines = [
    `- Opportunity name (existing): ${input.opportunityName}`,
    `- Category (existing): ${input.category}`,
  ];
  if (input.url) contextLines.push(`- Source URL: ${input.url}`);

  const prompt = [
    "## Context",
    contextLines.join("\n"),
    "",
    "## Source text",
    input.rawContent.trim() || "(No source text was available.)",
    "",
    "Extract the structured fields now. Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}
