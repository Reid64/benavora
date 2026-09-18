import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { ProspectManager } from "@/lib/admin/prospect-manager";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const { id } = params;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Prospect not found.", code: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ prospect: data });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  let body: {
    status?: string;
    suppressed?: boolean;
    suppressed_reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body.", code: "bad_request" },
      { status: 400 },
    );
  }

  const { id } = params;
  const patch: Record<string, unknown> = {};

  if (body.status !== undefined) patch.status = body.status;
  if (body.suppressed !== undefined) {
    patch.suppressed = body.suppressed;
    if (body.suppressed) {
      patch.suppressed_reason = body.suppressed_reason ?? null;
      patch.suppressed_at = new Date().toISOString();
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No fields to update.", code: "no_changes" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("prospects")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Prospect not found or update failed.", code: "update_failed" },
      { status: error ? 500 : 404 },
    );
  }

  return NextResponse.json({ prospect: data });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const { id } = params;
  const supabase = createAdminClient();

  const { data: existing, error: fetchError } = await supabase
    .from("prospects")
    .select("email")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json(
      { error: "Prospect not found.", code: "not_found" },
      { status: 404 },
    );
  }

  const email = (existing as { email: string | null }).email;
  if (email) {
    try {
      const manager = new ProspectManager();
      await manager.suppressProspect(email, "deleted_by_admin", "admin");
    } catch {
      // non-fatal; prospects update below covers the suppressed flag
    }
  }

  const { data, error } = await supabase
    .from("prospects")
    .update({
      status: "inactive",
      suppressed: true,
      suppressed_reason: "deleted_by_admin",
      suppressed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to deactivate prospect.", code: "delete_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ prospect: data });
}
