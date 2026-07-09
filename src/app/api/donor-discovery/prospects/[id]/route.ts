// GET   /api/donor-discovery/prospects/[id] — single prospect joined with its
//       shared directory record, for the prospect detail page.
// PATCH /api/donor-discovery/prospects/[id] — update pipeline_stage.
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

  const { pipeline_stage } = body as Record<string, unknown>;
  if (
    typeof pipeline_stage !== "string" ||
    !(PIPELINE_STAGES as readonly string[]).includes(pipeline_stage)
  ) {
    return NextResponse.json(
      {
        error: `pipeline_stage is required and must be one of: ${PIPELINE_STAGES.join(", ")}.`,
      },
      { status: 400 },
    );
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

  const { error: updateError } = await supabase
    .from("donor_discovery_prospects")
    .update({ pipeline_stage })
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
