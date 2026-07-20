// Scraping Targets — single-resource endpoints.
//
// PATCH — update is_active or scrape_schedule. Admins and owners only.
// DELETE — permanently delete the target. Admins and owners only.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const id = params.id;
  if (!id) return jsonError("id is required.", "missing_param", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const incoming = (body ?? {}) as Record<string, unknown>;

  if (typeof incoming.is_active === "boolean") {
    patch.is_active = incoming.is_active;
    if (incoming.is_active) patch.failure_count = 0;
  }

  const validSchedules = ["hourly", "daily", "weekly", "monthly"];
  if (
    typeof incoming.scrape_schedule === "string" &&
    validSchedules.includes(incoming.scrape_schedule)
  ) {
    patch.scrape_schedule = incoming.scrape_schedule;
  }

  const { error } = await supabase
    .from("scraping_targets")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", organizationId);

  if (error) {
    return jsonError("Failed to update the scraping target.", "db_error", 500);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const id = params.id;
  if (!id) return jsonError("id is required.", "missing_param", 400);

  const { error } = await supabase
    .from("scraping_targets")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId);

  if (error) {
    return jsonError("Failed to delete the scraping target.", "db_error", 500);
  }

  return NextResponse.json({ ok: true });
}
