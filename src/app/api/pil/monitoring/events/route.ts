import { NextResponse } from "next/server";

import { requirePilRole } from "@/lib/feature-flags/pil";
import { getEvents } from "@/lib/pil/monitoring";

// GET /api/pil/monitoring/events -- monitoring events for the org (optionally
// filtered to one prospect). See subscribe/route.ts for the routing note.

export const runtime = "nodejs";

export async function GET(request: Request) {
  const gate = await requirePilRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const prospectId = searchParams.get("prospectId") ?? undefined;

  const events = await getEvents(organizationId, prospectId);
  return NextResponse.json({ events });
}
