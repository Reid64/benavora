import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import {
  computeRelationshipScore,
  type FunderRelationshipEventType,
} from "@/lib/intelligence/relationship-scorer";

// GET  /api/funders/[id]/relationship - compute and return the funder's
//      event-sourced relationship score + momentum.
// POST /api/funders/[id]/relationship - record a new relationship event.

const EVENT_TYPES: FunderRelationshipEventType[] = [
  "award",
  "application",
  "response",
  "outreach",
  "meeting",
  "rejection",
];

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: funder } = await supabase
    .from("funders")
    .select("id")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!funder) {
    return jsonError("Funder not found.", "not_found", 404);
  }

  let result;
  try {
    result = await computeRelationshipScore(params.id, organizationId, supabase);
  } catch {
    return jsonError("Failed to compute the relationship score.", "score_failed", 500);
  }

  return NextResponse.json({ funderId: params.id, ...result });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const body = await request.json().catch(() => null);
  const eventType = body?.event_type as string | undefined;
  const notes = typeof body?.notes === "string" ? body.notes : null;
  const eventDate = typeof body?.event_date === "string" ? body.event_date : undefined;

  if (!eventType || !EVENT_TYPES.includes(eventType as FunderRelationshipEventType)) {
    return jsonError(
      `event_type must be one of: ${EVENT_TYPES.join(", ")}.`,
      "invalid_event_type",
      400,
    );
  }

  const { data: funder } = await supabase
    .from("funders")
    .select("id")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!funder) {
    return jsonError("Funder not found.", "not_found", 404);
  }

  const { data: event, error } = await supabase
    .from("funder_relationship_events")
    .insert({
      organization_id: organizationId,
      funder_id: params.id,
      event_type: eventType,
      notes,
      ...(eventDate ? { event_date: eventDate } : {}),
    })
    .select()
    .single();

  if (error) {
    return jsonError("Failed to record the relationship event.", "db_error", 500);
  }

  let result;
  try {
    result = await computeRelationshipScore(params.id, organizationId, supabase);
  } catch {
    return jsonError("Failed to compute the relationship score.", "score_failed", 500);
  }

  return NextResponse.json({ event, funderId: params.id, ...result }, { status: 201 });
}
