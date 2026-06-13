// Email Campaign Agent - AGENTS.md Agent 18 (BLUEPRINT Phase 4 / §4.11).
//
// Executes drip email campaigns for cold outreach. One run sweeps the
// organization's active campaigns and, for each enrolled outreach contact,
// figures out which step they're due for, renders the templated email with the
// contact's variables, and sends it via the org's Gmail mailbox - then records a
// campaign_sends row. It also detects replies (surfaced by the Email Matching
// Agent into synced_email_messages) and advances each contact's status.
//
// Contracts honored (BEHAVIORAL_CONTRACTS §13, §21):
//   - Max 50 emails per day per organization (MAX_OUTREACH_EMAILS_PER_DAY).
//   - Minimum 24h gap between steps to the same contact, and never sooner than
//     the step's own delay_days.
//   - Template variables validated before send - an unresolvable variable blocks
//     that contact's send (never sends a half-rendered email).
//   - Sends respect organization business hours (default 9AM-5PM CT, weekdays);
//     a user-initiated run may bypass this with `force`.
//   - A reply containing "unsubscribe" sets the contact to 'unresponsive'.
//   - Campaign status transitions draft → active → paused/completed; a campaign
//     whose every contact is terminal is marked 'completed'.
//
// Extends BaseAgent: each run logs a single agent_runs row (agent_type
// 'email_campaign', migration 007). campaign_sends has no organization_id, so it
// is always reached through this org's campaign_steps (RLS traverses the parent;
// under the service-role client we scope explicitly by the step ids we loaded).

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import {
  getAuthorizedClient,
  GOOGLE_PROVIDER,
} from "@/lib/integrations/google/auth";
import { GmailSync } from "@/lib/integrations/google/gmail";
import {
  MAX_OUTREACH_EMAILS_PER_DAY,
  MIN_CAMPAIGN_STEP_GAP_DAYS,
} from "@/lib/utils/constants";
import {
  limitForMetric,
  resolveTier,
  trackUsage,
} from "@/lib/billing/usage-tracker";
import type { AgentType } from "@/types/agents";
import type { Tables, TablesInsert } from "@/types/database";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Hard floor between consecutive sends to one contact (Contracts §21). */
const MIN_STEP_GAP_MS = DAY_MS;

/** The four variables a drip template may reference (BLUEPRINT §4.11). */
export const CAMPAIGN_VARIABLES = [
  "company_name",
  "contact_name",
  "foundation_name",
  "mission_snippet",
] as const;
export type CampaignVariable = (typeof CAMPAIGN_VARIABLES)[number];

export interface EmailCampaignInput {
  /** Restrict the run to these campaign ids; null/empty = all active campaigns. */
  campaignIds?: string[] | null;
  /** Bypass the business-hours guard (set by user-initiated runs). */
  force?: boolean;
}

export interface EmailCampaignResult {
  emailsSent: number;
  replies: number;
  bounces: number;
  /** Sends skipped this run (limit reached, not due, unresolved variables, …). */
  skipped: number;
  campaignsProcessed: number;
}

type CampaignRow = Tables<"email_campaigns">;
type StepRow = Tables<"campaign_steps">;
type SendRow = Tables<"campaign_sends">;
type OutreachRow = Tables<"outreach_contacts">;

/** Statuses past which a contact receives no more campaign email. */
const TERMINAL_STATUSES = new Set(["responded", "converted", "unresponsive"]);

export class EmailCampaignAgent extends BaseAgent<
  EmailCampaignInput,
  EmailCampaignResult
