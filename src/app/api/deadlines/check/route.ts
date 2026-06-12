import { NextResponse } from "next/server";
import { differenceInCalendarDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Deadline reminder check (BLUEPRINT §4.9). Scans incomplete deadlines and marks
// reminder flags as they cross the 30/14/7/3/1-day thresholds. Reminder flags are
// one-way — once sent they are never reset (Contracts §11), so this route is
// idempotent: re-running it never re-fires a reminder that already went out.
//
// This is a deterministic processor — no AI (AGENTS.md Agent 03). Actual email
// delivery is Phase 4 (gated behind the per-org `feature.email_integration`
// flag); until then the route records which reminders are *due* and marks their
// flags, so the work isn't repeated once delivery is wired up.
//
// Two invocation modes:
//   1. Scheduled (cron): a system caller presents `Authorization: Bearer
//      ${CRON_SECRET}`. Processes EVERY organization via the service-role admin
//      client. This path is never user-reachable — it is gated entirely by a
//      server-only secret (Contracts §2: service role is for system jobs, never
//      user-facing routes).
//   2. Interactive: an authenticated user with no secret. Processes ONLY their
//      own organization via the session client (RLS-scoped).

export const runtime = "nodejs";

const THRESHOLDS = [
  { days: 30, flag: "reminder_30d_sent" },
  { days: 14, flag: "reminder_14d_sent" },
  { days: 7, flag: "reminder_7d_sent" },
  { days: 3, flag: "reminder_3d_sent" },
  { days: 1, flag: "reminder_1d_sent" },
] as const;

type ReminderFlag = (typeof THRESHOLDS)[number]["flag"];

type DeadlineRow = {
  id: string;
  organization_id: string;
  title: string;
  due_date: string;
  is_completed: boolean | null;
  reminder_30d_sent: boolean | null;
  reminder_14d_sent: boolean | null;
  reminder_7d_sent: boolean | null;
  reminder_3d_sent: boolean | null;
  reminder_1d_sent: boolean | null;
};

type TriggeredReminder = {
  deadlineId: string;
  organizationId: string;
  title: string;
  dueDate: string;
  daysUntil: number;
  /** Threshold day-marks newly crossed and flagged on this run. */
  remindersSent: number[];
  /** Whether email delivery is enabled for the org (Phase 4 flag). */
  emailDelivered: boolean;
};

function jsonError(message: string, code: string, status: number) {
  // Consistent error shape across API routes (Contracts §16).
  return NextResponse.json({ error: message, code }, { status });
}

const DEADLINE_COLUMNS =
  "id, organization_id, title, due_date, is_completed, reminder_30d_sent, reminder_14d_sent, reminder_7d_sent, reminder_3d_sent, reminder_1d_sent";

/**
 * Marks any reminder thresholds an incomplete deadline has crossed but not yet
 * sent. Returns one entry per deadline that had at least one reminder newly
 * fired. `emailEnabledByOrg` reports whether each org has email delivery on
 * (Phase 4); flags are marked regardless so the work isn't repeated later.
 */
async function processReminders(
  client: SupabaseClient,
  rows: DeadlineRow[],
  emailEnabledByOrg: Map<string, boolean>,
): Promise<{ triggered: TriggeredReminder[]; failures: number }> {
  const today = new Date();
  const triggered: TriggeredReminder[] = [];
  let failures = 0;

  for (const row of rows) {
    if (row.is_completed) continue;

    const daysUntil = differenceInCalendarDays(
      row.due_date.length === 10
        ? new Date(`${row.due_date}T00:00:00`)
        : new Date(row.due_date),
      today,
    );

    const update: Partial<Record<ReminderFlag, boolean>> = {};
    const remindersSent: number[] = [];

    for (const { days, flag } of THRESHOLDS) {
      // The threshold is crossed once we're within `days` of the due date
      // (including overdue), and the flag hasn't already been set.
      if (daysUntil <= days && !row[flag]) {
        update[flag] = true;
        remindersSent.push(days);
      }
    }

    if (remindersSent.length === 0) continue;

    const { error } = await client
      .from("deadlines")
      .update(update)
      .eq("id", row.id);

    if (error) {
      failures += 1;
      continue;
    }

    triggered.push({
      deadlineId: row.id,
      organizationId: row.organization_id,
      title: row.title,
      dueDate: row.due_date,
      daysUntil,
      remindersSent,
      emailDelivered: emailEnabledByOrg.get(row.organization_id) ?? false,
    });
  }

  return { triggered, failures };
}

/** Map of organization_id -> whether `feature.email_integration` is enabled. */
async function loadEmailFlags(
  client: SupabaseClient,
  organizationId?: string,
): Promise<Map<string, boolean>> {
  let query = client
    .from("platform_config")
    .select("organization_id, value")
    .eq("key", "feature.email_integration");
  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data } = await query;
  const map = new Map<string, boolean>();
  for (const row of (data ?? []) as {
    organization_id: string;
    value: string;
  }[]) {
    map.set(row.organization_id, row.value === "true");
  }
  return map;
}

async function runCheck(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const isCron =
    Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;

  if (isCron) {
    // System cron: sweep every organization with the service-role client.
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("deadlines")
      .select(DEADLINE_COLUMNS)
      .or("is_completed.is.null,is_completed.eq.false");
    if (error) {
      return jsonError("Could not load deadlines.", "load_failed", 500);
    }
    const rows = (data ?? []) as DeadlineRow[];
    const emailFlags = await loadEmailFlags(admin);
    const { triggered, failures } = await processReminders(
      admin,
      rows,
      emailFlags,
    );
    return NextResponse.json({
      mode: "cron",
      scope: "all_organizations",
      deadlinesScanned: rows.length,
      remindersTriggered: triggered.length,
      failures,
      triggered,
    });
  }

  // Interactive: authenticate via session and scope to the user's org (RLS is
  // the second barrier on every query). organization_id is derived server-side
  // from the profile, never the request (Contracts §2, §16).
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }
  const organizationId = profile.organization_id as string;

  const { data, error } = await supabase
    .from("deadlines")
    .select(DEADLINE_COLUMNS)
    .eq("organization_id", organizationId)
    .or("is_completed.is.null,is_completed.eq.false");
  if (error) {
    return jsonError("Could not load deadlines.", "load_failed", 500);
  }

  const rows = (data ?? []) as DeadlineRow[];
  const emailFlags = await loadEmailFlags(supabase, organizationId);
  const { triggered, failures } = await processReminders(
    supabase,
    rows,
    emailFlags,
  );

  return NextResponse.json({
    mode: "interactive",
    scope: "organization",
    deadlinesScanned: rows.length,
    remindersTriggered: triggered.length,
    failures,
    triggered,
  });
}

// Vercel Cron issues GET; the interactive UI/manual trigger may use either verb.
export async function GET(request: Request) {
  return runCheck(request);
}

export async function POST(request: Request) {
  return runCheck(request);
}
