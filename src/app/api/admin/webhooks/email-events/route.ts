import { createHmac } from "crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { UnsubscribeAgent } from "@/lib/admin/unsubscribe-agent";

// POST /api/admin/webhooks/email-events
// Receives Resend delivery event webhooks for sales campaign sends.
// Supported events: email.delivered, email.opened, email.bounced, email.complained

export const runtime = "nodejs";

interface BounceData {
  type?: string;
  message?: string;
}

interface ResendEventData {
  email_id?: string;
  from?: string;
  to?: string[];
  subject?: string;
  bounce?: BounceData;
  [key: string]: unknown;
}

interface ResendDeliveryEvent {
  type: string;
  created_at?: string;
  data: ResendEventData;
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

  let event: ResendDeliveryEvent;
  try {
    event = JSON.parse(rawBody) as ResendDeliveryEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const emailId = event.data.email_id;
  if (!emailId) {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Look up the sales_send by Resend message ID
  const { data: send } = await admin
    .from("sales_sends")
    .select("id, prospect_id, to_address, bounce_type")
    .eq("resend_message_id", emailId)
    .single();

  if (!send) {
    return NextResponse.json({ ok: true });
  }

  switch (event.type) {
    case "email.delivered": {
      await admin
        .from("sales_sends")
        .update({ status: "sent" })
        .eq("id", send.id)
        .eq("status", "queued");
      break;
    }

    case "email.opened": {
      await admin
        .from("sales_sends")
        .update({ status: "opened", opened_at: now })
        .eq("id", send.id)
        .is("opened_at", null);
      break;
    }

    case "email.bounced": {
      const bounceType = event.data.bounce?.type ?? "soft";
      const isHard = bounceType === "hard";

      await admin
        .from("sales_sends")
        .update({
          status: "bounced",
          bounced_at: now,
          bounce_type: bounceType,
        })
        .eq("id", send.id);

      if (isHard) {
        const agent = new UnsubscribeAgent();
        // Classify as bounce — suppresses the address
        await agent.processIncomingReply(
          send.id,
          `Hard bounce: ${event.data.bounce?.message ?? ""}`,
          "Delivery failure notification"
        );
      }
      break;
    }

    case "email.complained": {
      // Spam complaint — suppress immediately without waiting on AI classification
      const prospectEmail = send.to_address;

      await admin
        .from("sales_sends")
        .update({ status: "suppressed", unsubscribed_at: now })
        .eq("id", send.id);

      // Add to suppression list
      await admin.from("suppression_list").insert({
        email: prospectEmail,
        reason: "spam_complaint",
        source: "resend_complaint_event",
      });

      // Mark prospect suppressed
      await admin
        .from("prospects")
        .update({
          suppressed: true,
          suppressed_reason: "spam_complaint",
          suppressed_at: now,
        })
        .eq("id", send.prospect_id);

      // Cancel remaining queued sends for this prospect
      await admin
        .from("sales_sends")
        .update({ status: "suppressed" })
        .eq("prospect_id", send.prospect_id)
        .eq("status", "queued");

      break;
    }
  }

  return NextResponse.json({ ok: true });
}
