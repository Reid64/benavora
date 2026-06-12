// Grant narrative prompt template (Agent 05 — Narrative Drafting).
//
// Builds the system + user prompt for grant-style drafts (grant narrative,
// budget narrative, impact statement, letter of inquiry, full proposal). The
// prompt enforces BEHAVIORAL_CONTRACTS §9: the model uses ONLY the supplied
// organizational data, flags any gap with [NEEDS INPUT: ...], and never
// fabricates statistics, certifications, partnerships, or promises.

import { humanizeEnum } from "@/lib/utils/formatters";
import type {
  DraftPrompt,
  DraftPromptContext,
  DraftTemplateType,
} from "@/types/ai";

/** Human-readable description of each grant template the funder receives. */
const TEMPLATE_BRIEF: Record<DraftTemplateType, string> = {
  grant_narrative:
    "a grant narrative: a structured proposal covering need, program design, capacity, and intended impact",
  donation_request_letter:
    "a donation request letter making a concise, compelling case for support",
  budget_narrative:
    "a budget narrative justifying each line item against the program's activities and the funder's priorities",
  impact_statement:
    "an impact statement quantifying the outcomes this funding will make possible",
  letter_of_inquiry:
    "a brief letter of inquiry introducing the organization and gauging the funder's interest before a full proposal",
  full_proposal:
    "a full grant proposal with all standard sections: summary, need statement, goals and objectives, program design, organizational capacity, budget justification, and evaluation",
};

function formatCurrencyRange(
  min: number | null,
  max: number | null,
): string | null {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`;
  if (max != null) return `up to ${fmt(max)}`;
  if (min != null) return `from ${fmt(min)}`;
  return null;
}

function renderOrganization(
  context: DraftPromptContext["organization"],
): string {
  if (!context) {
    return "No verified organization profile is available. Flag every organizational fact you would need with [NEEDS INPUT: ...].";
  }
  const lines: string[] = [];
  const add = (label: string, value: string | number | null) => {
    if (value !== null && value !== undefined && `${value}`.trim() !== "") {
      lines.push(`- ${label}: ${value}`);
    }
  };
  add("Legal name", context.name);
  add("Also known as", context.dba);
  add("EIN", context.ein);
  add("Tax status", context.taxStatus);
  add("Mission", context.missionStatement);
  add("Vision", context.visionStatement);
  add("Service area", context.serviceArea);
  add("Target population", context.targetPopulation);
  add("Founder", context.founderName);
  add(
    "Annual budget",
    context.annualBudget != null
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        }).format(context.annualBudget)
      : null,
  );
  return lines.length > 0
    ? lines.join("\n")
    : "The organization profile exists but is empty. Flag missing facts with [NEEDS INPUT: ...].";
}

function renderKnowledgeEntries(
  entries: DraftPromptContext["knowledgeEntries"],
): string {
  if (entries.length === 0) {
    return "No reusable narrative blocks are available for this template. Build only from the organization profile above, and flag any gap with [NEEDS INPUT: ...].";
  }
  return entries
    .map(
      (entry) =>
        `### ${entry.title} (${humanizeEnum(entry.category)})\n${entry.content.trim()}`,
    )
    .join("\n\n");
}

function renderProvenNarratives(
  narratives: DraftPromptContext["provenNarratives"],
): string {
  if (narratives.length === 0) {
    return "None available yet for this funder type. Proceed with the verified Knowledge Base content above.";
  }
  return narratives
    .map((narrative, index) => {
      const score =
        narrative.effectivenessScore != null
          ? ` (effectiveness ${Math.round(narrative.effectivenessScore * 100)}%)`
          : "";
      const section = narrative.sectionType
        ? `${humanizeEnum(narrative.sectionType)} — ` //
        : "";
      return `${index + 1}. ${section}previously funded${score}:\n${narrative.narrativeText.trim()}`;
    })
    .join("\n\n");
}

/**
 * Build the grant-narrative prompt for the given template type and context.
 * Used by /api/ai/draft for every template except the donation request letter,
 * which has its own dedicated builder.
 */
export function buildGrantNarrativePrompt(
  context: DraftPromptContext,
  templateType: DraftTemplateType,
): DraftPrompt {
  const orgName = context.organization?.name ?? "this organization";
  const brief = TEMPLATE_BRIEF[templateType] ?? TEMPLATE_BRIEF.grant_narrative;
  const amountRange = formatCurrencyRange(
    context.opportunity.amountMin,
    context.opportunity.amountMax,
  );

  const system = [
    `You are an expert grant writer for ${orgName}.`,
    "",
    "ABSOLUTE RULES — these override every other instruction:",
    "1. Use ONLY the organizational data provided below. Never invent facts.",
    "2. Never fabricate statistics, metrics, dollar figures, dates, certifications, accreditations, partnerships, or program outcomes that are not present in the provided data.",
    "3. If a required section needs information you were not given, insert a placeholder exactly in this form: [NEEDS INPUT: a short description of what is missing]. Do not guess.",
    "4. Do not promise future programs or outcomes that are not described in the provided program data.",
    "5. Write in a confident, specific, funder-aligned voice. Mirror the structure and language of any 'previously funded' narratives you are given — they have won before.",
  ].join("\n");

  const opportunityLines: string[] = [
    `- Opportunity: ${context.opportunity.name}`,
    `- Funder: ${context.opportunity.funderName ?? "Unspecified funder"}`,
    `- Category: ${humanizeEnum(context.opportunity.category)}`,
  ];
  if (amountRange) opportunityLines.push(`- Funding available: ${amountRange}`);
  if (context.opportunity.eligibilityRequirements) {
    opportunityLines.push(
      `- Eligibility / requirements: ${context.opportunity.eligibilityRequirements}`,
    );
  }
  if (context.opportunity.requiredDocuments?.length) {
    opportunityLines.push(
      `- Required documents: ${context.opportunity.requiredDocuments.join(", ")}`,
    );
  }

  const prompt = [
    `# Task`,
    `Write ${brief} for "${context.opportunity.name}". Match the funder's stated priorities throughout.`,
    "",
    `What the funder is looking for: ${
      context.opportunity.description?.trim() ||
      "Not stated explicitly — infer from the category and requirements below, and flag anything you cannot ground with [NEEDS INPUT: ...]."
    }`,
    "",
    "## Opportunity details",
    opportunityLines.join("\n"),
    "",
    "## Verified organization profile",
    renderOrganization(context.organization),
    "",
    "## Reusable narrative blocks (verified Knowledge Base content)",
    renderKnowledgeEntries(context.knowledgeEntries),
    "",
    "## Previously funded narratives — weight their patterns, structure, and language heavily",
    renderProvenNarratives(context.provenNarratives),
    "",
    "## Output",
    "Return only the finished draft text, ready for an editor to review. Use clear section headings where appropriate. Remember: every organizational fact must come from the data above, and every gap must be marked with [NEEDS INPUT: ...].",
  ].join("\n");

  return { system, prompt };
}
