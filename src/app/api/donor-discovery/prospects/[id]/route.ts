// GET   /api/donor-discovery/prospects/[id] — single prospect joined with its
//       shared directory record, for the prospect detail page.
// PATCH /api/donor-discovery/prospects/[id] — update pipeline_stage, notes,
//       and/or assigned_to (any subset of the three).
// Derives organization_id from the authenticated session (never the request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

const PIPELINE_STAGES = [
  "new",
  "reviewing",
  "contacted",
  "applied",
  "received",
  "rejected",
  "archived",
] as const;

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { id } = params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  }

  const { data: prospect, error } = await supabase
    .from("donor_discovery_prospects")
    .select("*, directory:donor_discovery_directory(*)")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !prospect) {
    return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  }

  return NextResponse.json({ prospect });
}

function isUuidOrNull(v: unknown): v is string | null {
  return v === null || isUuid(v);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { id } = params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { pipeline_stage, notes, assigned_to } = body as Record<string, unknown>;

  if (pipeline_stage === undefined && notes === undefined && assigned_to === undefined) {
    return NextResponse.json(
      { error: "At least one of pipeline_stage, notes, or assigned_to is required." },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};

  if (pipeline_stage !== undefined) {
    if (
      typeof pipeline_stage !== "string" ||
      !(PIPELINE_STAGES as readonly string[]).includes(pipeline_stage)
    ) {
      return NextResponse.json(
        {
          error: `pipeline_stage must be one of: ${PIPELINE_STAGES.join(", ")}.`,
        },
        { status: 400 },
      );
    }
    update.pipeline_stage = pipeline_stage;
  }

  if (notes !== undefined) {
    if (typeof notes !== "string") {
      return NextResponse.json({ error: "notes must be a string." }, { status: 400 });
    }
    update.notes = notes;
  }

  if (assigned_to !== undefined) {
    if (!isUuidOrNull(assigned_to)) {
      return NextResponse.json(
        { error: "assigned_to must be a profile id or null." },
        { status: 400 },
      );
    }
    update.assigned_to = assigned_to;
  }

  const { data: existing } = await supabase
    .from("donor_discovery_prospects")
    .select("id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  }

  if (update.assigned_to) {
    const { data: assignee } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", update.assigned_to)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!assignee) {
      return NextResponse.json(
        { error: "assigned_to must be a member of your organization." },
        { status: 400 },
      );
    }
  }

  const { error: updateError } = await supabase
    .from("donor_discovery_prospects")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organizationId);

  if (updateError) {
    return NextResponse.json({ error: "Failed to update prospect." }, { status: 500 });
  }

  const { data: updated } = await supabase
    .from("donor_discovery_prospects")
    .select("*, directory:donor_discovery_directory(*)")
    .eq("id", id)
    .single();

  return NextResponse.json({ prospect: updated });
}
