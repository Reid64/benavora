import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { notificationPriority, type NotificationPriority } from "@/lib/notifications/event-meta";
import type { NotificationEventType } from "@/lib/services/notification-dispatcher";
import { sendEmail } from "@/lib/email/resend-client";
import { ctaButton, emailLayout, EMAIL_COLORS } from "@/lib/email/templates/base-layout";

// GET   /api/notifications  — unread + recent notifications (90-day window).
//       ?unread_only=true restricts to unread rows.
//       ?priority=urgent&priority=immediate restricts to those priority tiers
//       (computed from event_type — automation_notifications has no priority
//       column, so this is derived server-side, never stored).
// PATCH /api/notifications  — mark as read: { id } or { all: true }.
// POST  /api/notifications  — create a notification. Internal use by agents/
//       cron only, gated by CRON_SECRET (Contracts §2: service role is for
//       system jobs, never user-facing routes).
//
// Contracts §32: 90-day retention; in-app channel; org-scoped by RLS + explicit filter.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETENTION_DAYS = 90;
const VALID_PRIORITIES: NotificationPriority[] = ["urgent", "immediate", "normal"];

function retentionCutoff(): string {
  const d = new Date();
  d.setDate(d.getDate() - RETENTION_DAYS);
  return d.toISOString();
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unread_only") === "true";
  const priorityFilter = url.searchParams
    .getAll("priority")
    .filter((p): p is NotificationPriority => VALID_PRIORITIES.includes(p as NotificationPriority));

  let query = supabase
    .from("automation_notifications")
    .select(
      "id, event_type, title, message, is_read, sent_via, related_entity_type, related_entity_id, created_at",
    )
    .eq("organization_id", organizationId)
    .gte("created_at", retentionCutoff())
    .order("created_at", { ascending: false })
    .limit(100);

  if (unreadOnly) {
    query = query.eq("is_read", false);
  }

  const { data, error } = await query;

  if (error) {
    return jsonError("Could not load notifications.", "db_error", 500);
  }

  let rows = (data ?? []) as Array<{ event_type: string; is_read: boolean }>;

  if (priorityFilter.length > 0) {
    rows = rows.filter((n) => priorityFilter.includes(notificationPriority(n.event_type)));
  }

  const unread_count = (data ?? []).filter((n) => !(n as { is_read: boolean }).is_read).length;

  return NextResponse.json({ notifications: rows, unread_count });
}

export async function PATCH(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "bad_request", 400);
  }

  const { id, all } = (body ?? {}) as { id?: string; all?: boolean };

  if (!id && !all) {
    return jsonError("Provide id or all=true.", "bad_request", 400);
  }

  if (all) {
    const { error } = await supabase
      .from("automation_notifications")
      .update({ is_read: true })
      .eq("organization_id", organizationId)
      .eq("is_read", false)
      .gte("created_at", retentionCutoff());

    if (error) {
      return jsonError("Could not mark notifications as read.", "db_error", 500);
    }
  } else {
    const { error } = await supabase
      .from("automation_notifications")
      .update({ is_read: true })
      .eq("id", id!)
      .eq("organization_id", organizationId);

    if (error) {
      return jsonError("Could not mark notification as read.", "db_error", 500);
    }
  }

  return NextResponse.json({ success: true });
}

export async function POST(request: Request) {
  // Internal/system creation path — agents and cron jobs have no user session,
  // so this is gated by CRON_SECRET (same pattern as src/app/api/cron/*),
  // never by requireRole(). Contracts §2: service role never user-facing.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return jsonError("Unauthorized.", "unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "bad_request", 400);
  }

  const { organization_id, event_type, title, message, related_entity } = (body ?? {}) as {
    organization_id?: string;
    event_type?: NotificationEventType;
    title?: string;
    message?: string;
    related_entity?: { type: string; id: string };
  };

  if (!organization_id || !event_type || !title) {
    return jsonError(
      "organization_id, event_type, and title are required.",
      "bad_request",
      400,
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
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
    return jsonError("Could not create notification.", "db_error", 500);
  }

  // Real priority model (notificationPriority(), event-meta.tsx) has three
  // tiers — urgent/immediate/normal — not the task-spec's four (immediate/
  // urgent/digest/standard). 'urgent' and 'immediate' both get an email now;
  // 'normal' stays in-app only — the daily digest agent (autonomous-digest-
  // agent.ts / morning-digest.ts) already sweeps automation_notifications
  // independently of this route, so no separate "digest queue" write is
  // needed here.
  const priority = notificationPriority(event_type);
  if (priority === "urgent" || priority === "immediate") {
    const { data: admins } = await admin
      .from("profiles")
      .select("email")
      .eq("organization_id", organization_id)
      .in("role", ["owner", "admin"])
      .limit(5);

    const recipients = ((admins ?? []) as { email: string }[])
      .map((p) => p.email)
      .filter(Boolean);

    if (recipients.length > 0) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://benavora.com";
      const isUrgent = priority === "urgent";
      const headerColor = isUrgent ? "#DC2626" : undefined;

      const bodyHtml = `
        <h1 style="margin:0 0 16px;font-size:20px;font-weight:800;color:${isUrgent ? "#DC2626" : EMAIL_COLORS.textPrimary}">
          ${title}
        </h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${EMAIL_COLORS.textPrimary}">
          ${message ?? title}
        </p>
        ${ctaButton(`${appUrl}/notifications`, "View in Benavora", isUrgent ? "#DC2626" : undefined)}
      `;

      await sendEmail({
        to: recipients,
        subject: isUrgent ? `⚠️ ${title}` : title,
        html: emailLayout({
          headerColor,
          headerLabel: isUrgent ? "Urgent" : "Action Needed",
          bodyHtml,
        }),
      });
    }
  }

  return NextResponse.json({ id: (data as { id: string }).id }, { status: 201 });
}
