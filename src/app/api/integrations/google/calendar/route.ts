import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import {
  getAuthorizedClient,
  isConnected,
} from "@/lib/integrations/google/auth";
import {
  CalendarSync,
  type CalendarInfo,
} from "@/lib/integrations/google/calendar";

// Calendar sync status + bulk sync (BLUEPRINT Phase 4, Contracts §20).
//
//   GET  → { connected, calendars, syncedCount } for the caller's org (any
//          authenticated role - read access).
//   POST → run a full sync of all incomplete deadlines to the calendar,
//          returning { synced, created, updated, errors }. A sync writes calendar
//          links - a create/edit action, so writer+ (task §6).
//
// Both authenticate via the session and derive organization_id server-side from
// the profile - never from the request body (Contracts §2, §16).

export const runtime = "nodejs";
// A full sync touches every incomplete deadline; give it room beyond the default.
export const maxDuration = 120;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// Per-org rate limit, mirroring the Gmail sync route (in-memory; a shared store
// is the production fix for multi-instance deployments).
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function isRateLimited(orgId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(orgId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(orgId, recent);
    return true;
  }
  recent.push(now);
  hits.set(orgId, recent);
  return false;
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  // How many of this org's deadlines are already linked to a calendar event
  // (RLS scopes the count to the caller's org).
  const { count: syncedCount } = await supabase
    .from("deadlines")
    .select("id", { count: "exact", head: true })
    .not("google_calendar_event_id", "is", null);

  if (!(await isConnected(organizationId))) {
    return NextResponse.json({
      connected: false,
      calendars: [] as CalendarInfo[],
      syncedCount: syncedCount ?? 0,
    });
  }

  let calendars: CalendarInfo[] = [];
  try {
    const auth = await getAuthorizedClient(organizationId);
    const sync = new CalendarSync({ auth, client: supabase, organizationId });
    calendars = await sync.listCalendars();
  } catch {
    // Connected but the calendar list call failed (revoked scope, transient
    // outage). Report connected with an empty list rather than 500ing.
    calendars = [];
  }

  return NextResponse.json({
    connected: true,
    calendars,
    syncedCount: syncedCount ?? 0,
  });
}

export async function POST() {
  // A sync writes calendar links to deadlines - a create/edit action (task §6).
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many sync requests. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  if (!(await isConnected(organizationId))) {
    return jsonError(
      "Google is not connected. Connect it from Settings first.",
      "not_connected",
      400,
    );
  }

  try {
    const auth = await getAuthorizedClient(organizationId);
    const sync = new CalendarSync({ auth, client: supabase, organizationId });
    const result = await sync.syncAllDeadlines();
    return NextResponse.json(result);
  } catch {
    return jsonError(
      "Could not sync deadlines to Google Calendar. Try reconnecting Google.",
      "calendar_sync_failed",
      502,
    );
  }
}
