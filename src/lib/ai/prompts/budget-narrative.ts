// Budget Narrative prompt template - AGENTS.md Agent 06 (Budget Builder).
//
// Builds the system + user prompt that produces both a structured project budget
// (line items by standard grant category) and a prose budget narrative
// justifying each line against the program's activities and the funder's
// priorities. The model uses ONLY the supplied financial data and never
// fabricates figures (BEHAVIORAL_CONTRACTS §9); where a number is missing it
// marks the line with a [NEEDS INPUT: ...] note rather than inventing one.

import { humanizeEnum } from "@/lib/utils/formatters";

/** A program whose costs the budget is built around. */
export interface BudgetProgramContext {
  name: string;
  description: string | null;
  budget: number | null;
  beneficiariesServed: number | null;
}

export interface BudgetNarrativeContext {
  organizationName: string;
  /** Organization annual budget, for scale/appropriateness context. */
  annualBudget: number | null;
  funderName: string | null;
  opportunityName: string;
  category: string;
  /** Amount the application is requesting, if decided. */
  requestedAmount: number | null;
  amountMin: number | null;
  amountMax: number | null;
  /** Funder budget instructions / requirements, if any. */
  budgetRequirements: string | null;
  programs: BudgetProgramContext[];
}

export interface BudgetNarrativePrompt {
  system: string;
  prompt: string;
}

/** Standard federal-style budget categories (AGENTS.md Agent 06). */
export const BUDGET_CATEGORIES = [
  "personnel",
  "supplies",
  "equipment",
  "travel",
  "contractual",
  "other",
  "indirect",
] as const;

function formatCurrency(amount: number | null): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function renderPrograms(programs: BudgetProgramContext[]): string {
  if (programs.length === 0) {
    return "No program financial data is available. Flag every figure you would need with [NEEDS INPUT: ...] and do not invent amounts.";
  }
  return programs
    .map((p) => {
      const lines = [`### ${p.name}`];
      if (p.description) lines.push(p.description.trim());
      const budget = formatCurrency(p.budget);
      if (budget) lines.push(`- Program budget: ${budget}`);
      if (p.beneficiariesServed != null) {
        lines.push(`- Beneficiaries served: ${p.beneficiariesServed}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * Build the budget prompt. The model returns a single JSON object carrying the
 * structured line items plus the prose narrative, so the agent can persist or
 * surface both.
 */
export function buildBudgetNarrativePrompt(
  context: BudgetNarrativeContext,
): BudgetNarrativePrompt {
  const system = [
    `You are a nonprofit budget specialist preparing a grant budget for ${context.organizationName}.`,
    "",
    "RULES:",
    "1. Use ONLY the financial data provided below. Never fabricate amounts, salaries, or costs.",
    "2. Where a line item needs a figure you were not given, set its amount to null and put a [NEEDS INPUT: ...] note in its justification. Do not guess.",
    `3. Use these budget categories exactly: ${BUDGET_CATEGORIES.join(", ")}. Omit a category only if it is irrelevant.`,
    "4. Amounts are plain integers in US dollars (no symbols or commas).",
    "5. Respond with ONLY a single JSON object, no prose and no code fences, in exactly this shape:",
    JSON.stringify({
      lineItems: [
        {
          category: "<one of the budget categories>",
          amount: "<integer or null>",
          justification: "<one sentence tying the cost to program activities>",
        },
      ],
      totalRequested: "<integer or null>",
      narrative: "<prose budget narrative justifying the budget as a whole>",
    }),
  ].join("\n");

  const amountRange = [
    formatCurrency(context.amountMin),
    formatCurrency(context.amountMax),
  ];

  const oppLines: string[] = [
    `- Opportunity: ${context.opportunityName}`,
    `- Funder: ${context.funderName ?? "Unspecified funder"}`,
    `- Category: ${humanizeEnum(context.category)}`,
  ];
  const requested = formatCurrency(context.requestedAmount);
  if (requested) oppLines.push(`- Amount being requested: ${requested}`);
  if (amountRange[0] || amountRange[1]) {
    oppLines.push(`- Award range: ${amountRange[0] ?? "?"} - ${amountRange[1] ?? "?"}`);
  }
  const annual = formatCurrency(context.annualBudget);
  if (annual) oppLines.push(`- Organization annual budget: ${annual}`);
  if (context.budgetRequirements) {
    oppLines.push(`- Funder budget requirements: ${context.budgetRequirements}`);
  }

  const target =
    requested ??
    (amountRange[1] ? `up to ${amountRange[1]}` : "the appropriate amount");

  const prompt = [
    "# Task",
    `Create a project budget and budget narrative for ${context.organizationName} requesting ${target} from ${context.funderName ?? "this funder"}.`,
    "Break the budget into line items by category, justify each, and write a narrative tying the whole budget to the program's activities and the funder's priorities.",
    "",
    "## Opportunity details",
    oppLines.join("\n"),
    "",
    "## Program financial data (the only figures you may use)",
    renderPrograms(context.programs),
    "",
    "## Output",
    "Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}
