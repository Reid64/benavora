// GET  /api/outreach/templates/[id]/variants — list an outreach template's content variants.
// POST /api/outreach/templates/[id]/variants — create a new named content variant (max 3 per
//      template — this is the scoped-down Donor Personalization Engine MVP, row #221: an
//      org-configurable content-variant toggle, not visitor-detection-driven personalization).
// Derives organization_id from the authenticated session (never from request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const MAX_VARIANTS_PER_TEMPLATE = 3;

type RouteContext = { params: { id: string } };

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(_request: Request, { params }: RouteContext) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: template, error: templateError } = await supabase
    .from("outreach_templates")
    .select("id")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (templateError) return jsonError("Failed to load template.", "db_error", 500);
  if (!template) return jsonError("Template not found.", "not_found", 404);

  const { data, error } = await supabase
    .from("outreach_template_variants")
    .select("*")
    .eq("template_id", params.id)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) {
    return jsonError("Failed to load template variants.", "db_error", 500);
  }

  return NextResponse.json({ variants: data ?? [] });
}

export async function POST(request: Request, { params }: RouteContext) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: template, error: templateError } = await supabase
    .from("outreach_templates")
    .select("id")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (templateError) return jsonError("Failed to load template.", "db_error", 500);
  if (!template) return jsonError("Template not found.", "not_found", 404);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { variant_name, subject_override, body_override } = (raw ?? {}) as {
    variant_name?: unknown;
    subject_override?: unknown;
    body_override?: unknown;
  };

  if (typeof variant_name !== "string" || variant_name.trim() === "") {
    return jsonError("variant_name is required.", "invalid_input", 400);
  }
  if (typeof body_override !== "string" || body_override.trim() === "") {
    return jsonError("body_override is required.", "invalid_input", 400);
  }

  const { count, error: countError } = await supabase
    .from("outreach_template_variants")
    .select("id", { count: "exact", head: true })
    .eq("template_id", params.id);

  if (countError) {
    return jsonError("Failed to check existing variants.", "db_error", 500);
  }
  if ((count ?? 0) >= MAX_VARIANTS_PER_TEMPLATE) {
    return jsonError(
      `A template may have at most ${MAX_VARIANTS_PER_TEMPLATE} content variants.`,
      "variant_limit_reached",
      422,
    );
  }

  const { data, error } = await supabase
    .from("outreach_template_variants")
    .insert({
      template_id: params.id,
      organization_id: organizationId,
      variant_name: variant_name.trim(),
      subject_override:
        typeof subject_override === "string" && subject_override.trim() !== ""
          ? subject_override.trim()
          : null,
      body_override: body_override.trim(),
    })
    .select()
    .single();

  if (error) {
    return jsonError("Failed to create template variant.", "db_error", 500);
  }

  return NextResponse.json({ variant: data }, { status: 201 });
}
