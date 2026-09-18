/* eslint-disable @typescript-eslint/no-explicit-any */

import Anthropic from "@anthropic-ai/sdk";
import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import { Resend } from "resend";
import { withClaudeLimit } from "./claude-concurrency";

let _claude: Anthropic | null = null;
let _resend: Resend | null = null;

function getClaude(): Anthropic {
  if (!_claude) {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _claude = createTrackedAnthropic({ apiKey }, "follow-up-scheduler");
  }
  return _claude;
}

function getResend(): Resend {
  if (!_resend) {
    const key = process.env["RESEND_API_KEY"];
    if (!key) throw new Error("RESEND_API_KEY is not configured");
    _resend = new Resend(key);
  }
  return _resend;
}

export interface ScheduleFollowUpsParams {
  submissionId: string;
  organizationId: string;
  funderId: string;
  funderName: string;
  submissionChannel: string;
  supabase: any;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export async function scheduleFollowUps(params: ScheduleFollowUpsParams): Promise<void> {
  const { submissionId, organizationId, funderId, supabase } = params;

  const now = new Date();

  const rows = [
    {
      submission_id: submissionId,
      organization_id: organizationId,
      funder_id: funderId,
      sequence_number: 1,
      scheduled_at: addDays(now, 14).toISOString(),
      status: "pending",
      template_type: "initial_followup",
    },
    {
      submission_id: submissionId,
      organization_id: organizationId,
      funder_id: funderId,
      sequence_number: 2,
      scheduled_at: addDays(now, 30).toISOString(),
      status: "pending",
      template_type: "second_followup",
    },
    {
      submission_id: submissionId,
      organization_id: organizationId,
      funder_id: funderId,
      sequence_number: 3,
      scheduled_at: addDays(now, 60).toISOString(),
      status: "pending",
      template_type: "final_followup",
    },
  ];

  const { error } = await supabase.from("autoapply_follow_ups").insert(rows);
  if (error) {
    throw new Error(`Failed to schedule follow-ups: ${error.message}`);
  }
}

async function generateFollowUpContent(
  templateType: string,
  funderName: string,
  funderEmail: string,
  submittedAt: string | null,
  requestType: string | null,
  orgName: string,
): Promise<string> {
  const claude = getClaude();
  const submissionDate = submittedAt
    ? new Date(submittedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "recently";
  const requestLabel = requestType ?? "donation/sponsorship";

  const promptMap: Record<string, string> = {
    initial_followup: `Write a brief, professional follow-up email from ${orgName} to ${funderName} (${funderEmail}). We submitted a ${requestLabel} request on ${submissionDate}. Politely follow up to confirm receipt and express continued interest. Keep it under 100 words. Plain text only, no HTML.`,
    second_followup: `Write a second follow-up email from ${orgName} to ${funderName}. We submitted a ${requestLabel} request and followed up once. This is our second check-in. Briefly highlight our mission impact and ask if they need any additional information. Under 80 words. Plain text only.`,
    final_followup: `Write a final, gracious follow-up email from ${orgName} to ${funderName}. We submitted a ${requestLabel} request some time ago. Share a brief updated impact stat, express ongoing hope for partnership, and let them know the door remains open. Under 90 words. Plain text only.`,
  };

  const prompt =
    promptMap[templateType] ??
    `Following up on our ${requestLabel} request to ${funderName}. We'd love to hear if you had a chance to review it.`;

  const message = await withClaudeLimit(() =>
    claude.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    }),
  );

  const block = message.content[0];
  if (block?.type === "text") {
    return block.text.trim();
  }
  return `Following up on our ${requestLabel} request submitted to ${funderName} on ${submissionDate}.`;
}

export interface ProcessFollowUpsResult {
  sent: number;
  skipped: number;
}

export type SendFollowUpOutcome =
  | { sent: true }
  | { sent: false; skipped: true; reason: string }
  | { sent: false; skipped: false; error: string };

/**
 * Send (or skip) a single due follow-up item: checks for a received response
 * and a do-not-contact window, resolves the funder contact, generates content
 * via Claude, and sends via Resend. Extracted from processFollowUps()'s loop
 * body so a single item can also be sent on demand (e.g. the "Send Now"
 * action on the Follow-Ups page), not just in a scheduled batch.
 */
