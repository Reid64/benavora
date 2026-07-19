// AG-06 Budget Builder Agent (AutonomousAgent version) - fires when an
// application moves into the 'drafting' pipeline stage and has no
// budget_data yet, per AGENTS.md Agent 06. Fired via agent_queue with
// agent_id "ag-06-budget-builder" and input_payload
// { applicationId: string } (migration 080 infrastructure: agent_runs,
// agent_decisions, agent_queue).
//
// Distinct from the existing on-demand src/lib/agents/budget-agent.ts
// (BudgetAgent, BaseAgent pattern, per-program, Humanizer pass,
// draft_versions history) and src/lib/agents/budget-builder.ts
// (BudgetBuilderAgent, BaseAgent pattern, notes-only persistence): this is
// the queue-driven AutonomousAgent version scoped exactly as given in this
// build's task prompt - persists structured budget data straight onto the
// application (migration 080: applications.budget_data jsonb, confirmed live
// in src/lib/agents/compliance-check-agent.ts's header notes).
//
// HARD LIMIT: Budget generated for human review only. requiredHumanReview always true.
//
// Deviation notes (checked against real schema, src/types/database.ts,
// rather than applied literally):
//   - "org KB profile (financials section)" = knowledge_base entries with
//     category='budget_justification' (the same convention
//     src/lib/agents/budget-agent.ts already uses for KB-grounded budgets),
//     plus organizations.annual_budget. There is no separate "financials"
//     table or KB category in this schema.
//   - governance/AGENTS.md only documents sections 15-29 (Tier 6 additions)
//     in this repo and explicitly defers 1-14 to a v1 file that does not
//     exist (same gap noted in eligibility-scoring-agent.ts). Built from
//     src/lib/agents/budget-agent.ts's existing "AGENTS.md Agent 06"
//     citation plus the task-given spec.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import { humanizeEnum } from "@/lib/utils/formatters";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule" | "event";

const MAX_TOKENS = 800;

interface BudgetBuilderPayload {
  applicationId: string;
}

interface ApplicationRow {
  id: string;
  opportunity_id: string;
  budget_data: Record<string, unknown> | null;
}

interface OpportunityRow {
  name: string;
  category: string;
  amount_min: number | null;
  amount_max: number | null;
}

interface OrgFinancials {
  name: string;
  annualBudget: number | null;
}

interface KbEntry {
  title: string;
  content: string;
}

interface LineItem {
  category: string;
  description: string;
  amount: number;
  justification: string;
}

interface BudgetResult {
  lineItems: LineItem[];
  total: number;
  narrative: string;
}

