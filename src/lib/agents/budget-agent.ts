// Budget Agent - dedicated agent for /api/ai/budget (AGENTS.md Agent 06).
//
// Enhanced successor to BudgetBuilderAgent that:
//   - Targets one specific program by programId rather than all org programs.
//   - Incorporates Knowledge Base budget_justification entries for grounding
//     (BEHAVIORAL_CONTRACTS §9 - never invent figures; flag gaps with
//     [NEEDS INPUT: ...]).
//   - Returns budget_table (structured line items) and budget_narrative (prose)
//     as separate fields so the API can surface both independently.
//   - Runs budget_narrative through the AI Humanizer for authentic voice before
//     returning (BLUEPRINT §4.8).
//   - Saves to draft_versions with template_type "budget_narrative" so the
//     version history panel in the Draft Generator tracks budget runs.
//
// Agent_runs logging is handled by BaseAgent.run() - this agent only
// implements execute() (BEHAVIORAL_CONTRACTS §15: agents never fail silently).

import {
  callClaude,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
} from "@/lib/ai/claude";
import {
  buildBudgetDetailPrompt,
  type BudgetDetailKbEntry,
  type BudgetDetailProgramContext,
} from "@/lib/ai/prompts/budget-detail";
import { runHumanizer } from "@/lib/agents/humanizer-agent";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import type {
  BudgetTableItem,
  DraftKnowledgeEntry,
  DraftProvenNarrative,
  KnowledgeSource,
  SavedDraftVersion,
} from "@/types/ai";
import type { Json } from "@/types/database";

export interface BudgetAgentInput {
  opportunityId: string;
  programId: string;
}

export interface BudgetAgentResult {
  opportunityId: string;
  programId: string;
  budgetTable: BudgetTableItem[];
  totalRequested: number | null;
  /** Prose budget narrative, already run through the AI Humanizer. */
  budgetNarrative: string;
  confidenceScore: number;
  sources: KnowledgeSource[];
  savedVersion: SavedDraftVersion | null;
}

export interface BudgetAgentOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

/** Proven narratives supplied as authentic-voice samples (Contracts §9). */
const MAX_VOICE_SAMPLES = 5;