export async function sendSingleFollowUp(
  item: any,
  supabase: any,
): Promise<SendFollowUpOutcome> {
  try {
    // Check if funder has already responded on the submission record.
    const { data: submission } = await supabase
      .from("autoapply_submissions")
      .select("submitted_at, request_type, status, confirmation_number")
      .eq("id", item.submission_id)
      .maybeSingle();

    const responseReceived = item.response_received === true;

    if (responseReceived) {
      // Cancel all remaining follow-ups for this submission.
      await cancelFollowUps(item.submission_id, "response_received", supabase);
      return { sent: false, skipped: true, reason: "response_received" };
    }

    // Check funder_relationships for do_not_contact_until.
    const { data: rel } = await supabase
      .from("funder_relationships")
      .select("do_not_contact_until")
      .eq("organization_id", item.organization_id)
      .eq("funder_id", item.funder_id)
      .maybeSingle();

    if (rel?.do_not_contact_until && new Date(rel.do_not_contact_until) > new Date()) {
      return { sent: false, skipped: true, reason: "do_not_contact_window" };
    }

    // Load funder name.
    const { data: funder } = await supabase
      .from("funders")
      .select("name")
      .eq("id", item.funder_id)
      .maybeSingle();

    const funderName: string = funder?.name ?? "Valued Funder";

    // Load primary contact email for this funder (first contact with an email).
    const { data: contact } = await supabase
      .from("contacts")
      .select("email, name")
      .eq("funder_id", item.funder_id)
      .eq("organization_id", item.organization_id)
      .not("email", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const funderEmail: string | null = contact?.email ?? null;

    if (!funderEmail) {
      // No email address — skip silently.
      await supabase
        .from("autoapply_follow_ups")
        .update({ status: "skipped", cancel_reason: "no_email" })
        .eq("id", item.id);
      return { sent: false, skipped: true, reason: "no_email" };
    }

    // Load org name for the email sender.
    const { data: org } = await supabase
      .from("organizations")
      .select("name, email")
      .eq("id", item.organization_id)
      .maybeSingle();

    const orgName: string = org?.name ?? "Our Organization";
    const replyTo: string = org?.email ?? "noreply@benavora.com";

    // Generate follow-up email content.
    const content = await generateFollowUpContent(
      item.template_type,
      funderName,
      funderEmail,
      submission?.submitted_at ?? null,
      submission?.request_type ?? null,
      orgName,
    );

    // Update content in DB first.
    await supabase
      .from("autoapply_follow_ups")
      .update({ content })
      .eq("id", item.id);

    // Send via Resend.
    const resend = getResend();
    const subjectMap: Record<string, string> = {
      initial_followup: `Following Up — ${orgName} Donation Request`,
      second_followup: `Checking In — ${orgName} Partnership Request`,
      final_followup: `${orgName} — Final Follow-Up on Our Request`,
    };
    const subject = subjectMap[item.template_type] ?? `Follow-Up from ${orgName}`;

    await (resend.emails.send as (p: any) => Promise<{ data: { id: string } | null; error: { message: string } | null }>)({
      from: `${orgName} via Benavora <notifications@benavora.com>`,
      to: funderEmail,
      reply_to: replyTo,
      subject,
      text: content,
    });

    await supabase
      .from("autoapply_follow_ups")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", item.id);

    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    // Mark as failed but let the caller keep processing remaining items.
    await supabase
      .from("autoapply_follow_ups")
      .update({ status: "failed", cancel_reason: message })
      .eq("id", item.id);
    return { sent: false, skipped: false, error: message };
  }
}

export async function processFollowUps(supabase: any): Promise<ProcessFollowUpsResult> {
  const now = new Date().toISOString();

  const { data: dueItems, error: fetchError } = await supabase
    .from("autoapply_follow_ups")
    .select("*")
    .lte("scheduled_at", now)
    .eq("status", "pending");

  if (fetchError) {
    throw new Error(`Failed to fetch due follow-ups: ${fetchError.message}`);
  }

  const items: any[] = dueItems ?? [];
  let sent = 0;
  let skipped = 0;

  for (const item of items) {
    const outcome = await sendSingleFollowUp(item, supabase);
    if (outcome.sent) sent++;
    else skipped++;
  }

  return { sent, skipped };
}

export async function cancelFollowUps(
  submissionId: string,
  reason: string,
  supabase: any,
): Promise<void> {
  const { error } = await supabase
    .from("autoapply_follow_ups")
    .update({ status: "cancelled", cancel_reason: reason })
    .eq("submission_id", submissionId)
    .eq("status", "pending");

  if (error) {
    throw new Error(`Failed to cancel follow-ups for submission ${submissionId}: ${error.message}`);
  }
}
