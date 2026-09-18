// Application Cloning Agent - AGENTS.md Agent 26.
//
// Clones an existing (ideally awarded) application to a new target opportunity.
// Copies draft_content, draft_template_type, and linked application_documents,
// then adapts the draft via Claude to fit the target funder and opportunity.
// Creates the new application in 'discovered' stage with a pipeline_history entry.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  withCause,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import type { Database } from "@/types/database";

export interface ApplicationClonerInput {
  sourceApplicationId: string;
  targetOpportunityId: string;
}

type PipelineStage = Database["public"]["Enums"]["pipeline_stage"];
type DraftTemplateType = Database["public"]["Enums"]["draft_template_type"];

export interface ApplicationClonerResult {
  newApplicationId: string;
  opportunityName: string;
  draftAdapted: boolean;
  documentsLinked: number;
}

export interface ApplicationClonerOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

export class ApplicationClonerAgent extends BaseAgent<
  ApplicationClonerInput,
  ApplicationClonerResult
> {
  readonly agentType: AgentType = "application_cloning";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: ApplicationClonerOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: ApplicationClonerInput,
  ): Promise<AgentExecution<ApplicationClonerResult>> {
    // --- 1. Load source application (org-scoped) ---
    const { data: source, error: srcErr } = await this.client
      .from("applications")
      .select(
        "id, opportunity_id, draft_content, draft_template_type, requested_amount",
      )
      .eq("id", input.sourceApplicationId)
      .eq("organization_id", this.organizationId)
      .single();

    if (srcErr || !source) {
      throw new AgentError("Source application not found.", "not_found", 404);
    }

    // --- 2. Load target opportunity ---
    const { data: targetOpp, error: oppErr } = await this.client
      .from("opportunities")
      .select(
        "id, name, description, eligibility_requirements, amount_min, amount_max, amount_available, deadline, geographic_restrictions",
      )
      .eq("id", input.targetOpportunityId)
      .eq("organization_id", this.organizationId)
      .single();

    if (oppErr || !targetOpp) {
      throw new AgentError("Target opportunity not found.", "not_found", 404);
    }

    // --- 3. Load source opportunity name for context ---
    const { data: sourceOpp } = await this.client
      .from("opportunities")
      .select("name, description")
      .eq("id", source.opportunity_id)
      .eq("organization_id", this.organizationId)
      .maybeSingle();

    // --- 4. Adapt draft via Claude if a draft exists ---
    let adaptedDraft: string | null = source.draft_content as string | null;
    let tokensUsed = 0;
    const hasDraft =
      typeof source.draft_content === "string" &&
      source.draft_content.trim() !== "";

    if (hasDraft) {
      const sourceOppName = (sourceOpp?.name as string | null) ?? "unknown";
      const targetName = targetOpp.name as string;
      const targetDesc =
        (targetOpp.description as string | null) ?? "No description provided.";
      const targetEligibility =
        (targetOpp.eligibility_requirements as string | null) ??
        "Not specified.";
      const targetAmount = formatAmount(targetOpp);
      const targetDeadline =
        (targetOpp.deadline as string | null) ?? "No deadline specified.";
      const targetGeo =
        (targetOpp.geographic_restrictions as string | null) ?? "Not specified.";

      const prompt = `You are adapting a grant application draft that was written for one funder to suit a different funder and opportunity. Preserve the winning structure, persuasive language, and narrative arc. Update only what must change: funder-specific references, dollar amounts, geographic language, program emphasis, and eligibility claims.

ORIGINAL APPLICATION (for: ${sourceOppName}):
${source.draft_content as string}

TARGET OPPORTUNITY:
Name: ${targetName}
Description: ${targetDesc}
Eligibility: ${targetEligibility}
Funding amount: ${targetAmount}
Deadline: ${targetDeadline}
Geographic focus: ${targetGeo}

Return ONLY the adapted grant application text. Do not include any explanation or preamble.`;

      const response = await callClaude({
        prompt,
        model: this.model,
        maxTokens: this.maxTokens,
      });

      adaptedDraft = response.text.trim();
      tokensUsed = response.usage.totalTokens;
    }

    // --- 5. Create new application in 'discovered' stage ---
    const { data: newApp, error: insertErr } = await this.client
      .from("applications")
      .insert({
        organization_id: this.organizationId,
        opportunity_id: input.targetOpportunityId,
        stage: "discovered" as PipelineStage,
        draft_content: adaptedDraft,
        draft_template_type:
          (source.draft_template_type as DraftTemplateType | null) ?? null,
        requested_amount:
          (source.requested_amount as number | null) ?? null,
        assigned_user_id: this.triggeredBy ?? null,
      })
      .select("id")
      .single();

    if (insertErr || !newApp) {
      throw new AgentError(
        withCause("Failed to create the cloned application.", insertErr),
        "write_failed",
      );
    }

    const newApplicationId = newApp.id as string;

    // --- 6. Create pipeline_history entry ---
    await this.client.from("pipeline_history").insert({
      organization_id: this.organizationId,
      application_id: newApplicationId,
      from_stage: null,
      to_stage: "discovered" as PipelineStage,
      changed_by: this.triggeredBy ?? null,
      notes: `Cloned from application ${input.sourceApplicationId}`,
    });

    // --- 7. Copy linked documents (best-effort; don't fail the run) ---
    const { data: srcDocs } = await this.client
      .from("application_documents")
      .select("document_id")
      .eq("application_id", input.sourceApplicationId);

    let documentsLinked = 0;
    if (srcDocs && srcDocs.length > 0) {
      const docInserts = srcDocs.map((d) => ({
        application_id: newApplicationId,
        document_id: d.document_id as string,
      }));
      const { error: docErr } = await this.client
        .from("application_documents")
        .insert(docInserts);
      if (!docErr) {
        documentsLinked = srcDocs.length;
      }
    }

    const opportunityName = targetOpp.name as string;

    return {
      data: {
        newApplicationId,
        opportunityName,
        draftAdapted: hasDraft,
        documentsLinked,
      },
      outputSummary: `Cloned application to "${opportunityName}". Draft ${hasDraft ? "adapted" : "not available"}. ${documentsLinked} document(s) linked.`,
      itemsFound: 1,
      itemsProcessed: 1,
      tokensUsed,
    };
  }
}

// --- helpers ------------------------------------------------------------------

function formatAmount(opp: {
  amount_available: unknown;
  amount_min: unknown;
  amount_max: unknown;
}): string {
  const avail = opp.amount_available;
  if (typeof avail === "number" && avail > 0) return `$${avail.toLocaleString()}`;
  const min = opp.amount_min;
  const max = opp.amount_max;
  if (typeof min === "number" && typeof max === "number")
    return `$${min.toLocaleString()} – $${max.toLocaleString()}`;
  if (typeof max === "number") return `Up to $${max.toLocaleString()}`;
  return "Not specified";
}
