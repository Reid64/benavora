// Google Calendar sync for deadlines (BLUEPRINT Phase 4, BEHAVIORAL_CONTRACTS
// §20 "Calendar Integration").
//
// SERVER-ONLY. Wraps the Calendar API for one organization. Construct with an
// authorized OAuth2 client from auth.ts (`getAuthorizedClient`) plus a Supabase
// client and the organization id — every read/write here is explicitly scoped by
// organization_id, which is required for correctness under the service-role
// client where RLS does not protect us (Contracts §2, §15).
//
// Contracts honored (§20):
//   - One calendar event per deadline, tracked via deadlines.google_calendar_event_id.
//   - Event title = deadline.title; description includes the parent
//     opportunity/application name and a link back to Benavora.
//   - Reminder overrides at 7d / 3d / 1d before the due date, matching the
//     in-app deadline reminder system.
//   - Updating a deadline updates its event; deleting a deadline deletes its event.
//     (Completing a deadline does NOT delete the event — that is the caller's
//     policy; this layer only creates/updates/deletes when asked.)

import { google, type Auth, type calendar_v3 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Enums, Tables } from "@/types/database";

type DeadlineType = Enums<"deadline_type">;

/** Default calendar to sync into — the connected account's primary calendar. */
export const DEFAULT_CALENDAR_ID = "primary";

/** The deadline columns this layer needs to build and reconcile an event. */
export type DeadlineForSync = Pick<
  Tables<"deadlines">,
  | "id"
  | "title"
  | "description"
  | "due_date"
  | "deadline_type"
  | "google_calendar_event_id"
  | "application_id"
  | "opportunity_id"
>;

/** Resolved parent label + deep link for a deadline's description. */
interface DeadlineContext {
  label: string | null;
  link: string | null;
}

export interface CalendarInfo {
  id: string;
  summary: string;
  primary: boolean;
}

export interface SyncResult {
  /** Deadlines processed (attempted). */
  synced: number;
  /** New calendar events created. */
  created: number;
  /** Existing calendar events updated. */
  updated: number;
  /** Deadlines whose sync failed (logged, non-fatal). */
  errors: number;
}

export interface SyncDeadlineResult {
  action: "created" | "updated";
  eventId: string;
}

export interface CalendarSyncOptions {
  auth: Auth.OAuth2Client;
  client: SupabaseClient;
  organizationId: string;
  /** Target calendar; defaults to the account's primary calendar. */
  calendarId?: string;
}

// Google Calendar event color IDs (1–11) mapped per deadline type (BLUEPRINT
// §4.9 urgency colors / Contracts §20). Tomato=11 (red), Blueberry=9 (blue),
// Banana=5 (yellow), Basil=10 (green), Tangerine=6 (orange).
const COLOR_BY_TYPE: Record<DeadlineType, string> = {
  application_deadline: "11", // red — the hard submission date
  follow_up_date: "9", // blue
  reporting_deadline: "5", // yellow
  renewal_date: "10", // green
  document_expiration: "6", // orange
};

// In-app reminder cadence mirrored as calendar reminders (Contracts §20: 7d/3d/1d).
const REMINDER_DAYS = [7, 3, 1];
const MINUTES_PER_DAY = 24 * 60;

export class CalendarSync {
  private readonly calendar: calendar_v3.Calendar;
  private readonly client: SupabaseClient;
  private readonly organizationId: string;
  private readonly calendarId: string;

  constructor(options: CalendarSyncOptions) {
    this.calendar = google.calendar({
      version: "v3" as const,
      auth: options.auth as any,
    });
    this.client = options.client;
    this.organizationId = options.organizationId;
    this.calendarId = options.calendarId ?? DEFAULT_CALENDAR_ID;
  }

  /** List the connected account's calendars (id, name, whether it's primary). */
  async listCalendars(): Promise<CalendarInfo[]> {
    const res = await this.calendar.calendarList.list({ maxResults: 250 });
    return (res.data.items ?? [])
      .filter((c): c is calendar_v3.Schema$CalendarListEntry => Boolean(c.id))
      .map((c) => ({
        id: c.id as string,
        summary: c.summary ?? (c.id as string),
        primary: Boolean(c.primary),
      }));
  }

