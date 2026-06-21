// Google Calendar sync engine.
//
// syncDeadlinesOut: pushes Benavora deadlines as all-day Google Calendar events.
// syncEventsIn: incrementally pulls Google Calendar events into calendar_events
//               using the syncToken protocol (RFC 5545 incremental sync).

import { google } from "googleapis";

import { createAdminClient } from "@/lib/supabase/admin";

import { GCalAuthManager } from "./gcal-auth";

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  errors: Array<{ id: string; message: string }>;
}

// Google Calendar colorId values for each deadline_type.
const DEADLINE_COLOR: Record<string, string> = {
  application_deadline: "11", // Tomato (red)
  follow_up_date: "7",        // Peacock (blue)
  reporting_deadline: "2",    // Sage (green)
};

// Reminder offsets in minutes (7 days, 3 days, 1 day).
const REMINDER_MINUTES = [10_080, 4_320, 1_440];

function buildDescription(
  deadlineTitle: string,
  opportunityName: string | null,
  applicationId: string | null,
): string {
  const lines = [`Benavora deadline: ${deadlineTitle}`];
  if (opportunityName) lines.push(`Opportunity: ${opportunityName}`);
  if (applicationId) lines.push(`Application ID: ${applicationId}`);
  return lines.join("\n");
}

// Returns a Google Calendar API client authenticated with a fresh access token.
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

export class GCalSyncEngine {
  async syncDeadlinesOut(
    orgId: string,
    connectionId: string,
  ): Promise<SyncResult> {
    const result: SyncResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: [],
    };
    const supabase = createAdminClient();

    // Load active deadlines with linked opportunity/application IDs.
    const { data: deadlines, error: dlErr } = await supabase
      .from("deadlines")
      .select(
        "id, title, due_date, deadline_type, updated_at, opportunity_id, application_id",
      )
      .eq("organization_id", orgId)
      .eq("is_completed", false);

    if (dlErr) throw new Error(`Failed to load deadlines: ${dlErr.message}`);
    if (!deadlines || deadlines.length === 0) return result;

    // Fetch opportunity names for linked opportunity IDs.
    const oppIds = [
      ...new Set(
        deadlines
          .map((d) => (d as { opportunity_id: string | null }).opportunity_id)
          .filter((id): id is string => id !== null),
      ),
    ];
    const oppNames = new Map<string, string>();
    if (oppIds.length > 0) {
      const { data: opps } = await supabase
        .from("opportunities")
        .select("id, name")
        .in("id", oppIds);
      for (const opp of opps ?? []) {
        oppNames.set(
          (opp as { id: string }).id,
          (opp as { name: string }).name,
        );
      }
    }

    // Load existing calendar_events for this connection keyed by deadline ID.
    const { data: existingEvents, error: evErr } = await supabase
      .from("calendar_events")
      .select("id, linked_deadline_id, google_event_id, updated_at")
      .eq("organization_id", orgId)
      .eq("connection_id", connectionId)
      .not("linked_deadline_id", "is", null);

    if (evErr) throw new Error(`Failed to load calendar events: ${evErr.message}`);

    type ExistingEvent = {
      id: string;
      linked_deadline_id: string | null;
      google_event_id: string | null;
      updated_at: string;
    };

    const eventByDeadline = new Map<string, ExistingEvent>();
    for (const ev of (existingEvents ?? []) as ExistingEvent[]) {
      if (ev.linked_deadline_id) {
        eventByDeadline.set(ev.linked_deadline_id, ev);
      }
    }

    const calendar = await buildCalendarClient(connectionId);

    type DeadlineRow = {
      id: string;
      title: string;
      due_date: string;
      deadline_type: string;
      updated_at: string;
      opportunity_id: string | null;
      application_id: string | null;
    };