export class BudgetAgent extends BaseAgent<BudgetAgentInput, BudgetAgentResult> {
  readonly agentType: AgentType = "budget_builder";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: BudgetAgentOptions) {
    super(options);
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: BudgetAgentInput,
  ): Promise<AgentExecution<BudgetAgentResult>> {
    const { opportunityId, programId } = input;

    // 1. Fetch opportunity (scoped to org - never trust the input alone).
    const { data: opp, error: oppError } = await this.client
      .from("opportunities")
      .select(
        "id, name, category, funder_id, eligibility_requirements, amount_min, amount_max",
      )
      .eq("id", opportunityId)
      .eq("organization_id", this.organizationId)
      .single();
    if (oppError || !opp) {
      throw new AgentError("Opportunity not found.", "not_found", 404);
    }

    // 2. Fetch the specific program (scoped to org).
    const { data: program, error: programError } = await this.client
      .from("programs")
      .select("id, name, description, budget, beneficiaries_served")
      .eq("id", programId)
      .eq("organization_id", this.organizationId)
      .single();
    if (programError || !program) {
      throw new AgentError("Program not found.", "not_found", 404);
    }

    // 3. Org profile, KB budget_justification entries, funder, and proven
    //    narratives (voice samples for the humanizer) - all in parallel.
    const [orgRes, kbRes, funderRes, provenRes] = await Promise.all([
      this.client
        .from("organizations")
        .select(
          "name, dba, ein, tax_status, mission_statement, vision_statement, service_area, target_population, founder_name, annual_budget",
        )
        .eq("id", this.organizationId)
        .single(),
      this.client
        .from("knowledge_base")
        .select("id, title, content")
        .eq("organization_id", this.organizationId)
        .eq("category", "budget_justification")
        .order("is_proven", { ascending: false })
        .order("updated_at", { ascending: false }),
      opp.funder_id
        ? this.client
            .from("funders")
            .select("name")
            .eq("id", opp.funder_id)
            .eq("organization_id", this.organizationId)
            .single()
        : Promise.resolve({ data: null }),
      this.client
        .from("proven_narratives")
        .select(
          "id, narrative_text, section_type, funder_category, effectiveness_score",
        )
        .eq("organization_id", this.organizationId)
        .eq("funder_category", opp.category)
        .order("effectiveness_score", { ascending: false, nullsFirst: false })
        .limit(MAX_VOICE_SAMPLES),
    ]);

    const org = orgRes.data;
    const funderName =
      (funderRes.data?.name as string | null | undefined) ?? null;

    const kbEntries: BudgetDetailKbEntry[] = (kbRes.data ?? []).map((e) => ({
      id: e.id as string,
      title: e.title as string,
      content: e.content as string,
    }));

    const provenNarratives: DraftProvenNarrative[] = (
      provenRes.data ?? []
    ).map((p) => ({
      id: p.id as string,
      sectionType: (p.section_type as string | null) ?? null,
      funderCategory: (p.funder_category as string | null) ?? null,
      effectivenessScore: (p.effectiveness_score as number | null) ?? null,
      narrativeText: p.narrative_text as string,
    }));

    const programContext: BudgetDetailProgramContext = {
      id: program.id as string,
      name: program.name as string,
      description: (program.description as string | null) ?? null,
      budget: (program.budget as number | null) ?? null,
      beneficiariesServed:
        (program.beneficiaries_served as number | null) ?? null,
    };

    // 4. Build the detailed budget prompt with KB grounding.
    const { system, prompt } = buildBudgetDetailPrompt({
      organizationName:
        (org?.name as string | undefined) ?? "the organization",
      annualBudget: (org?.annual_budget as number | null | undefined) ?? null,
      funderName,
      opportunityName: opp.name as string,
      category: opp.category as string,
      requestedAmount: null,
      amountMin: (opp.amount_min as number | null) ?? null,
      amountMax: (opp.amount_max as number | null) ?? null,
      budgetRequirements:
        (opp.eligibility_requirements as string | null) ?? null,
      program: programContext,
      kbJustificationEntries: kbEntries,
    });

    // 5. Generate the structured budget (first Claude call).
    const budgetResponse = await callClaude({
      system,
      prompt,
      model: this.model,
      maxTokens: this.maxTokens,
    });
    let tokensUsed = budgetResponse.usage.totalTokens;

    const parsed = parseBudgetDetailResponse(budgetResponse.text);

    // 6. Run the narrative through the AI Humanizer (second Claude call).
    //    Failure is non-fatal - fall back to the raw narrative so the budget
    //    table is never lost over a humanizer error.
    const knowledgeEntriesForHumanizer: DraftKnowledgeEntry[] = kbEntries.map(
      (e) => ({
        id: e.id,
        title: e.title,
        category: "budget_justification",
        content: e.content,
      }),
    );

    let budgetNarrative = parsed.budgetNarrative;
    try {
      const humanized = await runHumanizer({
        draft: parsed.budgetNarrative,
        templateType: "budget_narrative",
        organization: org
          ? {
              name: org.name as string,
              dba: (org.dba as string | null) ?? null,
              ein: (org.ein as string | null) ?? null,
              taxStatus: (org.tax_status as string | null) ?? null,
              missionStatement:
                (org.mission_statement as string | null) ?? null,
              visionStatement:
                (org.vision_statement as string | null) ?? null,
              serviceArea: (org.service_area as string | null) ?? null,
              targetPopulation:
                (org.target_population as string | null) ?? null,
              founderName: (org.founder_name as string | null) ?? null,
              annualBudget:
                (org.annual_budget as number | null) ?? null,
            }
          : null,
        knowledgeEntries: knowledgeEntriesForHumanizer,
        provenNarratives,
        model: this.model,
        maxTokens: this.maxTokens,
      });
      budgetNarrative = humanized.content;
      tokensUsed += humanized.tokensUsed;
    } catch (humanizeErr) {
      // Log but do not fail the run - the raw narrative is still useful.
      console.error("BUDGET HUMANIZER ERROR:", humanizeErr);
    }

    // 7. Confidence score (BEHAVIORAL_CONTRACTS §9).
    const confidenceScore = computeBudgetConfidence(
      budgetNarrative,
      kbEntries.length,
      programContext.budget,
    );

    // 8. Transparency panel sources.
    const sources: KnowledgeSource[] = [
      ...kbEntries.map((e) => ({
        id: e.id,
        kind: "knowledge_base" as const,
        title: e.title,
      })),
      ...provenNarratives.map((p) => ({
        id: p.id,
        kind: "proven_narrative" as const,
        title: p.sectionType
          ? `Proven: ${p.sectionType}`
          : "Proven narrative",
      })),
    ];

    // 9. Persist to draft_versions for history (best-effort - a save failure
    //    must never fail the run, BEHAVIORAL_CONTRACTS §15).
    let savedVersion: SavedDraftVersion | null = null;
    {
      const { data: version, error: versionError } = await this.client
        .from("draft_versions")
        .insert({
          organization_id: this.organizationId,
          opportunity_id: opportunityId,
          template_type: "budget_narrative",
          content: budgetNarrative,
          confidence_score: confidenceScore,
          knowledge_sources: sources as unknown as Json,
          humanization_status: "humanized",
          source: "generated",
          created_by: this.triggeredBy,
        })
        .select("id, version_number, created_at")
        .single();
      if (versionError) {
        console.error("BUDGET VERSION SAVE ERROR:", versionError.message);
      } else if (version) {
        savedVersion = {
          id: version.id as string,
          versionNumber: version.version_number as number,
          humanizationStatus: "humanized",
          createdAt: version.created_at as string,
        };
      }
    }

    // 10. Save a note on the opportunity with the full breakdown.
    await this.client.from("notes").insert({
      organization_id: this.organizationId,
      opportunity_id: opportunityId,
      content: formatBudgetNote(
        parsed.budgetTable,
        parsed.totalRequested,
        budgetNarrative,
      ),
      author_id: this.triggeredBy,
    });

    return {
      data: {
        opportunityId,
        programId,
        budgetTable: parsed.budgetTable,
        totalRequested: parsed.totalRequested,
        budgetNarrative,
        confidenceScore,
        sources,
        savedVersion,
      },
      outputSummary: `Built detailed budget for "${opp.name}" - ${parsed.budgetTable.length} line items, confidence ${confidenceScore}.`,
      itemsFound: parsed.budgetTable.length,
      itemsProcessed: parsed.budgetTable.length,
      tokensUsed,
    };
  }
}

