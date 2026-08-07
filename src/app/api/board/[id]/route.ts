import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import type { Tables } from "@/types/database";

// GET /api/board/[id] — Board Member detail (FEATURE_REGISTRY_v2.md row
// #138, "Board Member Portal"), backing /board/[id].
//
// Deliberately narrower than a per-member self-service login portal — read
// this before extending scope. Real, confirmed-live schema (board-packet-
// agent.ts's header, re-confirmed this session): board_members has no
// auth-identity column at all (no user_id/profile_id/login-token), and the
// live user_role enum (migration 001) has no "board_member" role — there is
// no way today for an actual board member to log in as themselves distinct
// from an org staff account. Separately, board_meetings/board_meeting_packets
// carry only org_id, never a per-member attendee/invite row linking a
// specific board_members.id to a specific meeting — no join table exists
// anywhere in either migration tree. Given both gaps, this route is a
// staff-facing "board member profile + this org's packets" view: it loads
// ALL of the calling org's board_meeting_packets (org-scoped, not
// invite-scoped, since no invite relationship exists to scope by), not a
// per-member filtered set. A real per-meeting invite/attendee join table and
// real board-member auth are separate, larger follow-on projects, not
// papered over here with a fabricated invite check or login flow.
//
// organization_id is derived server-side via requireRole, never trusted
// from the client (Contracts §2) — the board member id in the URL is looked
// up scoped to that organization_id, so requesting another org's board
// member id 404s rather than leaking cross-org data.

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

interface BoardMeetingRow {
  id: string;
  org_id: string;
  meeting_date: string;
  meeting_type: string;
  agenda: string | null;
  status: string;
}

interface BoardMeetingPacketRow {
  id: string;
  org_id: string;
  meeting_id: string | null;
  packet_content: Record<string, unknown>;
  generated_at: string;
  viewed_by: string[] | null;
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const memberId = params.id;
  if (!memberId || typeof memberId !== "string") {
    return jsonError("Board member id is required.", "invalid_input", 400);
  }

  const { data: memberRow, error: memberError } = await supabase
    .from("board_members")
    .select("*")
    .eq("id", memberId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (memberError) {
    return jsonError(
      "Could not load this board member.",
      "member_load_failed",
      500,
    );
  }
  if (!memberRow) {
    return jsonError("Board member not found.", "not_found", 404);
  }
  const member = memberRow as Tables<"board_members">;

  // board_meetings/board_meeting_packets predate the generated Supabase
  // types (migration 078, applied directly — see database.ts staleness note
  // in project memory), so both are read with a manual Row shape and cast,
  // matching board-packet-agent.ts's own established pattern rather than a
  // Tables<...> generic that doesn't exist for these two tables.
  const { data: packetRows, error: packetError } = await supabase
    .from("board_meeting_packets")
    .select("id, org_id, meeting_id, packet_content, generated_at, viewed_by")
    .eq("org_id", organizationId)
    .order("generated_at", { ascending: false });
  if (packetError) {
    return jsonError(
      "Could not load board meeting packets.",
      "packets_load_failed",
      500,
    );
  }
  const packets = (packetRows ?? []) as BoardMeetingPacketRow[];

  const meetingIds = packets
    .map((p) => p.meeting_id)
    .filter((id): id is string => typeof id === "string");

  let meetingsById = new Map<string, BoardMeetingRow>();
  if (meetingIds.length > 0) {
    const { data: meetingRows, error: meetingError } = await supabase
      .from("board_meetings")
      .select("id, org_id, meeting_date, meeting_type, agenda, status")
      .in("id", meetingIds);
    if (meetingError) {
      return jsonError(
        "Could not load board meetings.",
        "meetings_load_failed",
        500,
      );
    }
    meetingsById = new Map(
      ((meetingRows ?? []) as BoardMeetingRow[]).map((m) => [m.id, m]),
    );
  }

  const packetsOut = packets.map((p) => ({
    id: p.id,
    meetingId: p.meeting_id,
    meeting: p.meeting_id ? (meetingsById.get(p.meeting_id) ?? null) : null,
    packetContent: p.packet_content,
    generatedAt: p.generated_at,
    viewedBy: p.viewed_by ?? [],
  }));

  return NextResponse.json({ member, packets: packetsOut });
}
