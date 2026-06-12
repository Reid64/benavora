import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAuthorizedClient,
  GOOGLE_PROVIDER,
  isConnected,
} from "@/lib/integrations/google/auth";
import { GmailSync } from "@/lib/integrations/google/gmail";
import type { Enums, TablesInsert } from "@/types/database";

// Deadline reminder sweep (BLUEPRINT §3.1 cron, Contracts §11 reminders + §20
// calendar). Vercel Cron hits this with GET daily at 08:00 UTC (see vercel.json).
//
// This is a SYSTEM job: it sweeps EVERY organization via the service-role admin
// client and is gated solely by the server-only CRON_SECRET. It is never
// user-reachable (Contracts §2: service role is for system jobs, never
// user-facing routes).
//
// For each incomplete deadline, it checks the 30/14/7/3/1-day reminder windows.
// When a window is reached and its reminder flag is still false (Contracts §11:
// "Reminder flags are one-way — once sent, never reset"), the sweep:
//   a. Sets the reminder flag(s) to true.
//   b. If the org has Google connected, emails a reminder via Gmail (Contracts §19).
//   c. Logs the reminder on the deadline's parent record as a note (when one exists).
//
// Every query is organization_id-scoped manually: under the service-role client
// RLS does NOT protect us (Contracts §2, §15).

export const runtime = "nodejs";
// A sweep may email across many orgs; give it headroom beyond the default.
export const maxDuration = 300;

type DeadlineType = Enums<"deadline_type">;

/** Reminder windows (days before due) → the flag column gating each (Contracts §11). */
const REMINDER_FLAGS: { days: number; column: ReminderColumn }[] = [
  { days: 30, column: "reminder_30d_sent" },
  { days: 14, column: "reminder_14d_sent" },
  { days: 7, column: "reminder_7d_sent" },
  { days: 3, column: "reminder_3d_sent" },
  { days: 1, column: "reminder_1d_sent" },
];

type ReminderColumn =
  | "reminder_30d_sent"
  | "reminder_14d_sent"
  | "reminder_7d_sent"
  | "reminder_3d_sent"
  | "reminder_1d_sent";

