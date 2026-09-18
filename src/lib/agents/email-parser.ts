// Email Parser Agent - classifies inbound emails, extracts structured
// metadata, matches funders, and logs to email_activity.
//
// Phase 3: processes email data passed to it directly. Phase 4 will wire in
// actual Gmail API integration (AGENTS.md Agent 17 family).
//
// For each email the agent:
//   1. Calls Claude to classify the email type and extract metadata.
//   2. Attempts a case-insensitive name match against the org's funders table.
//   3. If matched, appends a summary note to funders.notes.
//   4. If award_notification or rejection, sets action_required and flags for
//      outcome recording in the email_activity summary.
//   5. Inserts an email_activity row.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  causeOf,
  withCause,
  type AgentExecution,
  type BaseAgentOptions,
  AGENT_TIMEOUT_CLAUDE_CALL_MS,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

export type EmailType =
  | "acknowledgment"
  | "information_request"
  | "award_notification"
  | "rejection"
  | "follow_up"
  | "general";

export type EmailUrgency = "low" | "medium" | "high";
export type EmailSentiment = "positive" | "neutral" | "negative";

export interface EmailInput {
  from: string;
  to?: string | null;
  subject: string;
  body: string;
  date?: string | null;
  thread_id?: string | null;
}

export interface EmailParserInput {
  emails: EmailInput[];
}

export interface ParsedEmailResult {
  emailIndex: number;
  from: string;
  subject: string;
  emailType: EmailType;
  funderName: string | null;
  matchedFunderId: string | null;
  matchedFunderName: string | null;
  opportunityReference: string | null;
  actionRequired: boolean;
  actionDescription: string | null;
  urgency: EmailUrgency;
  sentiment: EmailSentiment;
  flaggedForOutcomeRecording: boolean;
  emailActivityId: string;
}

export interface EmailParserResult {
  processed: number;
  results: ParsedEmailResult[];
}

export interface EmailParserOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

/** Raw shape the model returns for one email. */
interface ClassifiedEmail {
  type: string;
  funder_name: string | null;
  opportunity_reference: string | null;
  action_required: boolean;
  action_description: string | null;
  urgency: string;
  sentiment: string;
}

const OUTCOME_TYPES = new Set<EmailType>(["award_notification", "rejection"]);

export class EmailParserAgent extends BaseAgent<
  EmailParserInput,
  EmailParserResult
