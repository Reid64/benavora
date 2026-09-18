import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import { createAdminClient } from "@/lib/supabase/admin";

export type ReplyIntent =
  | "unsubscribe"
  | "positive"
  | "question"
  | "negative"
  | "auto_reply"
  | "bounce";

export interface ReplyClassification {
  intent: ReplyIntent;
  confidence: number;
  reasoning: string;
}

export interface ProcessResult {
  success: boolean;
  action: string;
  classification: ReplyClassification;
  error?: string;
}

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  anthropicClient = createTrackedAnthropic({ apiKey }, "unsubscribe-agent");
  return anthropicClient;
}

export class UnsubscribeAgent {
  async classifyReply(
    emailBody: string,
    emailSubject: string
  ): Promise<ReplyClassification> {
    const message = await getAnthropicClient().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system:
        'You are analyzing email replies to a sales outreach campaign for a nonprofit SaaS platform. Classify the reply intent. Return ONLY valid JSON: { "intent": "unsubscribe" | "positive" | "question" | "negative" | "auto_reply" | "bounce", "confidence": number (0-1), "reasoning": string }',
      messages: [
        {
          role: "user",
          content: `Subject: ${emailSubject}\n\nBody: ${emailBody}`,
        },
      ],
    });

    const raw =
      message.content[0]?.type === "text" ? message.content[0].text : "{}";
    // Strip any markdown code fences the model may include
    const json = raw.replace(/```(?:json)?\n?/g, "").trim();
    return JSON.parse(json) as ReplyClassification;
  }

  async processIncomingReply(
    sendId: string,
    replyBody: string,
    replySubject: string
  ): Promise<ProcessResult> {
    const admin = createAdminClient();

    let classification: ReplyClassification;
    try {
      classification = await this.classifyReply(replyBody, replySubject);
    } catch (err) {
      return {
        success: false,
        action: "classification_failed",
        classification: {
          intent: "negative",
          confidence: 0,
          reasoning: "Classification error",
        },
        error: String(err),
      };
    }

    const { data: send, error: sendErr } = await admin
      .from("sales_sends")
      .select("id, prospect_id, to_address, from_address, campaign_id")
      .eq("id", sendId)
      .single();

    if (sendErr ?? !send) {
      return {
        success: false,
        action: "send_not_found",
        classification,
        error: sendErr?.message,
      };
    }

    const prospectEmail = send.to_address;
    const prospectId = send.prospect_id;
    const now = new Date().toISOString();

    if (
      classification.intent === "unsubscribe" &&
      classification.confidence > 0.7
    ) {
      // a. Add to global suppression list (ignore duplicate email errors)
      await admin.from("suppression_list").insert({
        email: prospectEmail,
        reason: "unsubscribe_reply",
        source: "email_reply",
      });

      // b. Mark prospect suppressed
      await admin
        .from("prospects")
        .update({
          suppressed: true,
          suppressed_reason: "unsubscribe_reply",
          suppressed_at: now,
        })
        .eq("id", prospectId);

      // c. Cancel all queued future sends for this prospect across all campaigns
      await admin
        .from("sales_sends")
        .update({ status: "suppressed" })
        .eq("prospect_id", prospectId)
        .eq("status", "queued");

      // d. Send unsubscribe confirmation
      await this.sendConfirmationEmail(prospectEmail, send.from_address);

      // e. Stamp the originating send
      await admin
        .from("sales_sends")
        .update({ unsubscribed_at: now, status: "suppressed" })
        .eq("id", sendId);

      return { success: true, action: "unsubscribed", classification };
    }

    if (classification.intent === "positive") {
      // a. Mark prospect replied
      await admin
        .from("prospects")
        .update({ has_replied: true })
        .eq("id", prospectId);

      // b. Pause automated sequence — cancel remaining queued sends
      await admin
        .from("sales_sends")
        .update({ status: "suppressed" })
        .eq("prospect_id", prospectId)
        .eq("status", "queued");

      // c. Stamp the originating send and surface for manual follow-up
      await admin
        .from("sales_sends")
        .update({ replied_at: now, status: "replied" })
        .eq("id", sendId);

      // Admin alert: positive reply visible via prospect dashboard (has_replied=true, status='replied')
      return {
        success: true,
        action: `positive_reply:prospect:${prospectId}`,
        classification,
      };
    }

    if (classification.intent === "bounce") {
      // Hard bounce from reply content — suppress immediately
      await admin
        .from("sales_sends")
        .update({ status: "bounced", bounced_at: now, bounce_type: "hard" })
        .eq("id", sendId);

      await admin.from("suppression_list").insert({
        email: prospectEmail,
        reason: "hard_bounce",
        source: "email_reply",
      });

      await admin
        .from("prospects")
        .update({
          suppressed: true,
          suppressed_reason: "hard_bounce",
          suppressed_at: now,
        })
        .eq("id", prospectId);

      return { success: true, action: "bounced_suppressed", classification };
    }

    // auto_reply / question / negative — record reply, no further action
    await admin
      .from("sales_sends")
      .update({ replied_at: now, status: "replied" })
      .eq("id", sendId);

    return {
      success: true,
      action: `classified_${classification.intent}`,
      classification,
    };
  }

  private async sendConfirmationEmail(
    to: string,
    fromAddress: string
  ): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject: "You've been unsubscribed",
        html: "<p>You've been removed from our mailing list. We apologize for the inconvenience.</p>",
      }),
    });
  }
}