function formatCurrency(amount: number | null): string | null {
  if (amount == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildPrompt(
  org: OrgFinancials,
  opp: OpportunityRow,
  kbEntries: KbEntry[],
): { system: string; prompt: string } {
  const system =
    "Create a grant project budget. Use ONLY the provided financial data. " +
    "Never fabricate dollar amounts not in the data. Return JSON: " +
    "{ lineItems: [{category: string, description: string, amount: number, " +
    "justification: string}], total: number, narrative: string }";

  const amountRange = [formatCurrency(opp.amount_min), formatCurrency(opp.amount_max)];
  const oppLines: string[] = [
    `- Opportunity: ${opp.name}`,
    `- Category: ${humanizeEnum(opp.category)}`,
  ];
  if (amountRange[0] || amountRange[1]) {
    oppLines.push(`- Award range: ${amountRange[0] ?? "?"} - ${amountRange[1] ?? "?"}`);
  }

  const orgLines: string[] = [`- Legal name: ${org.name}`];
  if (org.annualBudget != null) {
    orgLines.push(`- Annual operating budget: ${formatCurrency(org.annualBudget)}`);
  }

  const kbBlock =
    kbEntries.length > 0
      ? kbEntries.map((e) => `- ${e.title}: ${e.content}`).join("\n")
      : "No budget justification entries are on file. Flag any figure that " +
        "cannot be grounded in the data above with [NEEDS INPUT: ...].";

  const prompt = [
    "## Opportunity",
    oppLines.join("\n"),
    "",
    "## Organization financials",
    orgLines.join("\n"),
    "",
    "## Knowledge Base - budget justification entries",
    kbBlock,
    "",
    "Build the budget now. Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}

/** Parses the model's JSON reply, tolerant of stray prose/code fences. */
function parseBudgetResponse(text: string): BudgetResult {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The budget model returned an unreadable response.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The budget model returned malformed JSON.");
  }

  const obj = (raw ?? {}) as {
    lineItems?: unknown;
    total?: unknown;
    narrative?: unknown;
  };

  const lineItems: LineItem[] = Array.isArray(obj.lineItems)
    ? obj.lineItems
        .map((item) => {
          const li = (item ?? {}) as Record<string, unknown>;
          const category = typeof li.category === "string" ? li.category.trim() : "";
          if (!category) return null;
          return {
            category,
            description:
              typeof li.description === "string" ? li.description.trim() : "",
            amount: toNumber(li.amount),
            justification:
              typeof li.justification === "string" ? li.justification.trim() : "",
          } satisfies LineItem;
        })
        .filter((li): li is LineItem => li !== null)
    : [];

  const narrative =
    typeof obj.narrative === "string" && obj.narrative.trim() !== ""
      ? obj.narrative.trim()
      : "No budget narrative was provided by the model.";

  const total =
    typeof obj.total === "number" && Number.isFinite(obj.total)
      ? obj.total
      : lineItems.reduce((sum, li) => sum + li.amount, 0);

  return { lineItems, total, narrative };
}

export class BudgetBuilderAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-06-budget-builder", supabase);
  }

  /**
   * Reads the agent_queue row the worker marked "processing" for this
   * org/agent this run - AutonomousAgent has no queue-item id passed into
   * run(), so the currently-processing row is the only way to recover the
   * event payload (mirrors ComplianceCheckAgent.loadPayload).
   */
  private async loadPayload(): Promise<BudgetBuilderPayload | null> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as Partial<BudgetBuilderPayload>;
    if (typeof payload.applicationId !== "string") return null;
    return { applicationId: payload.applicationId };
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];

    try {
      const payload = await this.loadPayload();
      if (!payload) {
        await this.completeRun(runId, {
          outputSummary:
            "No valid budget builder payload found on the currently processing queue item.",
          itemsFound: 0,
          itemsProcessed: 0,
        });
        return {
          success: true,
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      const { applicationId } = payload;

      const { data: appRow, error: appError } = await this.supabase
        .from("applications")
        .select("id, opportunity_id, budget_data")
        .eq("id", applicationId)
        .eq("organization_id", this.orgId)
        .maybeSingle();

      if (appError) {
        throw new Error(`Failed to load application: ${appError.message}`);
      }
      if (!appRow) {
        throw new Error(`Application ${applicationId} not found.`);
      }
      const application = appRow as ApplicationRow;

      if (
        application.budget_data &&
        Object.keys(application.budget_data).length > 0
      ) {
        await this.completeRun(runId, {
          outputSummary: "Application already has budget_data - skipped.",
          itemsFound: 1,
          itemsProcessed: 0,
        });
        return {
          success: true,
          itemsFound: 1,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      const { data: oppRow, error: oppError } = await this.supabase
        .from("opportunities")
        .select("name, category, amount_min, amount_max")
        .eq("id", application.opportunity_id)
        .eq("organization_id", this.orgId)
        .maybeSingle();

      if (oppError) {
        throw new Error(`Failed to load opportunity: ${oppError.message}`);
      }
      if (!oppRow) {
        throw new Error(`Opportunity ${application.opportunity_id} not found.`);
      }
      const opportunity = oppRow as OpportunityRow;

      const [orgRes, kbRes] = await Promise.all([
        this.supabase
          .from("organizations")
          .select("name, annual_budget")
          .eq("id", this.orgId)
          .maybeSingle(),
        this.supabase
          .from("knowledge_base")
          .select("title, content")
          .eq("organization_id", this.orgId)
          .eq("category", "budget_justification"),
      ]);

      const org: OrgFinancials = {
        name: (orgRes.data?.name as string | undefined) ?? "the organization",
        annualBudget: (orgRes.data?.annual_budget as number | null | undefined) ?? null,
      };
      const kbEntries: KbEntry[] = (kbRes.data ?? []).map((e) => ({
        title: e.title as string,
        content: e.content as string,
      }));

      const { system, prompt } = buildPrompt(org, opportunity, kbEntries);

      const response = await callClaude({
        system,
        prompt,
        model: DEFAULT_MODEL,
        maxTokens: MAX_TOKENS,
      });
      const tokensUsed = response.usage.totalTokens;
      const result = parseBudgetResponse(response.text);

      const { error: updateError } = await this.supabase
        .from("applications")
        .update({ budget_data: result })
        .eq("id", applicationId)
        .eq("organization_id", this.orgId);

      if (updateError) {
        throw new Error(`Failed to persist budget_data: ${updateError.message}`);
      }

      decisions.push(
        await this.logDecision({
          decisionType: "budget_generated",
          agentRunId: runId,
          entityType: "application",
          entityId: applicationId,
          reasoning: `Budget generated: ${result.lineItems.length} line items, total $${result.total}.`,
          confidenceScore: 80,
          actionTaken: "budget_data_populated",
          actionPayload: { ...result },
          // HARD LIMIT: budget generated for human review only.
          requiredHumanReview: true,
        }),
      );

      await this.completeRun(runId, {
        outputSummary: `Generated budget for "${opportunity.name}": ${result.lineItems.length} line items, total $${result.total}.`,
        itemsFound: 1,
        itemsProcessed: 1,
        tokensUsed,
      });

      return {
        success: true,
        itemsFound: 1,
        itemsProcessed: 1,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Budget builder run failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
