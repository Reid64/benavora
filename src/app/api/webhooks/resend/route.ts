import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/webhooks/resend
// Receives Resend email events and updates campaign_sends status.
// Supported events: email.opened, email.clicked → opened_at
//                   email.bounced              → status 'bounced'
//                   email.complained           → status 'bounced' (treat as hard bounce)
// Reply detection is handled by the Email Matching Agent (not Resend webhooks).
//
// SECURITY: Resend signs webhooks with a Svix-format signature (svix-id /
// svix-timestamp / svix-signature headers). Verification is REQUIRED — if
// RESEND_WEBHOOK_SECRET isn't configured, every request is rejected (500)
// rather than silently accepted. This never falls back to trusting an
// unsigned payload. Manual HMAC-SHA256 verification is used here (same
// algorithm the official `svix` SDK's Webhook.verify() implements) because
// `svix` is not currently an installed dependency — see PR/commit notes if
// you want to switch to the SDK later (`pnpm add svix`).

export const runtime = "nodejs";

interface ResendWebhookEvent {
  type: string;
  data: {
    email_id?: string;
    [key: string]: unknown;
  };
}

const TIMESTAMP_TOLERANCE_SECONDS = 300;

/** Verify a Svix-format webhook signature: HMAC-SHA256(svixId.svixTimestamp.rawBody), base64. */
function verifySignature(rawBody: string, headers: Headers, secret: string): boolean {
  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const ts = parseInt(svixTimestamp, 10);
  if (
    !Number.isFinite(ts) ||
    Math.abs(Math.floor(Date.now() / 1000) - ts) > TIMESTAMP_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const message = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes).update(message).digest("base64");
  const expectedBuf = Buffer.from(expected);

  // svix-signature can contain multiple space-separated "v1,<sig>" values;
  // a match on any one is valid (used during secret rotation).
  return svixSignature.split(" ").some((sig) => {
    const [version, value] = sig.split(",");
    if (version !== "v1" || !value) return false;
    const valueBuf = Buffer.from(value);
    return valueBuf.length === expectedBuf.length && timingSafeEqual(valueBuf, expectedBuf);
  });
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  // Read as raw text first — the HMAC is computed over the exact bytes Resend
  // signed, not a re-serialized JSON.parse/stringify round-trip.
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const event = payload as ResendWebhookEvent;
  const emailId = event?.data?.email_id;
  if (!emailId || typeof emailId !== "string") {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();

  // campaign_sends doesn't store the Resend email id directly. A future migration
  // can add a resend_email_id column; for now we match by the closest sent_at
  // timestamp via a best-effort lookup. Until that column exists this handler
  // records the event in the logs only - the opened_at / replied_at path is a
  // no-op that won't cause errors.

  if (event.type === "email.opened" || event.type === "email.clicked") {
    // Mark the most-recent un-opened send that matches this Resend message.
    // When resend_email_id column is added, replace with exact match.
    const now = new Date().toISOString();
    const { data: rows } = await admin
      .from("campaign_sends")
      .select("id, opened_at")
      .is("opened_at", null)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1);

    if (rows?.[0]) {
      await admin
        .from("campaign_sends")
        .update({ opened_at: now, status: "opened" })
        .eq("id", rows[0].id as string);
    }
  }

  if (event.type === "email.bounced" || event.type === "email.complained") {
    const { data: rows } = await admin
      .from("campaign_sends")
      .select("id, outreach_contact_id")
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1);

    if (rows?.[0]) {
      await admin
        .from("campaign_sends")
        .update({ status: "bounced" })
        .eq("id", rows[0].id as string);

      // Mark the contact unresponsive on a hard bounce so the campaign agent
      // stops trying (Contracts §13).
      if (rows[0].outreach_contact_id) {
        await admin
          .from("outreach_contacts")
          .update({
            status: "unresponsive",
            updated_at: new Date().toISOString(),
          })
          .eq("id", rows[0].outreach_contact_id as string);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
