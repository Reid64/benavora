// SERVER-ONLY. Uses the admin client so this can be called from agent workers
// that have no active user session. Caller MUST supply a trusted organization_id
// derived from the database — never from a request body (Contracts §2, §32).

import { createAdminClient } from "@/lib/supabase/admin";
import { Resend } from "resend";

export type NotificationEventType =
  | "automation_completed"
  | "automation_failed"
  | "automation_paused"
  | "deadline_approaching"
  | "agent_completed"
  | "agent_failed"
  | "key_expired"
  | "target_paused"
  | "daily_limit_reached"
  | "new_opportunity"
  | "application_submitted"
  | "award_received"
  | "research_complete"
  | "autoapply_complete"
  | "draft_ready"
  | "donor_intent_signal"
  | "strategic_recommendation"
  | "community_need_signal"
  | "improvement_proposal"
  | "onboarding_welcome";

export type DigestMode = "per_event" | "hourly_digest" | "daily_summary";

// Canonical event type list + labels, shared by the Settings > Notifications
// preferences UI (src/app/(dashboard)/settings/notifications) and notify()
// (src/lib/notifications/notify.ts) so both agree on what a user can toggle.
export const NOTIFICATION_EVENT_TYPES: {
  value: NotificationEventType;
  label: string;
}[] = [
  { value: "automation_completed", label: "Automation completed" },
  { value: "automation_failed", label: "Automation failed" },
  { value: "automation_paused", label: "Automation paused" },
  { value: "deadline_approaching", label: "Deadline approaching" },
  { value: "agent_completed", label: "Agent completed" },
  { value: "agent_failed", label: "Agent failed" },
  { value: "key_expired", label: "Integration key expired" },
  { value: "target_paused", label: "Scraping target paused" },
  { value: "daily_limit_reached", label: "Daily limit reached" },
  { value: "new_opportunity", label: "New Opportunity" },
  { value: "application_submitted", label: "Application Submitted" },
  { value: "award_received", label: "Award Received" },
  { value: "research_complete", label: "Research Complete" },
  { value: "autoapply_complete", label: "AutoApply Complete" },
  { value: "draft_ready", label: "Draft Ready for Review" },
  { value: "donor_intent_signal", label: "High Donor Intent Signal" },
  { value: "strategic_recommendation", label: "Strategic Recommendation" },
  { value: "community_need_signal", label: "Community Need Signal" },
  { value: "improvement_proposal", label: "Agent Improvement Proposal" },
  { value: "onboarding_welcome", label: "Welcome Email" },
];

export interface DispatchOptions {
  event_type: NotificationEventType;
  title: string;
  message?: string;
  organization_id: string;
  related_entity?: { type: string; id: string };
  /**
   * Defaults to per_event (immediate email). hourly_digest and daily_summary
   * create the in-app record but skip immediate email — a scheduled sweep
   * aggregates those into digest batches.
   */
  digest_mode?: DigestMode;
  /** Recipient email. Required for email delivery; omit for in-app only. */
  email_to?: string;
  /** Extra call-to-action links appended to the email body, beyond the default "View in Benavora" link. */
  extra_links?: { label: string; href: string }[];
}

export interface DispatchResult {
  notification_id: string;
  email_sent: boolean;
}

/**
 * Creates an automation_notifications row (always, in-app) and optionally sends
 * an email via Resend when digest_mode is 'per_event', an email_to is provided,
 * and RESEND_API_KEY is set. Email failure does not block the in-app record.
 * (Contracts §32)
 */
export async function dispatchNotification(
  opts: DispatchOptions,
): Promise<DispatchResult> {
  const {
    event_type,
    title,
    message,
    organization_id,
    related_entity,
    digest_mode = "per_event",
    email_to,
    extra_links,
  } = opts;

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("automation_notifications")
    .insert({
      organization_id,
      event_type,
      title,
      message: message ?? null,
      is_read: false,
      sent_via: "in_app",
      related_entity_type: related_entity?.type ?? null,
      related_entity_id: related_entity?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`dispatchNotification: insert failed — ${error?.message}`);
  }

  const notification_id = (data as { id: string }).id;
  let email_sent = false;

  const resendKey = process.env.RESEND_API_KEY;
  if (digest_mode === "per_event" && email_to && resendKey) {
    try {
      const resend = new Resend(resendKey);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? "notifications@benavora.com",
        to: email_to,
        subject: title,
        html: [
          `<p style="font-family:sans-serif">${message ?? title}</p>`,
          ...(extra_links ?? []).map(
            (l) =>
              `<p style="font-family:sans-serif"><a href="${l.href}">${l.label} →</a></p>`,
          ),
          `<p style="font-family:sans-serif">`,
          `<a href="${appUrl}/notifications">View in Benavora →</a>`,
          `</p>`,
        ].join(""),
      });
      email_sent = true;

      // Update sent_via to reflect the email channel was also used.
      await supabase
        .from("automation_notifications")
        .update({ sent_via: "email" })
        .eq("id", notification_id);
    } catch {
      // Email failure is non-fatal; in-app record already created above.
    }
  }

  return { notification_id, email_sent };
}
