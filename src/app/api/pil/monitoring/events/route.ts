import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { getEvents } from "@/lib/pil/monitoring";

// GET /api/pil/monitoring/events -- monitoring events for the org (optionally
// filtered to one prospect). See subscribe/route.ts for the routing note.

export const runtime = "nodejs";

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const prospectId = searchParams.get("prospectId") ?? undefined;

  const events = await getEvents(organizationId, prospectId);
  return NextResponse.json({ events });
}
