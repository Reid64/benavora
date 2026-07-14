// GET  /api/settings/notifications - the caller's per-event in_app/email
//      preferences (migration 087), filled in with defaults (in_app=true,
//      email=false) for any event type without a saved row.
// POST /api/settings/notifications - upsert the caller's preferences.
// Preferences are always scoped to the authenticated user's own id and
// organization_id (never trusted from the request body - Contracts §2).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { NOTIFICATION_EVENT_TYPES } from "@/lib/services/notification-dispatcher";

export const runtime = "nodejs";

const VALID_EVENT_TYPES = new Set<string>(NOTIFICATION_EVENT_TYPES.map((e) => e.value));

interface PreferenceRow {
  event_type: string;
  in_app: boolean;
  email: boolean;
}

function isValidPreference(value: unknown): value is PreferenceRow {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.event_type === "string" &&
    VALID_EVENT_TYPES.has(v.event_type) &&
    typeof v.in_app === "boolean" &&
    typeof v.email === "boolean"
  );
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, userId, organizationId } = gate;

  const { data, error } = await supabase
    .from("notification_preferences")
    .select("event_type, in_app, email")
    .eq("user_id", userId)
    .eq("organization_id", organizationId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to load notification preferences.", code: "db_error" },
      { status: 500 },
    );
  }

  const saved = new Map((data ?? []).map((row) => [row.event_type, row]));

  const preferences = NOTIFICATION_EVENT_TYPES.map(({ value, label }) => {
    const row = saved.get(value);
    return {
      event_type: value,
      label,
      in_app: row?.in_app ?? true,
      email: row?.email ?? false,
    };
  });

  return NextResponse.json({ preferences });
}

export async function POST(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, userId, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const preferences = (body as Record<string, unknown>).preferences;
  if (!Array.isArray(preferences) || !preferences.every(isValidPreference)) {
    return NextResponse.json(
      {
        error:
          "preferences must be an array of { event_type, in_app, email } with a known event_type.",
      },
      { status: 400 },
    );
  }

  const rows = (preferences as PreferenceRow[]).map((p) => ({
    organization_id: organizationId,
    user_id: userId,
    event_type: p.event_type,
    in_app: p.in_app,
    email: p.email,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("notification_preferences")
    .upsert(rows, { onConflict: "user_id,organization_id,event_type" });

  if (error) {
    return NextResponse.json(
      { error: "Failed to save notification preferences.", code: "db_error" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