> {
  readonly agentType: AgentType = "email_campaign";

  /** Org's sending mailbox + Gmail client, resolved lazily once per run. */
  private gmail: { client: GmailSync; fromEmail: string } | null = null;
  private gmailResolved = false;
  /** Org name + mission, for foundation_name / mission_snippet. Cached per run. */
  private orgContext: { name: string; mission: string | null } | null = null;

  protected async execute(
    input: EmailCampaignInput,
  ): Promise<AgentExecution<EmailCampaignResult>> {
    const result: EmailCampaignResult = {
      emailsSent: 0,
      replies: 0,
      bounces: 0,
      skipped: 0,
      campaignsProcessed: 0,
    };

    // Load the active campaigns in scope.
    let query = this.client
      .from("email_campaigns")
      .select("*")
      .eq("organization_id", this.organizationId)
      .eq("status", "active");
    const ids = (input.campaignIds ?? []).filter(Boolean);
    if (ids.length > 0) query = query.in("id", ids);

    const { data: campaignData, error: campaignError } = await query;
    if (campaignError) {
      throw new AgentError("Could not load campaigns.", "load_failed");
    }
    const campaigns = (campaignData ?? []) as CampaignRow[];
    if (campaigns.length === 0) {
      return {
        data: result,
        outputSummary: "No active campaigns to process.",
        itemsFound: 0,
        itemsProcessed: 0,
      };
    }

    // Org-wide daily send budget (Contracts §21). Counts sends already made today.
    const sentToday = await this.countSentToday();
    let remaining = Math.max(0, (await this.dailyEmailLimit()) - sentToday);

    const canSendNow = input.force || withinBusinessHours();

    for (const campaign of campaigns) {
      const processed = await this.processCampaign(campaign, {
        canSendNow,
        remaining,
        result,
      });
      remaining = processed.remaining;
      result.campaignsProcessed += 1;
    }

    const summary =
      `Processed ${result.campaignsProcessed} campaign` +
      `${result.campaignsProcessed === 1 ? "" : "s"}: ` +
      `${result.emailsSent} sent, ${result.replies} replies, ` +
      `${result.bounces} bounced, ${result.skipped} skipped.`;

    return {
      data: result,
      outputSummary: summary,
      itemsFound: result.emailsSent + result.replies + result.bounces,
      itemsProcessed: result.emailsSent,
    };
  }

  /** Run every enrolled contact of one campaign through its due step. */
  private async processCampaign(
    campaign: CampaignRow,
    ctx: { canSendNow: boolean; remaining: number; result: EmailCampaignResult },
  ): Promise<{ remaining: number }> {
    let { remaining } = ctx;
    const { result } = ctx;

    // Ordered steps for this campaign.
    const { data: stepData } = await this.client
      .from("campaign_steps")
      .select("*")
      .eq("campaign_id", campaign.id)
      .order("step_number", { ascending: true });
    const steps = (stepData ?? []) as StepRow[];
    if (steps.length === 0) return { remaining };
    const stepIds = steps.map((s) => s.id);

    // Contacts enrolled in this campaign.
    const { data: contactData } = await this.client
      .from("outreach_contacts")
      .select("*")
      .eq("organization_id", this.organizationId)
      .eq("campaign_id", campaign.id);
    const contacts = (contactData ?? []) as OutreachRow[];
    if (contacts.length === 0) return { remaining };

    // All sends across this campaign's steps, grouped by contact.
    const { data: sendData } = await this.client
      .from("campaign_sends")
      .select("*")
      .in("campaign_step_id", stepIds);
    const sendsByContact = new Map<string, SendRow[]>();
    for (const send of (sendData ?? []) as SendRow[]) {
      const list = sendsByContact.get(send.outreach_contact_id) ?? [];
      list.push(send);
      sendsByContact.set(send.outreach_contact_id, list);
    }
    const stepNumberById = new Map(steps.map((s) => [s.id, s.step_number]));

    for (const contact of contacts) {
      const status = contact.status ?? "new";
      if (TERMINAL_STATUSES.has(status)) continue;

      const sends = sendsByContact.get(contact.id) ?? [];

      // Reply detection (Contracts §21) - surfaced by the Email Matching Agent.
      const reply = await this.detectReply(contact, sends);
      if (reply) {
        await this.markContact(
          contact.id,
          reply.unsubscribe ? "unresponsive" : "responded",
        );
        if (!reply.unsubscribe) result.replies += 1;
        continue;
      }

      // Which step is this contact due for? (last sent step + 1, 1-indexed).
      const lastStepNumber = sends.reduce((max, s) => {
        const n = stepNumberById.get(s.campaign_step_id) ?? 0;
        return s.sent_at && n > max ? n : max;
      }, 0);
      const nextStep = steps.find((s) => s.step_number === lastStepNumber + 1);

      if (!nextStep) {
        // Whole sequence delivered with no reply → terminal (Contracts §21).
        if (lastStepNumber >= steps.length && status !== "unresponsive") {
          await this.markContact(contact.id, "unresponsive");
        }
        continue;
      }

      // Enforce the gap from the previous send (Contracts §21).
      if (lastStepNumber > 0) {
        const lastSentAt = lastSendTime(sends, stepNumberById, lastStepNumber);
        const gapMs = Math.max(
          nextStep.delay_days * DAY_MS,
          MIN_STEP_GAP_MS * MIN_CAMPAIGN_STEP_GAP_DAYS,
        );
        if (lastSentAt && Date.now() - lastSentAt < gapMs) {
          result.skipped += 1;
          continue;
        }
      }

      // Budget / time gates apply only once we know a send is actually due.
      if (remaining <= 0) {
        result.skipped += 1;
        continue;
      }
      if (!ctx.canSendNow) {
        result.skipped += 1;
        continue;
      }

      const gmail = await this.resolveGmail();
      if (!gmail) {
        // Org can't send (Google not connected) - nothing more to do here.
        result.skipped += 1;
        continue;
      }

      // Render + validate the templated email (Contracts §21).
      const rendered = await this.renderStep(nextStep, contact);
      if (!rendered) {
        result.skipped += 1;
        continue;
      }

      try {
        await gmail.client.sendEmail({
          to: rendered.to,
          subject: rendered.subject,
          body: rendered.body,
        });
        await this.recordSend(nextStep.id, contact.id, "sent");
        result.emailsSent += 1;
        remaining -= 1;
        if (status === "new") await this.markContact(contact.id, "contacted");
      } catch {
        // Delivery failed - record a bounce so we don't hot-loop on it.
        await this.recordSend(nextStep.id, contact.id, "bounced");
        result.bounces += 1;
      }
    }

    // Mark the campaign complete when every contact has reached a terminal state.
    await this.maybeCompleteCampaign(campaign);

    return { remaining };
  }

  // --- reply detection -------------------------------------------------------

  /**
   * A reply exists when a synced inbound message from this contact's address
   * arrived after their most recent send. The Email Matching Agent persists
   * those into synced_email_messages, so this stays in sync with it.
   */
  private async detectReply(
    contact: OutreachRow,
    sends: SendRow[],
  ): Promise<{ unsubscribe: boolean } | null> {
    const email = contact.email?.trim().toLowerCase();
    if (!email || sends.length === 0) return null;

    // A reply already recorded on a send row counts directly.
    const replied = sends.find((s) => s.replied_at || s.status === "replied");

    const lastSentAt = sends.reduce((max, s) => {
      const t = s.sent_at ? Date.parse(s.sent_at) : 0;
      return Number.isFinite(t) && t > max ? t : max;
    }, 0);

    const { data } = await this.client
      .from("synced_email_messages")
      .select("body_text, sent_at, from_email")
      .eq("organization_id", this.organizationId)
      .ilike("from_email", email)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let inbound: { body: string | null } | null = null;
    if (data) {
      const inboundAt = data.sent_at ? Date.parse(data.sent_at) : 0;
      if (!lastSentAt || inboundAt > lastSentAt) {
        inbound = { body: (data.body_text as string | null) ?? null };
      }
    }

    if (!replied && !inbound) return null;

    const body = inbound?.body ?? "";
    return { unsubscribe: /unsubscribe/i.test(body) };
  }

  // --- rendering -------------------------------------------------------------

  /**
   * Render a step's subject/body for a contact, resolving every variable. If any
   * referenced variable resolves to an empty value, or the contact has no email,
   * the send is blocked (returns null) per Contracts §21.
   */
  private async renderStep(
    step: StepRow,
    contact: OutreachRow,
  ): Promise<{ to: string; subject: string; body: string } | null> {
    const to = contact.email?.trim();
    if (!to) return null;

    const org = await this.loadOrgContext();
    const values: Record<CampaignVariable, string> = {
      company_name: contact.company_name?.trim() ?? "",
      contact_name: contact.contact_name?.trim() ?? "",
      foundation_name: org.name?.trim() ?? "",
      mission_snippet: snippet(org.mission, 280),
    };

    const subject = renderTemplate(step.subject_template, values);
    const body = renderTemplate(step.body_template, values);
    if (subject === null || body === null) return null;

    return { to, subject, body };
  }

  // --- persistence helpers ---------------------------------------------------

  private async recordSend(
    stepId: string,
    contactId: string,
    status: "sent" | "bounced",
  ): Promise<void> {
    const row: TablesInsert<"campaign_sends"> = {
      campaign_step_id: stepId,
      outreach_contact_id: contactId,
      status,
      sent_at: status === "sent" ? new Date().toISOString() : null,
    };
    await this.client.from("campaign_sends").insert(row);

    // Meter delivered emails against the org's daily email_sends quota (§25).
    // Bounces don't count - only mail that actually went out.
    if (status === "sent") {
      await trackUsage(this.client, this.organizationId, "email_sends", 1);
    }
  }

  private async markContact(contactId: string, status: string): Promise<void> {
    await this.client
      .from("outreach_contacts")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", contactId)
      .eq("organization_id", this.organizationId);
  }

  /** Mark the campaign 'completed' once no contact can advance further. */
  private async maybeCompleteCampaign(campaign: CampaignRow): Promise<void> {
    const { data } = await this.client
      .from("outreach_contacts")
      .select("status")
      .eq("organization_id", this.organizationId)
      .eq("campaign_id", campaign.id);
    const contacts = data ?? [];
    if (contacts.length === 0) return;

    const allTerminal = contacts.every((c) =>
      TERMINAL_STATUSES.has((c.status as string | null) ?? "new"),
    );
    if (!allTerminal) return;

    await this.client
      .from("email_campaigns")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", campaign.id)
      .eq("organization_id", this.organizationId);
  }

  /** Count sends made today (UTC) across all of this org's campaign steps. */
  /**
   * The org's effective daily send budget: the lesser of its subscription tier's
   * email_sends_per_day (Behavioral Contracts §25) and the absolute anti-spam cap
   * of MAX_OUTREACH_EMAILS_PER_DAY (Contracts §13/§21). The anti-spam cap always
   * wins where governance disagrees (BLUEPRINT's enterprise tier lists 200/day,
   * but §21's 50/day is a hard safety ceiling we never exceed).
   */
  private async dailyEmailLimit(): Promise<number> {
    const tier = await resolveTier(this.client, this.organizationId);
    const tierLimit = limitForMetric(tier, "email_sends");
    return Math.min(tierLimit, MAX_OUTREACH_EMAILS_PER_DAY);
  }

  private async countSentToday(): Promise<number> {
    const stepIds = await this.orgStepIds();
    if (stepIds.length === 0) return 0;

    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);

    const { count } = await this.client
      .from("campaign_sends")
      .select("id", { count: "exact", head: true })
      .in("campaign_step_id", stepIds)
      .gte("sent_at", start.toISOString());
    return count ?? 0;
  }

  /** All campaign_step ids belonging to this organization's campaigns. */
  private async orgStepIds(): Promise<string[]> {
    const { data: campaigns } = await this.client
      .from("email_campaigns")
      .select("id")
      .eq("organization_id", this.organizationId);
    const campaignIds = (campaigns ?? []).map((c) => c.id as string);
    if (campaignIds.length === 0) return [];

    const { data: steps } = await this.client
      .from("campaign_steps")
      .select("id")
      .in("campaign_id", campaignIds);
    return (steps ?? []).map((s) => s.id as string);
  }

  /** Resolve the org's Gmail sender once per run (null if not connected). */
  private async resolveGmail(): Promise<{
    client: GmailSync;
    fromEmail: string;
  } | null> {
    if (this.gmailResolved) return this.gmail;
    this.gmailResolved = true;

    try {
      const { data } = await this.client
        .from("integrations")
        .select("connected_email")
        .eq("organization_id", this.organizationId)
        .eq("provider", GOOGLE_PROVIDER)
        .maybeSingle();
      const fromEmail = (data?.connected_email as string | null) ?? null;
      if (!fromEmail) {
        this.gmail = null;
        return null;
      }
      const auth = await getAuthorizedClient(this.organizationId, this.client);
      this.gmail = { client: new GmailSync(auth), fromEmail };
    } catch {
      this.gmail = null;
    }
    return this.gmail;
  }

  /** Load org name + mission for variable substitution (cached per run). */
  private async loadOrgContext(): Promise<{
    name: string;
    mission: string | null;
  }> {
    if (this.orgContext) return this.orgContext;
    const { data } = await this.client
      .from("organizations")
      .select("name, mission_statement")
      .eq("id", this.organizationId)
      .maybeSingle();
    this.orgContext = {
      name: (data?.name as string | null) ?? "",
      mission: (data?.mission_statement as string | null) ?? null,
    };
    return this.orgContext;
  }
}

