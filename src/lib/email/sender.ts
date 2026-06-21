import "server-only";

import { Resend } from "resend";
import { google } from "googleapis";

import { createAdminClient } from "@/lib/supabase/admin";

import { GmailAuthManager } from "./gmail-auth";

export interface SendOptions {
  to: string[];
  cc?: string[];
  subject: string;
  body_html: string;
  body_text: string;
  reply_to?: string;
  in_reply_to?: string;
  references?: string;
  gmail_thread_id?: string;
}

export interface SendResult {
  success: boolean;
  message_id?: string;
  thread_id?: string;
  provider: "gmail" | "resend";
  error?: string;
}

const authManager = new GmailAuthManager();

function buildMimeRaw(opts: SendOptions & { from: string }): string {
  const lines: string[] = [
    `From: ${opts.from}`,
    `To: ${opts.to.join(", ")}`,
  ];
  if (opts.cc?.length) lines.push(`Cc: ${opts.cc.join(", ")}`);
  lines.push(
    `Subject: ${opts.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="bnv_b"`,
  );
  if (opts.reply_to) lines.push(`Reply-To: ${opts.reply_to}`);
  if (opts.in_reply_to) lines.push(`In-Reply-To: ${opts.in_reply_to}`);
  if (opts.references) lines.push(`References: ${opts.references}`);

  lines.push(
    "",
    "--bnv_b",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    opts.body_text,
    "",
    "--bnv_b",
    "Content-Type: text/html; charset=UTF-8",
    "",
    opts.body_html,
    "",
    "--bnv_b--",
  );

  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export class EmailSender {
  async sendViaGmail(connectionId: string, options: SendOptions): Promise<SendResult> {
    const admin = createAdminClient();

    const { data: conn, error: connErr } = await admin
      .from("email_connections")
      .select("email_address")
      .eq("id", connectionId)
      .single();

    if (connErr || !conn) {
      return { success: false, provider: "gmail", error: "Connection not found" };
    }

    const fromEmail = (conn as { email_address: string }).email_address;

    let accessToken: string;
    try {
      accessToken = await authManager.refreshToken(connectionId);
    } catch (err) {
      return {
        success: false,
        provider: "gmail",
        error: `Token refresh failed: ${err instanceof Error ? err.message : "unknown"}`,
      };
    }

    const raw = buildMimeRaw({ ...options, from: fromEmail });

    // as any casts are load-bearing: pinned google-auth-library diverges from
    // the googleapis-bundled copy making types incompatible (see gmail-auth.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oauth = new (google.auth.OAuth2 as any)();
    oauth.setCredentials({ access_token: accessToken });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gmail = google.gmail({ version: "v1" as const, auth: oauth as any });

    try {
      const requestBody: { raw: string; threadId?: string } = { raw };
      if (options.gmail_thread_id) requestBody.threadId = options.gmail_thread_id;

      const res = await gmail.users.messages.send({ userId: "me", requestBody });

      return {
        success: true,
        message_id: res.data.id ?? undefined,
        thread_id: res.data.threadId ?? undefined,
        provider: "gmail",
      };
    } catch (err) {
      const e = err as { code?: number; message?: string };
      if (e.code === 429) {
        return { success: false, provider: "gmail", error: "Gmail quota exceeded — retry later" };
      }
      if (e.code === 400) {
        return { success: false, provider: "gmail", error: "Invalid recipient or malformed message" };
      }
      return { success: false, provider: "gmail", error: e.message ?? "Gmail send failed" };
    }
  }

  async sendViaResend(options: SendOptions): Promise<SendResult> {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      return { success: false, provider: "resend", error: "RESEND_API_KEY not configured" };
    }

    const fromDomain = process.env.RESEND_FROM_DOMAIN ?? "benavora.com";
    const from = `noreply@${fromDomain}`;
    const resend = new Resend(key);

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (resend.emails.send as (p: any) => Promise<{
        data: { id?: string } | null;
        error: { message: string } | null;
      }>)({
        from,
        to: options.to,
        ...(options.cc?.length ? { cc: options.cc } : {}),
        subject: options.subject,
        html: options.body_html,
        text: options.body_text,
        ...(options.reply_to ? { reply_to: options.reply_to } : {}),
        headers: {
          ...(options.in_reply_to ? { "In-Reply-To": options.in_reply_to } : {}),
          ...(options.references ? { References: options.references } : {}),
        },
      });

      if (error) {
        return { success: false, provider: "resend", error: error.message };
      }

      return { success: true, message_id: data?.id, provider: "resend" };
    } catch (err) {
      return {
        success: false,
        provider: "resend",
        error: err instanceof Error ? err.message : "Resend send failed",
      };
    }
  }

  async send(orgId: string, options: SendOptions): Promise<SendResult> {
    const admin = createAdminClient();

    const { data: conn } = await admin
      .from("email_connections")
      .select("id")
      .eq("organization_id", orgId)
      .eq("sync_status", "active")
      .maybeSingle();

    let result: SendResult;

    if (conn) {
      result = await this.sendViaGmail((conn as { id: string }).id, options);
      // Fall back to Resend on quota or unrecoverable token errors
      if (!result.success && (result.error?.includes("quota") || result.error?.includes("Token"))) {
        result = await this.sendViaResend(options);
      }
    } else {
      result = await this.sendViaResend(options);
    }

    // Log outbound sends to synced_email_messages (best-effort, non-fatal)
    if (result.success) {
      try {
        await admin.from("synced_email_messages").insert({
          organization_id: orgId,
          thread_id: result.thread_id ?? result.message_id ?? "outbound",
          gmail_message_id: result.message_id ?? `outbound-${Date.now()}`,
          to_emails: options.to,
          cc_emails: options.cc ?? null,
          subject: options.subject,
          body_html: options.body_html,
          body_text: options.body_text,
          sent_at: new Date().toISOString(),
        });
      } catch {
        // Non-fatal: logging failure must not fail the send
      }
    }

    return result;
  }
}

export const emailSender = new EmailSender();
