// PATCH  /api/outreach/templates/[id]/variants/[variantId] — edit a variant's content, and/or
//        activate it as the template's current content variant (`{ activate: true }` deactivates
//        every other variant on this template first, then activates this one — the actual
//        "switch between variants" toggle for the Donor Personalization Engine MVP, row #221).
// DELETE /api/outreach/templates/[id]/variants/[variantId] — remove a content variant.
// Derives organization_id from the authenticated session (never from request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

type RouteContext = { params: { id: string; variantId: string } };

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: variant, error: variantError } = await supabase
    .from("outreach_template_variants")
    .select("id, template_id")
    .eq("id", params.variantId)
    .eq("template_id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (variantError) return jsonError("Failed to load variant.", "db_error", 500);
  if (!variant) return jsonError("Variant not found.", "not_found", 404);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { variant_name, subject_override, body_override, activate } = (raw ?? {}) as {
    variant_name?: unknown;
    subject_override?: unknown;
    body_override?: unknown;
    activate?: unknown;
  };

  if (activate === true) {
    // Deactivate every other variant on this template first — the unique partial index
    // (idx_outreach_template_variants_one_active) enforces at most one active row per
    // template, so activating a new one must clear the old one in the same request.
    const { error: deactivateError } = await supabase
      .from("outreach_template_variants")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("template_id", params.id)
      .eq("organization_id", organizationId)
      .neq("id", params.variantId);
    if (deactivateError) {
      return jsonError("Failed to deactivate other variants.", "db_error", 500);
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof variant_name === "string" && variant_name.trim() !== "") {
    updates.variant_name = variant_name.trim();
  }
  if (typeof subject_override === "string") {
    updates.subject_override = subject_override.trim() === "" ? null : subject_override.trim();
  }
  if (typeof body_override === "string" && body_override.trim() !== "") {
    updates.body_override = body_override.trim();
  }
  if (activate === true) {
    updates.is_active = true;
  } else if (activate === false) {
    updates.is_active = false;
  }

  const { data, error } = await supabase
    .from("outreach_template_variants")
    .update(updates)
    .eq("id", params.variantId)
    .select()
    .single();

  if (error) {
    return jsonError("Failed to update variant.", "db_error", 500);
  }

  return NextResponse.json({ variant: data });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: variant, error: variantError } = await supabase
    .from("outreach_template_variants")
    .select("id")
    .eq("id", params.variantId)
    .eq("template_id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (variantError) return jsonError("Failed to load variant.", "db_error", 500);
  if (!variant) return jsonError("Variant not found.", "not_found", 404);

  const { error } = await supabase
    .from("outreach_template_variants")
    .delete()
    .eq("id", params.variantId);

  if (error) {
    return jsonError("Failed to delete variant.", "db_error", 500);
  }

  return NextResponse.json({ deleted: params.variantId });
}
