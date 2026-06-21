import { createHmac } from "crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { UnsubscribeAgent } from "@/lib/admin/unsubscribe-agent";

// POST /api/admin/webhooks/email-reply
// Receives Resend inbound email webhook events (replies to campaign sends).
// Classifies the reply intent and triggers the appropriate automated action.

export const runtime = "nodejs";

interface ResendInboundHeader {
  name: string;
  value: string;
}

interface ResendInboundEvent {
  type: string;
  data: {
    from?: string;
    to?: string[];
    subject?: string;
    text?: string;
    html?: string;
    headers?: ResendInboundHeader[];
  };
}

function verifySignature(
  rawBody: string,
  headers: Headers,
  secret: string
): boolean {
  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Reject if timestamp is more than 5 minutes old (replay protection)
  const ts = parseInt(svixTimestamp, 10);
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

  const secretBytes = Buffer.from(
    secret.replace(/^whsec_/, ""),
    "base64"
  );
  const message = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes)
    .update(message)
    .digest("base64");

  return svixSignature
    .split(" ")
    .some((sig) => sig === `v1,${expected}`);
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    if (!verifySignature(rawBody, request.headers, secret)) {
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }
  }

  let event: ResendInboundEvent;
  try {
    event = JSON.parse(rawBody) as ResendInboundEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Only process inbound/received events
  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true });
  }

  const fromEmail = event.data.from;
  const subject = event.data.subject ?? "";
  const body = event.data.text ?? event.data.html ?? "";

  if (!fromEmail) {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();

  // Try to find the originating send via In-Reply-To header first
  let sendId: string | null = null;

  const inReplyTo = event.data.headers?.find(
    (h) => h.name.toLowerCase() === "in-reply-to"
  )?.value;

  if (inReplyTo) {
    // Resend message IDs appear as <{id}@...> in In-Reply-To
    const match = inReplyTo.match(/<([^@>]+)/);
    const msgId = match?.[1];
    if (msgId) {
      const { data: byMsgId } = await admin
        .from("sales_sends")
        .select("id")
        .eq("resend_message_id", msgId)
        .limit(1)
        .single();
      sendId = byMsgId?.id ?? null;
    }
  }

  // Fall back to most recent send addressed to this prospect email
  if (!sendId) {
    const { data: byEmail } = await admin
      .from("sales_sends")
      .select("id")
      .eq("to_address", fromEmail)
      .in("status", ["sent", "opened", "replied"])
      .order("sent_at", { ascending: false })
      .limit(1)
      .single();
    sendId = byEmail?.id ?? null;
  }

  if (!sendId) {
    // Unknown sender — nothing to act on
    return NextResponse.json({ ok: true });
  }

  const agent = new UnsubscribeAgent();
  await agent.processIncomingReply(sendId, body, subject);

  return NextResponse.json({ ok: true });
}