    for (const dl of deadlines as DeadlineRow[]) {
      try {
        const oppName = dl.opportunity_id
          ? (oppNames.get(dl.opportunity_id) ?? null)
          : null;
        const description = buildDescription(
          dl.title,
          oppName,
          dl.application_id,
        );
        const colorId = DEADLINE_COLOR[dl.deadline_type] ?? "1";
        const dateStr = dl.due_date.slice(0, 10);

        const eventBody = {
          summary: dl.title,
          description,
          start: { date: dateStr },
          end: { date: dateStr },
          colorId,
          reminders: {
            useDefault: false,
            overrides: REMINDER_MINUTES.map((m) => ({
              method: "popup",
              minutes: m,
            })),
          },
        };

        const existing = eventByDeadline.get(dl.id);

        if (!existing) {
          const inserted = await calendar.events.insert({
            calendarId: "primary",
            requestBody: eventBody,
          });
          const googleEventId = (inserted.data.id as string | undefined) ?? "";

          const startTime = new Date(`${dateStr}T00:00:00Z`).toISOString();
          const endTime = new Date(`${dateStr}T23:59:59Z`).toISOString();

          await supabase.from("calendar_events").insert({
            organization_id: orgId,
            connection_id: connectionId,
            google_event_id: googleEventId,
            title: dl.title,
            description,
            start_time: startTime,
            end_time: endTime,
            all_day: true,
            event_type: dl.deadline_type,
            linked_deadline_id: dl.id,
            linked_opportunity_id: dl.opportunity_id ?? null,
            linked_application_id: dl.application_id ?? null,
            is_synced: true,
            reminder_minutes: REMINDER_MINUTES,
          });

          result.created++;
        } else if (
          existing.google_event_id &&
          dl.updated_at > existing.updated_at
        ) {
          await calendar.events.patch({
            calendarId: "primary",
            eventId: existing.google_event_id,
            requestBody: eventBody,
          });

          const startTime = new Date(`${dateStr}T00:00:00Z`).toISOString();
          const endTime = new Date(`${dateStr}T23:59:59Z`).toISOString();

          await supabase
            .from("calendar_events")
            .update({
              title: dl.title,
              description,
              start_time: startTime,
              end_time: endTime,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);

          result.updated++;
        } else {
          result.unchanged++;
        }
      } catch (err) {
        result.errors.push({
          id: dl.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  async syncEventsIn(connectionId: string): Promise<SyncResult> {
    const result: SyncResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: [],
    };
    const supabase = createAdminClient();

    const { data: conn, error: connErr } = await supabase
      .from("calendar_connections")
      .select("organization_id, sync_token")
      .eq("id", connectionId)
      .single();

    if (connErr || !conn) throw new Error("Calendar connection not found");

    const { organization_id: orgId, sync_token: syncToken } = conn as {
      organization_id: string;
      sync_token: string | null;
    };

    const calendar = await buildCalendarClient(connectionId);

    let pageToken: string | undefined;
    let newSyncToken: string | undefined;
    const allItems: Array<{
      id?: string | null;
      summary?: string | null;
      status?: string | null;
      start?: { date?: string | null; dateTime?: string | null };
      end?: { date?: string | null; dateTime?: string | null };
    }> = [];

    try {
      do {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const params: any = { calendarId: "primary", pageToken };
        if (syncToken) {
          params.syncToken = syncToken;
        } else {
          // Full sync window: 90 days back to 1 year forward.
          const since = new Date();
          since.setDate(since.getDate() - 90);
          params.timeMin = since.toISOString();
        }

        const resp = await calendar.events.list(params);
        allItems.push(...((resp.data.items ?? []) as typeof allItems));
        newSyncToken = (resp.data.nextSyncToken as string | undefined) ?? undefined;
        pageToken = (resp.data.nextPageToken as string | undefined) ?? undefined;
      } while (pageToken);
    } catch (err: unknown) {
      // 410 Gone: sync token expired — clear it so the next call does a full sync.
      if ((err as { code?: number })?.code === 410) {
        await supabase
          .from("calendar_connections")
          .update({ sync_token: null, updated_at: new Date().toISOString() })
          .eq("id", connectionId);
        return result;
      }
      throw err;
    }

    for (const item of allItems) {
      if (!item.id) continue;

      try {
        if (item.status === "cancelled") {
          await supabase
            .from("calendar_events")
            .update({ is_synced: false, updated_at: new Date().toISOString() })
            .eq("organization_id", orgId)
            .eq("google_event_id", item.id);
          result.updated++;
          continue;
        }

        const startRaw = item.start?.dateTime ?? item.start?.date ?? "";
        const endRaw = item.end?.dateTime ?? item.end?.date ?? "";
        const isAllDay = !item.start?.dateTime;
        const startTime = isAllDay
          ? new Date(`${startRaw}T00:00:00Z`).toISOString()
          : new Date(startRaw).toISOString();
        const endTime = isAllDay
          ? new Date(`${endRaw}T00:00:00Z`).toISOString()
          : new Date(endRaw).toISOString();

        const { error: upsertErr } = await supabase
          .from("calendar_events")
          .upsert(
            {
              organization_id: orgId,
              connection_id: connectionId,
              google_event_id: item.id,
              title: item.summary ?? "(no title)",
              start_time: startTime,
              end_time: endTime,
              all_day: isAllDay,
              is_synced: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "organization_id,google_event_id" },
          );

        if (upsertErr) {
          result.errors.push({ id: item.id, message: upsertErr.message });
        } else {
          result.created++;
        }
      } catch (err) {
        result.errors.push({
          id: item.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (newSyncToken) {
      await supabase
        .from("calendar_connections")
        .update({
          sync_token: newSyncToken,
          last_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", connectionId);
    }

    return result;
  }
}
