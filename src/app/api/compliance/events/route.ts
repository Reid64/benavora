import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET  /api/compliance/events - list compliance_events for the caller's org, sorted by due_date.
// POST /api/compliance/events - create a new compliance event.

export const runtime = "nodejs";

const EVENT_TYPE_VALUES = ["report", "audit", "renewal", "meeting"] as const;

export type ComplianceEvent = {
  id: string;
  organization_id: string;
  application_id: string | null;
  event_type: (typeof EVENT_TYPE_VALUES)[number];
  title: string;
  due_date: string;
  recurrence: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  application_title: string | null;
};

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("compliance_events")
    .select(
      "id, organization_id, application_id, event_type, title, due_date, recurrence, completed_at, notes, created_at, applications(opportunities(title))",
    )
    .eq("organization_id", organizationId)
    .order("due_date", { ascending: true });

  if (error) {
    return jsonError("Failed to load compliance events.", "db_error", 500);
  }

  type Row = {
    id: string;
    organization_id: string;
    application_id: string | null;
    event_type: string;
    title: string;
    due_date: string;
    recurrence: string | null;
    completed_at: string | null;
    notes: string | null;
    created_at: string;
    applications: { opportunities: { title: string } | null } | null;
  };

  const events: ComplianceEvent[] = ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    organization_id: row.organization_id,
    application_id: row.application_id,
    event_type: row.event_type as ComplianceEvent["event_type"],
    title: row.title,
    due_date: row.due_date,
    recurrence: row.recurrence,
    completed_at: row.completed_at,
    notes: row.notes,
    created_at: row.created_at,
    application_title: row.applications?.opportunities?.title ?? null,
  }));

  return NextResponse.json({ data: events });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const {
    application_id: applicationId,
    event_type: eventType,
    title,
    due_date: dueDate,
    recurrence,
    notes,
  } = (raw ?? {}) as {
    application_id?: unknown;
    event_type?: unknown;
    title?: unknown;
    due_date?: unknown;
    recurrence?: unknown;
    notes?: unknown;
  };

  if (
    typeof eventType !== "string" ||
    !EVENT_TYPE_VALUES.includes(eventType as (typeof EVENT_TYPE_VALUES)[number])
  ) {
    return jsonError(`event_type must be one of: ${EVENT_TYPE_VALUES.join(", ")}.`, "invalid_input", 400);
  }
  if (typeof title !== "string" || title.trim() === "") {
    return jsonError("title is required.", "invalid_input", 400);
  }
  if (typeof dueDate !== "string" || dueDate.trim() === "") {
    return jsonError("due_date is required.", "invalid_input", 400);
  }
  if (applicationId !== undefined && applicationId !== null && typeof applicationId !== "string") {
    return jsonError("application_id must be a string.", "invalid_input", 400);
  }

  const { data, error } = await supabase
    .from("compliance_events")
    .insert({
      organization_id: organizationId,
      application_id: typeof applicationId === "string" ? applicationId : null,
      event_type: eventType,
      title: title.trim(),
      due_date: dueDate.trim(),
      recurrence: typeof recurrence === "string" && recurrence.trim() !== "" ? recurrence.trim() : null,
      notes: typeof notes === "string" && notes.trim() !== "" ? notes.trim() : null,
    })
    .select()
    .single();

  if (error) {
    return jsonError("Failed to create compliance event.", "db_error", 500);
  }

  return NextResponse.json({ event: data }, { status: 201 });
}
