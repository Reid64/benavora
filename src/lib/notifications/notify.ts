// Central notification dispatch, gated per-user by notification_preferences
// (migration 087, Settings > Notifications). Writes an in-app alert when the
// user has in_app enabled for the event type, and sends an email via Resend
// when they have email enabled. Missing preference rows default to
// in_app=true/email=false, matching the table's column defaults.

import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { NotificationEventType } from "@/lib/services/notification-dispatcher";
import { dedupKeys, contentFingerprint } from "@/lib/alerts/alerts-service";

export interface NotifyData {
  title: string;
  message?: string;
  link?: string;
}

export interface NotifyResult {
  alert_id: string | null;
  email_sent: boolean;
}

export async function notify(
  eventType: NotificationEventType,
  orgId: string,
  userId: string,
  data: NotifyData,
  supabase: SupabaseClient,
): Promise<NotifyResult> {
  const { data: pref } = await supabase
    .from("notification_preferences")
    .select("in_app, email")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("event_type", eventType)
    .maybeSingle();

  const wantsInApp = (pref as { in_app: boolean } | null)?.in_app ?? true;
  const wantsEmail = (pref as { email: boolean } | null)?.email ?? false;

  let alert_id: string | null = null;
  if (wantsInApp) {
    const { data: inserted, error } = await supabase
      .from("alerts")
      .insert({
        organization_id: orgId,
        type: "system",
        severity: "info",
        message: data.message ? `${data.title}: ${data.message}` : data.title,
        link: data.link ?? null,
        dedup_key: dedupKeys.userNotification(
          eventType,
          userId,
          new Date().toISOString().slice(0, 10),
          contentFingerprint(`${data.title}\n${data.message ?? ""}`),
        ),
      })
      .select("id")
      .single();
    if (!error && inserted) alert_id = (inserted as { id: string }).id;
  }

  let email_sent = false;
  const resendKey = process.env.RESEND_API_KEY;
  if (wantsEmail && resendKey) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .single();
    const to = (profile as { email?: string } | null)?.email;

    if (to) {
      try {
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL ?? "notifications@benavora.com",
          to,
          subject: data.title,
          html: `<p style="font-family:sans-serif">${data.message ?? data.title}</p>`,
        });
        email_sent = true;
      } catch {
        // Email failure is non-fatal; the in-app alert (if any) already exists.
      }
    }
  }

  return { alert_id, email_sent };
}
