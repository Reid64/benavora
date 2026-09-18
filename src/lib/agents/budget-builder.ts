// Budget Builder Agent - AGENTS.md Agent 06.
//
// Creates a project budget (structured line items by standard grant category)
// and a budget narrative for a grant application, using ONLY the organization's
// program financial data (BEHAVIORAL_CONTRACTS §9). It calls Claude with the
// budget-narrative prompt, parses the structured result, and records the
// narrative as a note on the application (or the opportunity when no application
// is supplied) so the work is persisted, not just returned.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { buildBudgetNarrativePrompt } from "@/lib/ai/prompts/budget-narrative";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

export interface BudgetBuilderInput {
  opportunityId: string;
  /** Optional application to attach the resulting budget note to. */
  applicationId?: string;
  /** Amount being requested, if already decided. */
  requestedAmount?: number;
}

export interface BudgetLineItem {
  category: string;
  amount: number | null;
  justification: string;
}

export interface BudgetResult {
  opportunityId: string;
  lineItems: BudgetLineItem[];
  totalRequested: number | null;
  narrative: string;
}

export interface BudgetBuilderAgentOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

export class BudgetBuilderAgent extends BaseAgent<
  BudgetBuilderInput,
  BudgetResult
> {
  // p5a-002 (2026-09-15): was "budget_builder", colliding with budget-agent.ts
  // (the live implementation behind /api/ai/budget/route.ts). CORRECTION:
  // this file is NOT dormant — it's dynamically imported by
  // worker/autonomous-orchestrator.ts's routeQueueItem() (case
  // 'budget_builder', dispatched for agent_queue rows), just via `await
  // import(...)` rather than a static top-level import a plain `grep "from"`
  // would catch. Renamed to its own distinct DB enum value (already live) so
  // its agent_queue-driven runs are attributable separately from
  // budget-agent.ts's direct-API-route runs — a real, intended fix, not a
  // precautionary no-op.
  readonly agentType: AgentType = "budget_builder_worker";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: BudgetBuilderAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: BudgetBuilderInput,
  ): Promise<AgentExecution<BudgetResult>> {
    const opportunityId = input.opportunityId;

    this.setPhase("fetching opportunity");
    const { data: opp, error } = await this.client
      .from("opportunities")
      .select(
        "id, name, category, funder_id, eligibility_requirements, amount_min, amount_max",
      )
      .eq("id", opportunityId)
      .eq("organization_id", this.organizationId)
      .single();

    if (error || !opp) {
      throw new AgentError("Opportunity not found.", "not_found", 404);
    }

    this.setPhase("fetching organization, programs, and funder");
    const [orgRes, programsRes, funderRes] = await Promise.all([
      this.client
        .from("organizations")
        .select("name, annual_budget")
        .eq("id", this.organizationId)
        .single(),
      this.client
        .from("programs")
        .select("name, description, budget, beneficiaries_served")
        .eq("organization_id", this.organizationId),
      opp.funder_id
        ? this.client
            .from("funders")
            .select("name")
            .eq("id", opp.funder_id)
            .eq("organization_id", this.organizationId)
            .single()
        : Promise.resolve({ data: null }),
    ]);

    const org = orgRes.data;
    const { system, prompt } = buildBudgetNarrativePrompt({
      organizationName: (org?.name as string | undefined) ?? "the organization",
      annualBudget: (org?.annual_budget as number | null | undefined) ?? null,
      funderName: (funderRes.data?.name as string | null | undefined) ?? null,
      opportunityName: opp.name as string,
      category: opp.category as string,
      requestedAmount: input.requestedAmount ?? null,
      amountMin: (opp.amount_min as number | null) ?? null,
      amountMax: (opp.amount_max as number | null) ?? null,
      budgetRequirements: (opp.eligibility_requirements as string | null) ?? null,
      programs: (programsRes.data ?? []).map((p) => ({
        name: p.name as string,
        description: (p.description as string | null) ?? null,
        budget: (p.budget as number | null) ?? null,
        beneficiariesServed: (p.beneficiaries_served as number | null) ?? null,
      })),
    });

    this.setPhase("calling claude for budget narrative");
    const response = await callClaude({
      system,
      prompt,
      model: this.model,
      maxTokens: this.maxTokens,
    });

    this.setPhase("parsing claude response");
    const parsed = parseBudgetResponse(response.text);

    // Persist the narrative as a note (best effort - a notes failure must not
    // fail the run). Exactly one parent FK, per the notes CHECK constraint.
    const noteContent = formatBudgetNote(parsed);
    if (input.applicationId) {
      await this.client.from("notes").insert({
        organization_id: this.organizationId,
        application_id: input.applicationId,
        content: noteContent,
        author_id: this.triggeredBy,
      });
    } else {
      await this.client.from("notes").insert({
        organization_id: this.organizationId,
        opportunity_id: opportunityId,
        content: noteContent,
        author_id: this.triggeredBy,
      });
    }

    return {
      data: {
        opportunityId,
        lineItems: parsed.lineItems,
        totalRequested: parsed.totalRequested,
        narrative: parsed.narrative,
      },
      outputSummary: `Built a budget for "${opp.name}" (${parsed.lineItems.length} line items).`,
      itemsFound: parsed.lineItems.length,
      itemsProcessed: parsed.lineItems.length,
      tokensUsed: response.usage.totalTokens,
    };
  }
}

// --- formatting --------------------------------------------------------------

function formatCurrency(amount: number | null): string {
  if (amount == null) return "[NEEDS INPUT]";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatBudgetNote(result: {
  lineItems: BudgetLineItem[];
  totalRequested: number | null;
  narrative: string;
}): string {
  const lines = result.lineItems.map(
    (li) => `- ${li.category}: ${formatCurrency(li.amount)} - ${li.justification}`,
  );
  return [
    "**Budget**",
    "",
    ...lines,
    "",
    `**Total requested:** ${formatCurrency(result.totalRequested)}`,
    "",
    "**Budget Narrative**",
    "",
    result.narrative,
  ].join("\n");
}

// --- response parsing --------------------------------------------------------

function toIntOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Parse the budget JSON. Tolerant of stray prose/code fences. Throws AgentError
 * on unreadable output so the run is logged as failed.
 */
export function parseBudgetResponse(text: string): {
  lineItems: BudgetLineItem[];
  totalRequested: number | null;
  narrative: string;
} {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AgentError(
      "The budget model returned an unreadable response.",
      "bad_model_output",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AgentError(
      "The budget model returned malformed JSON.",
      "bad_model_output",
    );
  }

  const obj = (raw ?? {}) as {
    lineItems?: unknown;
    totalRequested?: unknown;
    narrative?: unknown;
  };

  const lineItems: BudgetLineItem[] = Array.isArray(obj.lineItems)
    ? obj.lineItems
        .map((item) => {
          const li = (item ?? {}) as Record<string, unknown>;
          const category =
            typeof li.category === "string" ? li.category.trim() : "";
          if (category === "") return null;
          return {
            category,
            amount: toIntOrNull(li.amount),
            justification:
              typeof li.justification === "string"
                ? li.justification.trim()
                : "",
          } satisfies BudgetLineItem;
        })
        .filter((li): li is BudgetLineItem => li !== null)
    : [];

  const narrative =
    typeof obj.narrative === "string" && obj.narrative.trim() !== ""
      ? obj.narrative.trim()
      : "No budget narrative was provided by the model.";

  return {
    lineItems,
    totalRequested: toIntOrNull(obj.totalRequested),
    narrative,
  };
}