> {
  readonly agentType: AgentType = "email_parser";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: EmailParserOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? AGENT_TIMEOUT_CLAUDE_CALL_MS });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: EmailParserInput,
  ): Promise<AgentExecution<EmailParserResult>> {
    const { emails } = input;

    if (!Array.isArray(emails) || emails.length === 0) {
      throw new AgentError(
        "emails must be a non-empty array.",
        "invalid_input",
        400,
      );
    }

    let totalTokens = 0;
    const results: ParsedEmailResult[] = [];

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i]!;
      const classified = await this.classifyEmail(email);
      totalTokens += classified.tokens;

      const { matchedFunderId, matchedFunderName } =
        await this.matchFunder(classified.data.funder_name);

      const emailType = normalizeEmailType(classified.data.type);
      const urgency = normalizeUrgency(classified.data.urgency);
      const sentiment = normalizeSentiment(classified.data.sentiment);
      const actionRequired = classified.data.action_required;
      const actionDescription = classified.data.action_description;
      const flaggedForOutcomeRecording = OUTCOME_TYPES.has(emailType);

      // Build summary for the email_activity row and optional funder note.
      const summary = buildSummary(email, emailType, classified.data);

      // If matched, append a brief note to the funder record (best-effort).
      if (matchedFunderId) {
        await this.appendFunderNote(matchedFunderId, email, summary);
      }

      // Insert the email_activity record.
      const activityId = await this.insertEmailActivity({
        email,
        emailType,
        summary,
        actionRequired: actionRequired || flaggedForOutcomeRecording,
        actionDescription: flaggedForOutcomeRecording
          ? `Flagged for outcome recording: ${emailType.replace("_", " ")}. ${actionDescription ?? ""}`.trim()
          : actionDescription,
        urgency,
        matchedFunderId,
      });

      results.push({
        emailIndex: i,
        from: email.from,
        subject: email.subject,
        emailType,
        funderName: classified.data.funder_name,
        matchedFunderId,
        matchedFunderName,
        opportunityReference: classified.data.opportunity_reference,
        actionRequired: actionRequired || flaggedForOutcomeRecording,
        actionDescription: classified.data.action_description,
        urgency,
        sentiment,
        flaggedForOutcomeRecording,
        emailActivityId: activityId,
      });
    }

    const flagged = results.filter((r) => r.flaggedForOutcomeRecording).length;
    const matched = results.filter((r) => r.matchedFunderId !== null).length;

    return {
      data: { processed: results.length, results },
      outputSummary: `Parsed ${results.length} email${results.length === 1 ? "" : "s"}. ${matched} funder match${matched === 1 ? "" : "es"}. ${flagged} flagged for outcome recording.`,
      itemsFound: results.length,
      itemsProcessed: results.length,
      tokensUsed: totalTokens,
    };
  }

  // --- Claude classification --------------------------------------------------

  private async classifyEmail(
    email: EmailInput,
  ): Promise<{ data: ClassifiedEmail; tokens: number }> {
    const { system, prompt } = buildClassificationPrompt(email);

    const response = await callClaude({
      system,
      prompt,
      model: this.model,
      maxTokens: 512,
    });

    const data = parseClassificationResponse(response.text);
    return { data, tokens: response.usage.totalTokens };
  }

  // --- Funder matching --------------------------------------------------------

  private async matchFunder(
    funderName: string | null,
  ): Promise<{ matchedFunderId: string | null; matchedFunderName: string | null }> {
    if (!funderName || funderName.trim() === "") {
      return { matchedFunderId: null, matchedFunderName: null };
    }

    const { data } = await this.client
      .from("funders")
      .select("id, name")
      .eq("organization_id", this.organizationId)
      .ilike("name", `%${funderName.trim()}%`)
      .limit(1)
      .maybeSingle();

    if (!data) return { matchedFunderId: null, matchedFunderName: null };

    return {
      matchedFunderId: data.id as string,
      matchedFunderName: data.name as string,
    };
  }

  // --- Funder note ------------------------------------------------------------

  private async appendFunderNote(
    funderId: string,
    email: EmailInput,
    summary: string,
  ): Promise<void> {
    const { data: funder } = await this.client
      .from("funders")
      .select("notes")
      .eq("id", funderId)
      .eq("organization_id", this.organizationId)
      .single();

    const timestamp = new Date().toISOString().slice(0, 10);
    const noteEntry = `[${timestamp}] Email from ${email.from} - "${email.subject}": ${summary}`;
    const existing = (funder?.notes as string | null) ?? "";
    const updated = existing
      ? `${existing}\n\n${noteEntry}`
      : noteEntry;

    await this.client
      .from("funders")
      .update({ notes: updated, updated_at: new Date().toISOString() })
      .eq("id", funderId)
      .eq("organization_id", this.organizationId);
  }

  // --- email_activity insert --------------------------------------------------

  private async insertEmailActivity(params: {
    email: EmailInput;
    emailType: EmailType;
    summary: string;
    actionRequired: boolean;
    actionDescription: string | null;
    urgency: EmailUrgency;
    matchedFunderId: string | null;
  }): Promise<string> {
    const { email, emailType, summary, actionRequired, actionDescription, urgency, matchedFunderId } =
      params;

    const { data, error } = await this.client
      .from("email_activity")
      .insert({
        organization_id: this.organizationId,
        funder_id: matchedFunderId ?? null,
        email_type: emailType,
        subject: email.subject || null,
        sender: email.from || null,
        received_at: email.date ?? null,
        summary,
        action_required: actionRequired,
        action_description: actionDescription ?? null,
        urgency,
        thread_id: email.thread_id ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.error(
        `[EmailParserAgent] email_activity insert failed for subject="${email.subject}": ${causeOf(error)}`,
      );
      throw new AgentError(
        withCause("Failed to save email activity record.", error),
        "write_failed",
      );
    }
    if (!data) {
      throw new AgentError(
        "Failed to save email activity record.",
        "write_failed",
      );
    }

    return data.id as string;
  }
}