interface DeadlineRow {
  id: string;
  organization_id: string;
  title: string;
  due_date: string;
  deadline_type: DeadlineType;
  application_id: string | null;
  opportunity_id: string | null;
  reminder_30d_sent: boolean | null;
  reminder_14d_sent: boolean | null;
  reminder_7d_sent: boolean | null;
  reminder_3d_sent: boolean | null;
  reminder_1d_sent: boolean | null;
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Whole calendar days from today (UTC) until a "yyyy-MM-dd" due date. */
function daysUntil(dueDate: string): number {
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`);
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  return Math.round((due - todayUtc) / (24 * 60 * 60 * 1000));
}

async function runSweep(request: Request) {
  // System-only: gate entirely on the server-only CRON_SECRET. When the secret
  // is unset, refuse every call rather than running unauthenticated.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized.", "unauthorized", 401);
  }

  const admin = createAdminClient();

  // All incomplete deadlines across every org. Reminders fire only within the
  // 30-day window, so bound the scan to deadlines due within ~31 days.
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + 31);
  const horizonDate = horizon.toISOString().slice(0, 10);

  const { data, error } = await admin
    .from("deadlines")
    .select(
      "id, organization_id, title, due_date, deadline_type, application_id, opportunity_id, reminder_30d_sent, reminder_14d_sent, reminder_7d_sent, reminder_3d_sent, reminder_1d_sent",
    )
    .eq("is_completed", false)
    .lte("due_date", horizonDate);

  if (error) {
    return jsonError("Could not load deadlines.", "load_failed", 500);
  }

  const deadlines = (data ?? []) as DeadlineRow[];

  let remindersFired = 0;
  let emailsSent = 0;
  let notesLogged = 0;
  let errors = 0;
  const deadlinesChecked = deadlines.length;

  // Cache per-org email capability + Gmail client across deadlines.
  const gmailCache = new Map<string, GmailSyncEntry>();

  for (const deadline of deadlines) {
    const days = daysUntil(deadline.due_date);

    // Windows reached at the current distance, and which of those are unsent.
    const reached = REMINDER_FLAGS.filter((r) => days <= r.days);
    const unsent = reached.filter((r) => !deadline[r.column]);
    if (unsent.length === 0) continue;

    // Flip every reached-but-unsent flag (older, looser windows that were never
    // fired are caught up silently — flags are one-way, Contracts §11).
    const patch: Record<string, boolean> = {};
    for (const r of unsent) patch[r.column] = true;

    const { error: updateError } = await admin
      .from("deadlines")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", deadline.id)
      .eq("organization_id", deadline.organization_id);

    if (updateError) {
      errors += 1;
      continue;
    }
    remindersFired += 1;

    // The single most-urgent reached window drives the human-facing message.
    const tightest = Math.min(...reached.map((r) => r.days));

    // Email the operator if the org has Gmail connected (Contracts §19/§20).
    const gmail = await resolveGmail(admin, deadline.organization_id, gmailCache);
    if (gmail) {
      try {
        await gmail.client.sendEmail({
          to: gmail.email,
          subject: reminderSubject(deadline, tightest),
          body: reminderBody(deadline, tightest),
        });
        emailsSent += 1;
      } catch {
        errors += 1;
      }
    }

    // Log the reminder on the parent record (note CHECK requires exactly one parent).
    if (await logReminderNote(admin, deadline, tightest)) {
      notesLogged += 1;
    }
  }

  return NextResponse.json({
    mode: "cron",
    scope: "all_organizations",
    deadlinesChecked,
    remindersFired,
    emailsSent,
    notesLogged,
    errors,
  });
}

interface GmailSyncEntry {
  client: GmailSync;
  email: string;
}

/**
 * Resolve a sending Gmail client + recipient for an org, cached per sweep.
 * Returns null when the org has no usable Google connection or connected email,
 * so reminder flags/notes still apply without email.
 */
async function resolveGmail(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  cache: Map<string, GmailSyncEntry>,
): Promise<GmailSyncEntry | null> {
  if (cache.has(organizationId)) return cache.get(organizationId) ?? null;

  let entry: GmailSyncEntry | null = null;
  try {
    if (await isConnected(organizationId, admin)) {
      const { data } = await admin
        .from("integrations")
        .select("connected_email")
        .eq("organization_id", organizationId)
        .eq("provider", GOOGLE_PROVIDER)
        .maybeSingle();
      const email = (data?.connected_email as string | null) ?? null;
      if (email) {
        const auth = await getAuthorizedClient(organizationId, admin);
        entry = { client: new GmailSync(auth), email };
      }
    }
  } catch {
    entry = null;
  }

  // Cache null too — don't retry a failed/absent connection for every deadline.
  cache.set(organizationId, entry as GmailSyncEntry);
  return entry;
}

function whenPhrase(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function reminderSubject(deadline: DeadlineRow, days: number): string {
  return `Reminder: "${deadline.title}" is due ${whenPhrase(days)}`;
}

function reminderBody(deadline: DeadlineRow, days: number): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const link = deadline.application_id
    ? base && `${base}/applications/${deadline.application_id}`
    : deadline.opportunity_id
      ? base && `${base}/opportunities/${deadline.opportunity_id}`
      : "";
  const lines = [
    `This is a reminder from Benavora.`,
    ``,
    `"${deadline.title}" is due ${whenPhrase(days)} (${deadline.due_date.slice(0, 10)}).`,
  ];
  if (link) lines.push(``, `View it here: ${link}`);
  return lines.join("\n");
}

/**
 * Append a note recording the reminder on the deadline's parent. The notes
 * CHECK requires exactly one parent FK, so deadlines with neither an application
 * nor an opportunity are skipped (returns false).
 */
async function logReminderNote(
  admin: ReturnType<typeof createAdminClient>,
  deadline: DeadlineRow,
  days: number,
): Promise<boolean> {
  if (!deadline.application_id && !deadline.opportunity_id) return false;

  const row: TablesInsert<"notes"> = {
    organization_id: deadline.organization_id,
    application_id: deadline.application_id,
    opportunity_id: deadline.application_id ? null : deadline.opportunity_id,
    content: `Reminder sent: "${deadline.title}" is due ${whenPhrase(days)} (${deadline.due_date.slice(0, 10)}).`,
    author_id: null,
  };

  const { error } = await admin.from("notes").insert(row);
  return !error;
}

// Vercel Cron issues GET. POST is accepted too for manual/ops invocation behind
// the same secret.
export async function GET(request: Request) {
  return runSweep(request);
}

export async function POST(request: Request) {
  return runSweep(request);
}
