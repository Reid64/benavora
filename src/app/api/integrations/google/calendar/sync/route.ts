import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import {
  getAuthorizedClient,
  isConnected,
} from "@/lib/integrations/google/auth";
import {
  CalendarSync,
  type DeadlineForSync,
} from "@/lib/integrations/google/calendar";

// Single-deadline calendar sync (BLUEPRINT Phase 4, Contracts §20).
//
//   POST { deadlineId } → create or update the deadline's calendar event and
//   persist google_calendar_event_id on the row. Returns { action, eventId }.
//   Writing a calendar link is a create/edit action, so writer+ (task §6).
//
// Authenticates via the session and derives organization_id server-side from the
// profile - never from the request body. The deadlineId is validated to belong
// to the caller's org before any Google call (Contracts §2, §16).

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: { deadlineId?: unknown } | null = null;
  try {
    body = (await request.json()) as { deadlineId?: unknown };
  } catch {
    return jsonError("Invalid request body.", "bad_request", 400);
  }
  const deadlineId =
    typeof body?.deadlineId === "string" ? body.deadlineId.trim() : "";
  if (!deadlineId) {
    return jsonError("A deadlineId is required.", "missing_deadline_id", 400);
  }

  if (!(await isConnected(organizationId))) {
    return jsonError(
      "Google is not connected. Connect it from Settings first.",
      "not_connected",
      400,
    );
  }

  // Load the deadline within the caller's org (RLS is a second barrier).
  const { data: deadline, error: loadError } = await supabase
    .from("deadlines")
    .select(
      "id, title, description, due_date, deadline_type, google_calendar_event_id, application_id, opportunity_id",
    )
    .eq("id", deadlineId)
    .single();

  if (loadError || !deadline) {
    return jsonError("Deadline not found.", "not_found", 404);
  }

  try {
    const auth = await getAuthorizedClient(organizationId);
    const sync = new CalendarSync({ auth, client: supabase, organizationId });
    const result = await sync.syncDeadline(deadline as DeadlineForSync);
    return NextResponse.json(result);
  } catch {
    return jsonError(
      "Could not sync this deadline to Google Calendar. Try reconnecting Google.",
      "calendar_sync_failed",
      502,
    );
  }
}