// --- pure helpers ------------------------------------------------------------

/** Most recent sent_at (ms) among sends of a given step number; 0 if none. */
function lastSendTime(
  sends: SendRow[],
  stepNumberById: Map<string, number>,
  stepNumber: number,
): number {
  return sends.reduce((max, s) => {
    if (stepNumberById.get(s.campaign_step_id) !== stepNumber) return max;
    const t = s.sent_at ? Date.parse(s.sent_at) : 0;
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
}

/** First `max` chars of a single-lined string, or "" when absent. */
function snippet(value: string | null, max: number): string {
  if (!value) return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Substitute {variable} tokens. Returns null if any RECOGNIZED variable resolves
 * to an empty value (blocks the send, Contracts §21). Unknown {tokens} are left
 * untouched - the builder restricts authoring to the known set.
 */
export function renderTemplate(
  template: string,
  values: Record<CampaignVariable, string>,
): string | null {
  const known = new Set<string>(CAMPAIGN_VARIABLES);
  let blocked = false;

  const out = template.replace(/\{([a-z_]+)\}/gi, (match, name: string) => {
    if (!known.has(name)) return match;
    const value = values[name as CampaignVariable];
    if (!value) {
      blocked = true;
      return match;
    }
    return value;
  });

  return blocked ? null : out;
}

/** True if now falls inside business hours: Mon-Fri, 9AM-5PM Central. */
export function withinBusinessHours(date: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  let hour = Number(hourStr);
  if (hour === 24) hour = 0; // some ICU builds report midnight as 24
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  return isWeekday && hour >= 9 && hour < 17;
}
