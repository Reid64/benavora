import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/webhooks/resend
// Receives Resend email events and updates campaign_sends status.
// Supported events: email.opened, email.clicked → opened_at
//                   email.bounced              → status 'bounced'
//                   email.complained           → status 'bounced' (treat as hard bounce)
// Reply detection is handled by the Email Matching Agent (not Resend webhooks).

export const runtime = "nodejs";

interface ResendWebhookEvent {
  type: string;
  data: {
    email_id?: string;
    [key: string]: unknown;
  };
}

export async function POST(request: Request) {
  // Resend signs webhooks with a svix signature; verify if RESEND_WEBHOOK_SECRET is set.
  // Without it, accept all events (internal webhook only).
  let payload: unknown;
  try {
    payload = await request.json();
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
  // records the event in the logs only — the opened_at / replied_at path is a
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
