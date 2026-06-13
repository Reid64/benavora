// Budget Detail prompt - enhanced for /api/ai/budget (AGENTS.md Agent 06).
//
// Produces a structured budget table (line items with category, amount,
// justification, percentage) AND a separate prose budget narrative. Unlike
// budget-narrative.ts (used by BudgetBuilderAgent for notes), this prompt:
//   - Targets one specific program by ID rather than all programs.
//   - Incorporates Knowledge Base budget_justification entries as grounding so
//     the model can ground dollar figures in verified org data
//     (BEHAVIORAL_CONTRACTS §9).
//   - Returns budget_table and budget_narrative as separate top-level JSON
//     fields so the API can surface both independently.

import { humanizeEnum } from "@/lib/utils/formatters";

export interface BudgetDetailKbEntry {
  id: string;
  title: string;
  content: string;
}

export interface BudgetDetailProgramContext {
  id: string;
  name: string;
  description: string | null;
  budget: number | null;
  beneficiariesServed: number | null;
}

export interface BudgetDetailContext {
  organizationName: string;
  annualBudget: number | null;
  funderName: string | null;
  opportunityName: string;
  category: string;
  requestedAmount: number | null;
  amountMin: number | null;
  amountMax: number | null;
  /** Funder budget requirements / restrictions, if any. */
  budgetRequirements: string | null;
  program: BudgetDetailProgramContext;
  /** budget_justification KB entries - additional grounding for line items. */
  kbJustificationEntries: BudgetDetailKbEntry[];
}

export interface BudgetDetailPrompt {
  system: string;
  prompt: string;
}

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

function renderProgram(program: BudgetDetailProgramContext): string {
  const lines = [`### ${program.name}`];
  if (program.description) lines.push(program.description.trim());
  const budget = formatCurrency(program.budget);
  if (budget) lines.push(`- Program budget: ${budget}`);
  if (program.beneficiariesServed != null) {
    lines.push(`- Beneficiaries served: ${program.beneficiariesServed}`);
  }
  if (!budget && program.beneficiariesServed == null) {
    lines.push(
      "No financial data on file. Flag every line item you need with [NEEDS INPUT: ...] and do not invent amounts.",
    );
  }
  return lines.join("\n");
}

function renderKbEntries(entries: BudgetDetailKbEntry[]): string {
  if (entries.length === 0) {
    return "No budget justification entries are in the Knowledge Base. Apply the [NEEDS INPUT: ...] convention to every figure you cannot source from the program data above.";
  }
  return entries
    .map((e) => `### ${e.title}\n${e.content.trim()}`)
    .join("\n\n");
}

/**
 * Build the budget detail prompt. The model returns a single JSON object with
 * `budget_table` (line items) and `budget_narrative` (prose) as separate fields,
 * so the API can surface both without post-processing.
 */
export function buildBudgetDetailPrompt(
  context: BudgetDetailContext,
): BudgetDetailPrompt {
  const outputShape = JSON.stringify({
    budget_table: [
      {
        category:
          "<one of: personnel, supplies, equipment, travel, contractual, other, indirect>",
        amount: "<integer USD or null>",
        justification:
          "<one sentence tying this cost to the program's activities>",
        percentage: "<float - amount / total_requested * 100, or null>",
      },
    ],
    total_requested: "<integer USD or null>",
    budget_narrative:
      "<prose narrative justifying the budget as a whole, 3-5 paragraphs>",
  });

  const system = [
    `You are a nonprofit budget specialist preparing a detailed grant budget for ${context.organizationName}.`,
    "",
    "ABSOLUTE RULES:",
    "1. Use ONLY the financial figures in Program Data and Knowledge Base entries below. Never invent amounts, salaries, or costs.",
    "2. Where a line item needs a figure you were not given, set its amount to null and add [NEEDS INPUT: <what is missing>] in its justification. Do not guess.",
    `3. Use these exact budget categories: ${BUDGET_CATEGORIES.join(", ")}. Omit a category only when it genuinely does not apply.`,
    "4. Amounts are plain integers in US dollars (no symbols, no commas). Percentages are floats rounded to one decimal place.",
    "5. budget_narrative is 3-5 paragraphs of polished prose justifying the full budget against the program's activities and the funder's priorities. Tie each major cost category to a programmatic need.",
    "6. Do NOT repeat line-item justifications verbatim in the narrative. The narrative synthesizes and expands; the table itemizes.",
    "7. Respond with ONLY a single JSON object in exactly this shape (no prose, no code fences):",
    outputShape,
  ].join("\n");

  const oppLines = [
    `- Opportunity: ${context.opportunityName}`,
    `- Funder: ${context.funderName ?? "Unspecified funder"}`,
    `- Category: ${humanizeEnum(context.category)}`,
  ];
  const requested = formatCurrency(context.requestedAmount);
  if (requested) oppLines.push(`- Amount being requested: ${requested}`);
  const amountMin = formatCurrency(context.amountMin);
  const amountMax = formatCurrency(context.amountMax);
  if (amountMin || amountMax) {
    oppLines.push(`- Award range: ${amountMin ?? "?"} - ${amountMax ?? "?"}`);
  }
  const annual = formatCurrency(context.annualBudget);
  if (annual) oppLines.push(`- Organization annual budget: ${annual}`);
  if (context.budgetRequirements) {
    oppLines.push(
      `- Funder budget requirements: ${context.budgetRequirements}`,
    );
  }

  const target =
    requested ??
    (amountMax ? `up to ${amountMax}` : "the appropriate amount");

  const prompt = [
    "# Task",
    `Build a detailed project budget and budget narrative for ${context.organizationName} requesting ${target} from ${context.funderName ?? "this funder"}.`,
    "Break the budget into line items by standard federal grant category, justify each against the program's actual activities, and write a narrative that ties the full budget to programmatic need and funder priorities.",
    "",
    "## Opportunity details",
    oppLines.join("\n"),
    "",
    "## Program data (the only financial figures you may use for line items)",
    renderProgram(context.program),
    "",
    "## Knowledge Base - budget justification entries (additional grounding)",
    renderKbEntries(context.kbJustificationEntries),
    "",
    "## Output",
    "Return ONLY the JSON object described above. The narrative should read like it was written by an experienced grant writer.",
  ].join("\n");

  return { system, prompt };
}