// --- prompt ------------------------------------------------------------------

function buildClassificationPrompt(email: EmailInput): {
  system: string;
  prompt: string;
} {
  const system = [
    "You are a grants management assistant analyzing inbound emails for a nonprofit organization.",
    "",
    "Classify the email and extract structured metadata. Respond with ONLY a single JSON object:",
    '{"type":"<acknowledgment|information_request|award_notification|rejection|follow_up|general>","funder_name":<string or null>,"opportunity_reference":<string or null>,"action_required":<true|false>,"action_description":<string or null>,"urgency":"<low|medium|high>","sentiment":"<positive|neutral|negative>"}',
    "",
    "RULES:",
    "- type: classify what this email IS (acknowledgment=receipt/thank-you, information_request=funder asking for more info, award_notification=we were awarded funds, rejection=we were declined, follow_up=following up on application, general=anything else)",
    "- funder_name: extract the sending organization name if identifiable, otherwise null",
    "- opportunity_reference: any grant program, RFP, or opportunity name mentioned, otherwise null",
    "- action_required: true if we need to do something (reply, submit docs, record outcome, etc.)",
    "- action_description: brief description of the action if action_required is true, otherwise null",
    "- urgency: high if deadline within a week or award/rejection, medium if reply needed, low otherwise",
    "- sentiment: positive for awards/encouragement, negative for rejections/problems, neutral otherwise",
    "Return ONLY the JSON object, no prose, no code fences.",
  ].join("\n");

  const prompt = [
    `From: ${email.from}`,
    email.to ? `To: ${email.to}` : null,
    `Subject: ${email.subject}`,
    email.date ? `Date: ${email.date}` : null,
    "",
    "--- Email Body ---",
    email.body.slice(0, 3000),
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

// --- response parsing --------------------------------------------------------

function parseClassificationResponse(text: string): ClassifiedEmail {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AgentError(
      "Email classifier returned an unreadable response.",
      "bad_model_output",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AgentError(
      "Email classifier returned malformed JSON.",
      "bad_model_output",
    );
  }

  const obj = (raw ?? {}) as Record<string, unknown>;

  return {
    type: typeof obj.type === "string" ? obj.type : "general",
    funder_name:
      typeof obj.funder_name === "string" && obj.funder_name.trim()
        ? obj.funder_name.trim()
        : null,
    opportunity_reference:
      typeof obj.opportunity_reference === "string" &&
      obj.opportunity_reference.trim()
        ? obj.opportunity_reference.trim()
        : null,
    action_required: obj.action_required === true,
    action_description:
      typeof obj.action_description === "string" &&
      obj.action_description.trim()
        ? obj.action_description.trim()
        : null,
    urgency: typeof obj.urgency === "string" ? obj.urgency : "low",
    sentiment: typeof obj.sentiment === "string" ? obj.sentiment : "neutral",
  };
}

// --- normalizers -------------------------------------------------------------

function normalizeEmailType(raw: string): EmailType {
  const valid: EmailType[] = [
    "acknowledgment",
    "information_request",
    "award_notification",
    "rejection",
    "follow_up",
    "general",
  ];
  const lower = raw.toLowerCase().trim() as EmailType;
  return valid.includes(lower) ? lower : "general";
}

function normalizeUrgency(raw: string): EmailUrgency {
  if (raw === "high" || raw === "medium") return raw;
  return "low";
}

function normalizeSentiment(raw: string): EmailSentiment {
  if (raw === "positive" || raw === "negative") return raw;
  return "neutral";
}

function buildSummary(
  email: EmailInput,
  emailType: EmailType,
  classified: ClassifiedEmail,
): string {
  const parts: string[] = [
    `Type: ${emailType.replace(/_/g, " ")}`,
    classified.funder_name ? `Funder: ${classified.funder_name}` : null,
    classified.opportunity_reference
      ? `Re: ${classified.opportunity_reference}`
      : null,
    classified.action_description
      ? `Action: ${classified.action_description}`
      : null,
  ].filter(Boolean) as string[];

  return parts.join(". ") || `Email from ${email.from}: ${email.subject}`;
}

