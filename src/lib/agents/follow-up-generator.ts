// Follow-Up Generator Agent (AGENTS.md Agent 28, BEHAVIORAL_CONTRACTS §28).
//
// After a grant application is submitted, this agent generates a 3-step
// humanized follow-up email sequence: thank-you (day 1), check-in (day 14),
// and status request (day 30). Each email is processed through the Humanizer
// to read like authentic human writing. The sequence is stored as a note on
// the application so it persists without requiring a new table.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { runHumanizer } from "@/lib/agents/humanizer-agent";
import {
  AgentError,
  BaseAgent,
  causeOf,
  withCause,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import {
  FOLLOW_UP_NOTE_PREFIX,
  type FollowUpStep,
  type FollowUpStepType,
  type FollowUpStoredPayload,
} from "@/lib/agents/follow-up-types";

export { FOLLOW_UP_NOTE_PREFIX };
export type { FollowUpStep, FollowUpStepType, FollowUpStoredPayload };

export interface FollowUpInput {
  applicationId: string;
}

export interface FollowUpResult {
  applicationId: string;
  opportunityName: string;
  funderName: string;
  steps: FollowUpStep[];
  noteId: string | null;
}

export interface FollowUpGeneratorOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

export class FollowUpGeneratorAgent extends BaseAgent<
  FollowUpInput,
  FollowUpResult
> {
  readonly agentType: AgentType = "follow_up_generator";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: FollowUpGeneratorOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_MULTI_STEP_MS });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: FollowUpInput,
  ): Promise<AgentExecution<FollowUpResult>> {
    const { applicationId } = input;

    // 1. Load application
    const { data: appData, error: appError } = await this.client
      .from("applications")
      .select("id, opportunity_id, requested_amount")
      .eq("id", applicationId)
      .eq("organization_id", this.organizationId)
      .single();

    if (appError) {
      console.error(
        `[FollowUpGeneratorAgent.execute] failed to load application ${applicationId}: ${causeOf(appError)}`,
      );
      throw new AgentError(
        withCause("Failed to load application.", appError),
        "db_error",
      );
    }
    if (!appData) {
      throw new AgentError("Application not found.", "not_found", 404);
    }

    // 2. Load opportunity
    const { data: oppData, error: oppError } = await this.client
      .from("opportunities")
      .select("id, name, funder_id, deadline")
      .eq("id", appData.opportunity_id as string)
      .single();

    if (oppError) {
      console.error(
        `[FollowUpGeneratorAgent.execute] failed to load opportunity ${appData.opportunity_id as string}: ${causeOf(oppError)}`,
      );
      throw new AgentError(
        withCause("Failed to load opportunity.", oppError),
        "db_error",
      );
    }
    if (!oppData) {
      throw new AgentError("Opportunity not found.", "not_found", 404);
    }

    // 3. Load funder name (optional)
    let funderName = "the funder";
    const funderId = oppData.funder_id as string | null;
    if (funderId) {
      const { data: funderData } = await this.client
        .from("funders")
        .select("name")
        .eq("id", funderId)
        .single();
      funderName = (funderData?.name as string | null) ?? "the funder";
    }

    // 4. Load org for humanizer context
    const { data: orgData } = await this.client
      .from("organizations")
      .select(
        "name, dba, ein, tax_status, mission_statement, vision_statement, service_area, target_population, founder_name, annual_budget",
      )
      .eq("id", this.organizationId)
      .single();

    const orgName = (orgData?.name as string | null) ?? "our organization";
    const opportunityName = (oppData.name as string | null) ?? "the grant";

    // 5. Generate the 3-step email sequence via Claude
    const seqPrompt = buildSequencePrompt({
      orgName,
      opportunityName,
      funderName,
      requestedAmount: (appData.requested_amount as number | null) ?? null,
      deadline: (oppData.deadline as string | null) ?? null,
    });

    const seqResponse = await callClaude({
      system: seqPrompt.system,
      prompt: seqPrompt.prompt,
      model: this.model,
      maxTokens: this.maxTokens,
    });

    const rawSteps = parseSequenceResponse(seqResponse.text);
    let tokensUsed = seqResponse.usage.totalTokens;

    // 6. Build humanizer org context
    const orgContext = orgData
      ? {
          name: orgName,
          dba: (orgData.dba as string | null) ?? null,
          ein: (orgData.ein as string | null) ?? null,
          taxStatus: (orgData.tax_status as string | null) ?? null,
          missionStatement:
            (orgData.mission_statement as string | null) ?? null,
          visionStatement:
            (orgData.vision_statement as string | null) ?? null,
          serviceArea: (orgData.service_area as string | null) ?? null,
          targetPopulation:
            (orgData.target_population as string | null) ?? null,
          founderName: (orgData.founder_name as string | null) ?? null,
          annualBudget: (orgData.annual_budget as number | null) ?? null,
        }
      : null;

    // 7. Humanize each email body
    const steps: FollowUpStep[] = [];
    for (const raw of rawSteps) {
      const draft =
        raw.body.trim() !== ""
          ? raw.body
          : `Dear ${funderName},\n\nThank you for the opportunity to submit this application.\n\nBest regards,\n${orgName}`;

      const humanized = await runHumanizer({
        draft,
        templateType: "donation_request_letter",
        organization: orgContext,
        knowledgeEntries: [],
        provenNarratives: [],
        model: this.model,
        maxTokens: 2048,
      });

      tokensUsed += humanized.tokensUsed;

      steps.push({
        stepNumber: raw.stepNumber,
        type: raw.type,
        delayDays: raw.delayDays,
        subject: raw.subject,
        body: humanized.content,
        humanizationScore: humanized.humanizationScore,
      });
    }

    // 8. Persist as a note on the application (follow_up_sequences table does
    //    not exist in the database types, so we use the notes table with a
    //    typed prefix to allow UI filtering).
    const payload: FollowUpStoredPayload = {
      generatedAt: new Date().toISOString(),
      opportunityName,
      funderName,
      steps,
    };
    const noteContent = FOLLOW_UP_NOTE_PREFIX + JSON.stringify(payload);

    const { data: noteData } = await this.client
      .from("notes")
      .insert({
        organization_id: this.organizationId,
        application_id: applicationId,
        content: noteContent,
        author_id: this.triggeredBy,
      })
      .select("id")
      .single();

    const noteId = (noteData?.id as string | undefined) ?? null;

    return {
      data: {
        applicationId,
        opportunityName,
        funderName,
        steps,
        noteId,
      },
      outputSummary: `Generated ${steps.length}-step follow-up sequence for "${opportunityName}" (${funderName}).`,
      itemsFound: 3,
      itemsProcessed: steps.length,
      tokensUsed,
    };
  }
}

