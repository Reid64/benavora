// Follow-up reminder scheduling engine.
//
// scheduleFollowUpReminders: creates calendar events (or in-app notifications)
//   at 14, 30, and 60 days after submission for each submitted/follow_up_due
//   application, skipping dates already covered.
//
// processOverdueFollowUps: checks deadlines with deadline_type='follow_up_date'
//   that are past due, fires in-app alerts, and auto-advances submitted
//   applications to follow_up_due stage.

import { google } from "googleapis";

import { createAdminClient } from "@/lib/supabase/admin";

import { GCalAuthManager } from "./gcal-auth";

export interface ReminderResult {
  applicationsProcessed: number;
  remindersCreated: number;
  notificationsCreated: number;
  calendarEventsCreated: number;
  errors: Array<{ applicationId: string; message: string }>;
}

// Days after submission date to schedule follow-up check-in reminders.
const FOLLOW_UP_DAYS = [14, 30, 60] as const;

// as any casts below mirror gcal-auth.ts — load-bearing due to pinned
// google-auth-library vs googleapis version divergence.
async function buildCalendarClient(connectionId: string) {
  const auth = new GCalAuthManager();
  const accessToken = await auth.refreshToken(connectionId);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oauth = new (google.auth.OAuth2 as any)(clientId, clientSecret);
  oauth.setCredentials({ access_token: accessToken });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return google.calendar({ version: "v3" as const, auth: oauth as any });
}

// Returns a yyyy-MM-dd string offset by `days` from the given date string.
function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export class ReminderEngine {
  async scheduleFollowUpReminders(orgId: string): Promise<ReminderResult> {
    const result: ReminderResult = {
      applicationsProcessed: 0,
      remindersCreated: 0,
      notificationsCreated: 0,
      calendarEventsCreated: 0,
      errors: [],
    };
    const supabase = createAdminClient();

    // Find the first active calendar connection for this org.
    const { data: connections } = await supabase
      .from("calendar_connections")
      .select("id")
      .eq("organization_id", orgId)
      .eq("sync_status", "active")
      .limit(1);

    const connectionId: string | null = (connections ?? [])[0]?.id ?? null;

    // Applications that need follow-up attention.
    const { data: apps, error: appsErr } = await supabase
      .from("applications")
      .select("id, submitted_at, opportunity_id")
      .eq("organization_id", orgId)
      .in("stage", ["submitted", "follow_up_due"]);

    if (appsErr) throw new Error(`Failed to load applications: ${appsErr.message}`);
    if (!apps || apps.length === 0) return result;

    // Load existing follow-up reminder events so we don't duplicate.
    const { data: existingEvents } = await supabase
      .from("calendar_events")
      .select("linked_application_id, start_time")
      .eq("organization_id", orgId)
      .eq("event_type", "follow_up_reminder");

    type ExistingEvent = { linked_application_id: string | null; start_time: string };

    const coveredByApp = new Map<string, Set<string>>();
    for (const ev of (existingEvents ?? []) as ExistingEvent[]) {
      if (!ev.linked_application_id) continue;
      const dateKey = ev.start_time.slice(0, 10);
      let set = coveredByApp.get(ev.linked_application_id);
      if (!set) {
        set = new Set<string>();
        coveredByApp.set(ev.linked_application_id, set);
      }
      set.add(dateKey);
    }

    type AppRow = {
      id: string;
      submitted_at: string | null;
      opportunity_id: string;
    };

    for (const app of apps as AppRow[]) {
      try {
        if (!app.submitted_at) continue;
        result.applicationsProcessed++;

        const submittedYmd = app.submitted_at.slice(0, 10);
        const covered = coveredByApp.get(app.id) ?? new Set<string>();

        for (const days of FOLLOW_UP_DAYS) {
          const reminderDate = addDays(submittedYmd, days);
          if (covered.has(reminderDate)) continue;

          const title = `Follow-up reminder: ${days}-day check-in`;

          if (connectionId) {
            const startTime = `${reminderDate}T09:00:00Z`;
            const endTime = `${reminderDate}T09:30:00Z`;
            let googleEventId: string | null = null;

            try {
              const calendar = await buildCalendarClient(connectionId);
              const resp = await calendar.events.insert({
                calendarId: "primary",
                requestBody: {
                  summary: title,
                  description: `Follow up on grant application status.\nApplication ID: ${app.id}`,
                  start: { dateTime: startTime },
                  end: { dateTime: endTime },
                  colorId: "7", // Peacock blue — matches follow_up_date in gcal-sync.ts
                  reminders: { useDefault: true },
                },
              });
              googleEventId = (resp.data.id as string | undefined) ?? null;
              result.calendarEventsCreated++;
            } catch (gcalErr) {
              result.errors.push({
                applicationId: app.id,
                message: `GCal push failed (${days}d): ${gcalErr instanceof Error ? gcalErr.message : String(gcalErr)}`,
              });
            }

            await supabase.from("calendar_events").insert({
              organization_id: orgId,
              connection_id: connectionId,
              google_event_id: googleEventId,
              title,
              start_time: startTime,
              end_time: endTime,
              all_day: false,
              event_type: "follow_up_reminder",
              linked_application_id: app.id,
              linked_opportunity_id: app.opportunity_id,
              is_synced: !!googleEventId,
            });
          } else {
            // No calendar connection — create an in-app notification instead.
            await supabase.from("automation_notifications").insert({
              organization_id: orgId,
              event_type: "follow_up_reminder",
              title,
              message: `Your application has been in submitted status for ${days} days. Consider following up on its status.`,
              is_read: false,
              sent_via: "in_app",
              related_entity_type: "application",
              related_entity_id: app.id,
            });
            result.notificationsCreated++;
          }

          result.remindersCreated++;
          covered.add(reminderDate);
        }
      } catch (err) {
        result.errors.push({
          applicationId: (app as AppRow).id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  async processOverdueFollowUps(orgId: string): Promise<void> {
    const supabase = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);

    // Deadlines typed as follow-up dates that have passed without completion.
    const { data: overdue, error } = await supabase
      .from("deadlines")
      .select("id, application_id, title, due_date")
      .eq("organization_id", orgId)
      .eq("deadline_type", "follow_up_date")
      .eq("is_completed", false)
      .lt("due_date", today);

    if (error) throw new Error(`Failed to load overdue follow-ups: ${error.message}`);
    if (!overdue || overdue.length === 0) return;

    type OverdueRow = {
      id: string;
      application_id: string | null;
      title: string;
      due_date: string;
    };

    for (const dl of overdue as OverdueRow[]) {
      await supabase.from("automation_notifications").insert({
        organization_id: orgId,
        event_type: "follow_up_overdue",
        title: `Overdue follow-up: ${dl.title}`,
        message: `This follow-up was due on ${dl.due_date} and has not been completed. Please take action.`,
        is_read: false,
        sent_via: "in_app",
        related_entity_type: dl.application_id ? "application" : "deadline",
        related_entity_id: dl.application_id ?? dl.id,
      });

      // Auto-advance application from submitted → follow_up_due when the
      // follow-up deadline passes without action.
      if (dl.application_id) {
        await supabase
          .from("applications")
          .update({ stage: "follow_up_due", updated_at: new Date().toISOString() })
          .eq("id", dl.application_id)
          .eq("organization_id", orgId)
          .eq("stage", "submitted");
      }
    }
  }
}
