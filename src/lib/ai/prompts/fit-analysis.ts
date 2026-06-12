// Fit Analysis prompt template — AGENTS.md Agent 04.
//
// Builds the system + user prompt for a deep "should we apply?" analysis. Unlike
// the Eligibility Scoring Agent (a quick qualify/disqualify pass), fit analysis
// weighs effort vs. reward, alignment with current programs, competitive
// landscape, and strategic value beyond the dollars — informed by the
// organization's historical success rate with this funder category when enough
// outcomes exist to be meaningful (BEHAVIORAL_CONTRACTS §10).
//
// Like all drafting prompts (BEHAVIORAL_CONTRACTS §9) the model uses ONLY the
// verified data supplied here and never fabricates organizational facts.

import { humanizeEnum } from "@/lib/utils/formatters";

/** Verified organization facts relevant to a fit decision. */
export interface FitAnalysisOrgContext {
  name: string;
  missionStatement: string | null;
  serviceArea: string | null;
  targetPopulation: string | null;
  annualBudget: number | null;
  programs: string[];
}

/** The opportunity under consideration. */
export interface FitAnalysisOpportunityContext {
  name: string;
  category: string;
  description: string | null;
  funderName: string | null;
  eligibilityRequirements: string | null;
  amountMin: number | null;
  amountMax: number | null;
  eligibilityScore: number | null;
}

/**
 * Historical track record with this funder category. `sufficient` is false when
 * the sample is below the analytics minimum — the prompt then tells the model to
 * treat history as unavailable rather than read a rate off a tiny sample.
 */
export interface FitAnalysisHistory {
  sufficient: boolean;
  totalOutcomes: number;
  awardedCount: number;
  /** Success rate as a 0-100 percentage, or null when not sufficient. */
  successRate: number | null;
}

export interface FitAnalysisContext {
  organization: FitAnalysisOrgContext | null;
  opportunity: FitAnalysisOpportunityContext;
  history: FitAnalysisHistory;
}

export interface FitAnalysisPrompt {
  system: string;
  prompt: string;
}

function formatCurrency(amount: number | null): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function renderHistory(history: FitAnalysisHistory): string {
  if (!history.sufficient || history.successRate == null) {
    return history.totalOutcomes > 0
      ? `Only ${history.totalOutcomes} recorded outcome(s) in this category — too few to compute a reliable success rate. Do not infer a rate; weigh strategic factors more heavily instead.`
      : "No recorded outcomes in this category yet. There is no track record to lean on; weigh strategic factors more heavily instead.";
  }
  return `Across ${history.totalOutcomes} recorded outcomes in this funder category, ${history.awardedCount} were awarded — a historical success rate of ${history.successRate}%.`;
}

function renderOrganization(org: FitAnalysisOrgContext | null): string {
  if (!org) {
    return "No verified organization profile is available. Note where missing profile data limits the analysis.";
  }
  const lines: string[] = [];
  const add = (label: string, value: string | null) => {
    if (value != null && `${value}`.trim() !== "") {
      lines.push(`- ${label}: ${value}`);
    }
  };
  add("Legal name", org.name);
  add("Mission", org.missionStatement);
  add("Service area", org.serviceArea);
  add("Target population", org.targetPopulation);
  add("Annual budget", formatCurrency(org.annualBudget));
  if (org.programs.length > 0) {
    lines.push(`- Current programs: ${org.programs.join("; ")}`);
  }
  return lines.length > 0
    ? lines.join("\n")
    : "The organization profile exists but is empty. Note that missing data limits the analysis.";
}

/**
 * Build the fit-analysis prompt. The model returns prose (a structured written
 * analysis), not JSON — the route stores it verbatim and surfaces it to the user.
 */
export function buildFitAnalysisPrompt(
  context: FitAnalysisContext,
): FitAnalysisPrompt {
  const orgName = context.organization?.name ?? "this organization";

  const system = [
    `You are a strategic grants advisor for ${orgName}.`,
    "",
    "RULES:",
    "1. Use ONLY the organizational data provided below. Never fabricate facts, figures, programs, or partnerships.",
    "2. Ground your reasoning in the supplied historical success data; if it is insufficient, say so plainly and do not invent a rate.",
    "3. Be candid: a clear-eyed 'pass' is more valuable than false optimism.",
  ].join("\n");

  const amountRange = [
    formatCurrency(context.opportunity.amountMin),
    formatCurrency(context.opportunity.amountMax),
  ];

  const oppLines: string[] = [
    `- Opportunity: ${context.opportunity.name}`,
    `- Funder: ${context.opportunity.funderName ?? "Unspecified funder"}`,
    `- Category: ${humanizeEnum(context.opportunity.category)}`,
  ];
  if (amountRange[0] || amountRange[1]) {
    oppLines.push(
      `- Award range: ${amountRange[0] ?? "?"} – ${amountRange[1] ?? "?"}`,
    );
  }
  if (context.opportunity.eligibilityScore != null) {
    oppLines.push(
      `- Prior eligibility score: ${context.opportunity.eligibilityScore}/100`,
    );
  }
  if (context.opportunity.eligibilityRequirements) {
    oppLines.push(
      `- Eligibility / requirements: ${context.opportunity.eligibilityRequirements}`,
    );
  }
  if (context.opportunity.description) {
    oppLines.push(
      `- What the funder is looking for: ${context.opportunity.description}`,
    );
  }

  const prompt = [
    "# Task",
    `Perform a detailed fit analysis on whether ${orgName} should apply to this opportunity.`,
    "",
    "Consider, and address each explicitly:",
    "1. Historical success rate with similar funders (below).",
    "2. Effort required versus the potential award.",
    "3. Alignment with current programs.",
    "4. Competitive landscape assessment.",
    "5. Strategic value beyond dollars (relationship building, visibility, precedent).",
    "",
    "## Historical track record",
    renderHistory(context.history),
    "",
    "## Opportunity details",
    oppLines.join("\n"),
    "",
    "## Verified organization profile",
    renderOrganization(context.organization),
    "",
    "## Output",
    "Write a structured analysis with a short paragraph per factor above, then end with a line beginning 'Recommendation:' followed by exactly one of: strong apply, apply, conditional apply (state the conditions), or pass — with a one-sentence justification.",
  ].join("\n");

  return { system, prompt };
}
