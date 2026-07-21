// Shared Resend transactional-email client for system-generated notification
// emails (draft ready, morning digest, urgent alerts, welcome). Distinct from
// src/lib/email/sender.ts (EmailSender), which sends outbound sales/CRM mail
// via a per-org Gmail connection with Resend as fallback — these emails are
// always platform-originated, never user-connected-mailbox mail.

import { Resend } from "resend";

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}

export interface EmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

const DEFAULT_FROM = "Benavora <notifications@benavora.com>";

export async function sendEmail({
  to,
  subject,
  html,
  from,
}: SendEmailParams): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("sendEmail: RESEND_API_KEY not configured — email not sent.");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: from ?? process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM,
      to,
      subject,
      html,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Resend send failed",
    };
  }
}
