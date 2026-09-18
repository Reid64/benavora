import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailSender, type SendOptions } from "@/lib/email/sender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const body = (raw ?? {}) as {
    to?: unknown;
    cc?: unknown;
    subject?: unknown;
    body?: unknown;
    reply_to_thread_id?: unknown;
  };

  if (!Array.isArray(body.to) || body.to.length === 0) {
    return jsonError("to must be a non-empty array of addresses.", "invalid_input", 400);
  }
  if (typeof body.subject !== "string" || !body.subject.trim()) {
    return jsonError("subject is required.", "invalid_input", 400);
  }
  if (typeof body.body !== "string" || !body.body.trim()) {
    return jsonError("body is required.", "invalid_input", 400);
  }

  const admin = createAdminClient();

  // Rate limit: 20 sends per minute per org tracked via synced_email_messages
  const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await admin
    .from("synced_email_messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("created_at", windowStart);

  if ((count ?? 0) >= RATE_LIMIT) {
    return jsonError("Rate limit exceeded: 20 sends per minute.", "rate_limited", 429);
  }

  const bodyText = (body.body as string).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const sendOptions: SendOptions = {
    to: body.to as string[],
    cc: Array.isArray(body.cc) && body.cc.length > 0 ? (body.cc as string[]) : undefined,
    subject: (body.subject as string).trim(),
    body_html: (body.body as string).trim(),
    body_text: bodyText,
  };

  // Resolve threading headers from the specified thread
  if (typeof body.reply_to_thread_id === "string" && body.reply_to_thread_id) {
    const { data: messages } = await admin
      .from("synced_email_messages")
      .select("gmail_message_id, thread_id")
      .eq("organization_id", organizationId)
      .eq("thread_id", body.reply_to_thread_id)
      .order("sent_at", { ascending: false })
      .limit(1);

    if (messages && messages.length > 0) {
      const latest = messages[0] as { gmail_message_id: string; thread_id: string };
      sendOptions.in_reply_to = `<${latest.gmail_message_id}>`;
      sendOptions.references = `<${latest.gmail_message_id}>`;
      sendOptions.gmail_thread_id = latest.thread_id;
    }
  }

  const result = await emailSender.send(organizationId, sendOptions);

  if (!result.success) {
    // emailSender can surface raw Gmail/Resend provider error bodies in
    // result.error — never relay those to the client.
    return jsonError("Failed to send email.", "send_error", 502);
  }

  return NextResponse.json(result);
}
