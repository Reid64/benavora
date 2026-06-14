import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET  /api/notifications  — unread + recent notifications (90-day window)
// POST /api/notifications  — mark as read: { notification_id } or { all: true }
//
// Contracts §32: 90-day retention; in-app channel; org-scoped by RLS + explicit filter.

export const runtime = "nodejs";

const RETENTION_DAYS = 90;

function retentionCutoff(): string {
  const d = new Date();
  d.setDate(d.getDate() - RETENTION_DAYS);
  return d.toISOString();
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("automation_notifications")
    .select(
      "id, event_type, title, message, is_read, sent_via, related_entity_type, related_entity_id, created_at",
    )
    .eq("organization_id", organizationId)
    .gte("created_at", retentionCutoff())
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return jsonError("Could not load notifications.", "db_error", 500);
  }

  const rows = (data ?? []) as Array<{ is_read: boolean }>;
  const unread_count = rows.filter((n) => !n.is_read).length;

  return NextResponse.json({ notifications: data ?? [], unread_count });
}

export async function POST(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "bad_request", 400);
  }

  const { notification_id, all } = (body ?? {}) as {
    notification_id?: string;
    all?: boolean;
  };

  if (!notification_id && !all) {
    return jsonError(
      "Provide notification_id or all=true.",
      "bad_request",
      400,
    );
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
      .eq("id", notification_id!)
      .eq("organization_id", organizationId);

    if (error) {
      return jsonError("Could not mark notification as read.", "db_error", 500);
    }
  }

  return NextResponse.json({ success: true });
}