// --- prompt ------------------------------------------------------------------

interface SequenceContext {
  orgName: string;
  opportunityName: string;
  funderName: string;
  requestedAmount: number | null;
  deadline: string | null;
}

function buildSequencePrompt(ctx: SequenceContext): {
  system: string;
  prompt: string;
} {
  const system = [
    "You are an experienced nonprofit grant writer composing follow-up emails after a grant application has been submitted.",
    "",
    "Generate exactly 3 follow-up email drafts. Each should be professional, warm, and concise.",
    "",
    "Return ONLY a JSON array with exactly 3 objects in this exact shape:",
    '[{"step":1,"type":"thank_you","delay_days":1,"subject":"<subject>","body":"<email body>"},',
    ' {"step":2,"type":"check_in","delay_days":14,"subject":"<subject>","body":"<email body>"},',
    ' {"step":3,"type":"status_request","delay_days":30,"subject":"<subject>","body":"<email body>"}]',
    "",
    "Email content rules:",
    "- Step 1 (day 1, thank_you): Thank the funder for the opportunity. Reiterate mission alignment. 3 short paragraphs max.",
    "- Step 2 (day 14, check_in): Confirm the application was received and offer to answer questions. 2-3 paragraphs.",
    "- Step 3 (day 30, status_request): Politely ask about the review timeline and offer any additional information needed. 2-3 paragraphs.",
    "",
    "Writing rules: no em dashes, no AI vocabulary (furthermore, leverage, robust, comprehensive, etc.), plain authentic prose.",
    "Sign off with the organization name. Never invent facts not explicitly provided.",
  ].join("\n");

  const lines: string[] = [
    `Organization: ${ctx.orgName}`,
    `Grant/Opportunity: ${ctx.opportunityName}`,
    `Funder: ${ctx.funderName}`,
  ];
  if (ctx.requestedAmount !== null) {
    lines.push(
      `Amount requested: $${ctx.requestedAmount.toLocaleString("en-US")}`,
    );
  }
  if (ctx.deadline) {
    lines.push(`Application deadline: ${ctx.deadline}`);
  }
  lines.push("", "Return ONLY the JSON array.");

  return { system, prompt: lines.join("\n") };
}

// --- response parsing --------------------------------------------------------

type StepType = "thank_you" | "check_in" | "status_request";
const VALID_STEP_TYPES = new Set<string>([
  "thank_you",
  "check_in",
  "status_request",
]);

const STEP_DEFAULTS: Array<{
  stepNumber: number;
  type: StepType;
  delayDays: number;
}> = [
  { stepNumber: 1, type: "thank_you", delayDays: 1 },
  { stepNumber: 2, type: "check_in", delayDays: 14 },
  { stepNumber: 3, type: "status_request", delayDays: 30 },
];

function parseSequenceResponse(text: string): Array<{
  stepNumber: number;
  type: StepType;
  delayDays: number;
  subject: string;
  body: string;
}> {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new AgentError(
      "Follow-up model returned an unreadable response.",
      "bad_model_output",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AgentError(
      "Follow-up model returned malformed JSON.",
      "bad_model_output",
    );
  }

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AgentError(
      "Follow-up model returned an empty sequence.",
      "bad_model_output",
    );
  }

  return raw.slice(0, 3).map((item: unknown, idx: number) => {
    const obj =
      item !== null && typeof item === "object"
        ? (item as Record<string, unknown>)
        : ({} as Record<string, unknown>);

    const fallback = STEP_DEFAULTS[idx] ?? {
      stepNumber: idx + 1,
      type: "thank_you" as StepType,
      delayDays: 1,
    };

    const rawType = typeof obj.type === "string" ? obj.type : "";
    const type: StepType = VALID_STEP_TYPES.has(rawType)
      ? (rawType as StepType)
      : fallback.type;

    return {
      stepNumber:
        typeof obj.step === "number" ? obj.step : fallback.stepNumber,
      type,
      delayDays:
        typeof obj.delay_days === "number" && obj.delay_days >= 0
          ? obj.delay_days
          : fallback.delayDays,
      subject:
        typeof obj.subject === "string" && obj.subject.trim() !== ""
          ? obj.subject.trim()
          : `Follow-Up Step ${fallback.stepNumber}`,
      body:
        typeof obj.body === "string" && obj.body.trim() !== ""
          ? obj.body.trim()
          : "",
    };
  });
}
