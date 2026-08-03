import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { checkRateLimit } from "@/lib/utils/rate-limit";

// POST /api/autonomous/board-packet-trigger - enqueues AG-27 (Board Meeting
// Packet Agent, src/lib/agents/board-packet-agent.ts) as the event-chained
// safety net for a board meeting created or rescheduled with less than 48
// hours' notice, per AGENTS_v2.md's AG-27 spec ("fired when a board_meetings
// row is inserted or its meeting_date is updated to fall within 48 hours of
// right now"). The primary trigger is the daily 2AM CST scheduler pipeline
// (worker/autonomous-orchestrator.ts's runBoardPacketDailyPipeline) - this
// route only exists for the short-notice case that pipeline's once-a-day
// granularity would otherwise miss (a meeting created after that day's run
// with less than 48 hours until it happens).
//
// organization_id is always derived server-side via requireRole, never from
// the request body (Contracts §2). trigger_source='event', the same
// convention as /api/autonomous/followup-trigger and
// /api/autonomous/grant-dna-trigger.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  if (!checkRateLimit(`board-packet-trigger:${userId}`)) {
    return jsonError(
      "Too many board packet triggers. Try again in a bit.",
      "rate_limited",
      429,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { meetingId } = (body ?? {}) as { meetingId?: unknown };

  if (typeof meetingId !== "string" || meetingId.trim() === "") {
    return jsonError("meetingId is required.", "invalid_input", 400);
  }

  const { data: meeting, error: meetingError } = await supabase
    .from("board_meetings")
    .select("id, org_id, meeting_date, status")
    .eq("id", meetingId)
    .eq("org_id", organizationId)
    .maybeSingle();

  if (meetingError || !meeting) {
    return jsonError("Board meeting not found.", "not_found", 404);
  }
  if (meeting.status !== "scheduled") {
    return jsonError(
      "Only scheduled meetings can be queued for a packet.",
      "invalid_state",
      400,
    );
  }

  const meetingDateMs = new Date(`${meeting.meeting_date}T00:00:00.000Z`).getTime();
  const hoursUntilMeeting = (meetingDateMs - Date.now()) / (60 * 60 * 1000);
  if (hoursUntilMeeting > 48 || hoursUntilMeeting < 0) {
    return jsonError(
      "This trigger is only for meetings within 48 hours - the daily scheduled pipeline handles meetings further out.",
      "not_short_notice",
      400,
    );
  }

  const { data, error } = await supabase
    .from("agent_queue")
    .insert({
      org_id: organizationId,
      agent_id: "ag-27-board-packet",
      priority: 7,
      status: "queued",
      trigger_source: "event",
      input_payload: { meetingId },
    })
    .select("id")
    .single();

  if (error || !data) {
    return jsonError(
      "Could not queue the board packet generation run.",
      "queue_failed",
      500,
    );
  }

  return NextResponse.json({ queueItemId: (data as { id: string }).id });
}