// --- confidence (BEHAVIORAL_CONTRACTS §9) -----------------------------------

function computeBudgetConfidence(
  narrative: string,
  kbCount: number,
  programBudget: number | null,
): number {
  const needsInput = (narrative.match(/\[NEEDS INPUT/gi) ?? []).length;

  if (kbCount === 0 && programBudget == null) {
    return Math.max(45, 55 - needsInput * 3);
  }

  let score = 92;
  if (kbCount === 0) score -= 8;
  else if (kbCount < 2) score -= 4;
  if (programBudget == null) score -= 8;
  score -= needsInput * 3;

  return Math.max(0, Math.min(100, score));
}

// --- note formatting --------------------------------------------------------

function formatCurrency(amount: number | null): string {
  if (amount == null) return "[NEEDS INPUT]";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatBudgetNote(
  budgetTable: BudgetTableItem[],
  totalRequested: number | null,
  narrative: string,
): string {
  const lines = budgetTable.map(
    (li) =>
      `- ${li.category}: ${formatCurrency(li.amount)}${li.percentage != null ? ` (${li.percentage.toFixed(1)}%)` : ""} - ${li.justification}`,
  );
  return [
    "**Detailed Budget**",
    "",
    ...lines,
    "",
    `**Total requested:** ${formatCurrency(totalRequested)}`,
    "",
    "**Budget Narrative**",
    "",
    narrative,
  ].join("\n");
}

// --- response parsing -------------------------------------------------------

function toIntOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toFloatOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

/**
 * Parse the structured JSON response from the budget-detail prompt. Tolerant
 * of stray prose and code fences. Throws AgentError on unreadable output so
 * the run is logged as failed (BEHAVIORAL_CONTRACTS §15).
 */
function parseBudgetDetailResponse(text: string): {
  budgetTable: BudgetTableItem[];
  totalRequested: number | null;
  budgetNarrative: string;
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
    budget_table?: unknown;
    total_requested?: unknown;
    budget_narrative?: unknown;
  };

  const budgetTable: BudgetTableItem[] = Array.isArray(obj.budget_table)
    ? obj.budget_table
        .map((item) => {
          const li = (item ?? {}) as Record<string, unknown>;
          const category =
            typeof li.category === "string" ? li.category.trim() : "";
          if (!category) return null;
          return {
            category,
            amount: toIntOrNull(li.amount),
            justification:
              typeof li.justification === "string"
                ? li.justification.trim()
                : "",
            percentage: toFloatOrNull(li.percentage),
          } satisfies BudgetTableItem;
        })
        .filter((li): li is BudgetTableItem => li !== null)
    : [];

  const budgetNarrative =
    typeof obj.budget_narrative === "string" && obj.budget_narrative.trim()
      ? obj.budget_narrative.trim()
      : "No budget narrative was provided by the model.";

  return {
    budgetTable,
    totalRequested: toIntOrNull(obj.total_requested),
    budgetNarrative,
  };
}