  /**
   * Create a calendar event from a deadline. Returns the new event id. Pure API
   * call — does not persist the id back to the deadline (the caller / syncDeadline
   * owns that).
   */
  async createEvent(
    deadline: DeadlineForSync,
    context?: DeadlineContext,
  ): Promise<string> {
    const resolved = context ?? (await this.resolveContext(deadline));
    const res = await this.calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: this.buildEventResource(deadline, resolved),
    });
    const id = res.data.id;
    if (!id) throw new Error("Google Calendar did not return an event id.");
    return id;
  }

  /** Update an existing calendar event in place from the deadline's current data. */
  async updateEvent(
    deadline: DeadlineForSync,
    calendarEventId: string,
    context?: DeadlineContext,
  ): Promise<void> {
    const resolved = context ?? (await this.resolveContext(deadline));
    await this.calendar.events.patch({
      calendarId: this.calendarId,
      eventId: calendarEventId,
      requestBody: this.buildEventResource(deadline, resolved),
    });
  }

  /** Delete a calendar event. Treats already-gone events (404/410) as success. */
  async deleteEvent(calendarEventId: string): Promise<void> {
    try {
      await this.calendar.events.delete({
        calendarId: this.calendarId,
        eventId: calendarEventId,
      });
    } catch (err) {
      if (isMissingEventError(err)) return;
      throw err;
    }
  }

  /**
   * Create or update the calendar event for a single deadline and persist its
   * google_calendar_event_id. If the stored event id no longer exists on Google
   * (deleted out-of-band), a fresh event is created. Returns the action taken.
   */
  async syncDeadline(
    deadline: DeadlineForSync,
    context?: DeadlineContext,
  ): Promise<SyncDeadlineResult> {
    const resolved = context ?? (await this.resolveContext(deadline));

    if (deadline.google_calendar_event_id) {
      try {
        await this.updateEvent(
          deadline,
          deadline.google_calendar_event_id,
          resolved,
        );
        return { action: "updated", eventId: deadline.google_calendar_event_id };
      } catch (err) {
        // The stored event was removed on Google's side — fall through to create.
        if (!isMissingEventError(err)) throw err;
      }
    }

    const eventId = await this.createEvent(deadline, resolved);
    await this.persistEventId(deadline.id, eventId);
    return { action: "created", eventId };
  }

  /**
   * Bulk-sync every incomplete deadline for the organization to the calendar.
   * Per-deadline failures are counted, not fatal — the rest still sync (mirrors
   * the research/email sync resilience). organizationId is accepted for an
   * explicit call-site but always defaults to this instance's org scope.
   */
  async syncAllDeadlines(organizationId?: string): Promise<SyncResult> {
    const orgId = organizationId ?? this.organizationId;

    const { data, error } = await this.client
      .from("deadlines")
      .select(
        "id, title, description, due_date, deadline_type, google_calendar_event_id, application_id, opportunity_id",
      )
      .eq("organization_id", orgId)
      .eq("is_completed", false);

    if (error) {
      throw new Error("Could not load deadlines to sync.");
    }

    const deadlines = (data ?? []) as DeadlineForSync[];
    const contexts = await this.resolveContexts(deadlines);

    const result: SyncResult = {
      synced: 0,
      created: 0,
      updated: 0,
      errors: 0,
    };

    for (const deadline of deadlines) {
      result.synced += 1;
      try {
        const outcome = await this.syncDeadline(
          deadline,
          contexts.get(deadline.id),
        );
        if (outcome.action === "created") result.created += 1;
        else result.updated += 1;
      } catch {
        result.errors += 1;
      }
    }

    return result;
  }

  // --- event construction ----------------------------------------------------

  /** Build the Calendar event body for a deadline (all-day, with reminders). */
  private buildEventResource(
    deadline: DeadlineForSync,
    context: DeadlineContext,
  ): calendar_v3.Schema$Event {
    const date = dateOnly(deadline.due_date);
    return {
      summary: deadline.title,
      description: buildDescription(deadline, context),
      // All-day event: end.date is exclusive, so it's the day after the due date.
      start: { date },
      end: { date: addOneDay(date) },
      colorId: COLOR_BY_TYPE[deadline.deadline_type] ?? undefined,
      reminders: {
        useDefault: false,
        overrides: REMINDER_DAYS.map((days) => ({
          method: "popup",
          minutes: days * MINUTES_PER_DAY,
        })),
      },
    };
  }

  // --- parent context resolution ---------------------------------------------

  /** Resolve the parent label + deep link for a single deadline. */
  private async resolveContext(
    deadline: DeadlineForSync,
  ): Promise<DeadlineContext> {
    const map = await this.resolveContexts([deadline]);
    return map.get(deadline.id) ?? { label: null, link: null };
  }

  /**
   * Batch-resolve parent opportunity/application names + deep links for a set of
   * deadlines, so syncAllDeadlines avoids per-deadline lookups. A deadline links
   * to an application OR an opportunity (or neither); applications resolve their
   * name through their opportunity.
   */
  private async resolveContexts(
    deadlines: DeadlineForSync[],
  ): Promise<Map<string, DeadlineContext>> {
    const appIds = unique(
      deadlines.map((d) => d.application_id).filter(isNonNull),
    );
    const directOppIds = unique(
      deadlines.map((d) => d.opportunity_id).filter(isNonNull),
    );

    // applications → their opportunity_id (to look the names up uniformly).
    const appToOpp = new Map<string, string | null>();
    if (appIds.length > 0) {
      const { data } = await this.client
        .from("applications")
        .select("id, opportunity_id")
        .eq("organization_id", this.organizationId)
        .in("id", appIds);
      for (const row of data ?? []) {
        appToOpp.set(row.id as string, (row.opportunity_id as string) ?? null);
      }
    }

    const allOppIds = unique([
      ...directOppIds,
      ...Array.from(appToOpp.values()).filter(isNonNull),
    ]);

    const oppNames = new Map<string, string>();
    if (allOppIds.length > 0) {
      const { data } = await this.client
        .from("opportunities")
        .select("id, name")
        .eq("organization_id", this.organizationId)
        .in("id", allOppIds);
      for (const row of data ?? []) {
        oppNames.set(row.id as string, row.name as string);
      }
    }

    const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
    const map = new Map<string, DeadlineContext>();

    for (const d of deadlines) {
      if (d.application_id) {
        const oppId = appToOpp.get(d.application_id);
        const name = oppId ? oppNames.get(oppId) : undefined;
        map.set(d.id, {
          label: `Application: ${name ?? "Untitled"}`,
          link: base ? `${base}/applications/${d.application_id}` : null,
        });
      } else if (d.opportunity_id) {
        map.set(d.id, {
          label: `Opportunity: ${oppNames.get(d.opportunity_id) ?? "Untitled"}`,
          link: base ? `${base}/opportunities/${d.opportunity_id}` : null,
        });
      } else {
        map.set(d.id, { label: null, link: null });
      }
    }

    return map;
  }

  // --- persistence -----------------------------------------------------------

  /** Store the calendar event id on the deadline (org-scoped). */
  private async persistEventId(
    deadlineId: string,
    eventId: string,
  ): Promise<void> {
    await this.client
      .from("deadlines")
      .update({
        google_calendar_event_id: eventId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deadlineId)
      .eq("organization_id", this.organizationId);
  }
}

// --- description / date helpers ----------------------------------------------

/** Compose the event description: type, parent context, and a link back. */
function buildDescription(
  deadline: DeadlineForSync,
  context: DeadlineContext,
): string {
  const lines: string[] = [humanizeType(deadline.deadline_type)];
  if (deadline.description?.trim()) lines.push(deadline.description.trim());
  if (context.label) lines.push(context.label);
  if (context.link) lines.push(`View in Benavora: ${context.link}`);
  return lines.join("\n\n");
}

function humanizeType(type: DeadlineType): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Normalize a date/timestamp column value to a "yyyy-MM-dd" calendar date. */
function dateOnly(value: string): string {
  return value.slice(0, 10);
}

/** Next calendar day in "yyyy-MM-dd" (UTC), for the exclusive all-day end. */
function addOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** True for Google "event not found / already deleted" responses (404 / 410). */
function isMissingEventError(err: unknown): boolean {
  const code = (err as { code?: number; status?: number } | null)?.code;
  const status = (err as { status?: number } | null)?.status;
  return code === 404 || code === 410 || status === 404 || status === 410;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isNonNull<T>(value: T | null | undefined): value is T {
  return value != null;
}
