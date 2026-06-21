// GET /api/autoapply/profiles/[id] — fetch a single request profile.
// PUT /api/autoapply/profiles/[id] — update a request profile.
// DELETE /api/autoapply/profiles/[id] — soft-delete (sets active=false).
// All routes scope to the authenticated org and never expose cross-org data.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const VALID_REQUEST_TYPES = [
  "monetary",
  "land",
  "in_kind",
  "volunteer",
  "service",
  "partnership",
  "sponsorship",
  "facility",
] as const;

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, { params }: RouteContext) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("request_profiles")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  return NextResponse.json({ profile: data });
}

export async function PUT(request: Request, { params }: RouteContext) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  if (
    "request_type" in raw &&
    !(VALID_REQUEST_TYPES as readonly string[]).includes(raw.request_type as string)
  ) {
    return NextResponse.json(
      { error: `request_type must be one of: ${VALID_REQUEST_TYPES.join(", ")}.` },
      { status: 400 },
    );
  }

  // Strip immutable fields that must not be overwritten.
  const { id: _id, organization_id: _orgId, created_at: _created, ...safeUpdates } = raw;

  const { data, error } = await supabase
    .from("request_profiles")
    .update({ ...safeUpdates, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to update profile." }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { error } = await supabase
    .from("request_profiles")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("organization_id", organizationId);

  if (error) {
    return NextResponse.json({ error: "Failed to archive profile." }, { status: 500 });
  }

  return NextResponse.json({ archived: true });
}
