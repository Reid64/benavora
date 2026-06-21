// GET /api/autoapply/profiles — list all request profiles for the org, ordered by priority.
// POST /api/autoapply/profiles — create a new request profile.
// Derives organization_id from the authenticated session (never from request body).

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

type RequestType = (typeof VALID_REQUEST_TYPES)[number];

function isValidRequestType(v: unknown): v is RequestType {
  return (
    typeof v === "string" &&
    (VALID_REQUEST_TYPES as readonly string[]).includes(v)
  );
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data: profiles, error } = await supabase
    .from("request_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load profiles." }, { status: 500 });
  }

  // Tally submission counts and success counts per request_type for this org.
  const { data: allSubs } = await supabase
    .from("autoapply_submissions")
    .select("request_type, status")
    .eq("organization_id", organizationId);

  const totalByType = new Map<string, number>();
  const successByType = new Map<string, number>();

  for (const s of allSubs ?? []) {
    if (!s.request_type) continue;
    totalByType.set(s.request_type, (totalByType.get(s.request_type) ?? 0) + 1);
    if (s.status === "submitted") {
      successByType.set(s.request_type, (successByType.get(s.request_type) ?? 0) + 1);
    }
  }

  const enriched = (profiles ?? []).map((p) => {
    const total = totalByType.get(p.request_type) ?? 0;
    const success = successByType.get(p.request_type) ?? 0;
    const success_rate = total > 0 ? Math.round((success / total) * 100) : null;
    return { ...p, submission_count: total, success_rate };
  });

  return NextResponse.json({ profiles: enriched });
}

export async function POST(request: Request) {
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

  const {
    name,
    request_type,
    needs_description,
    priority,
    active,
    specific_requirements,
    target_funder_categories,
    target_funder_types,
    pitch_template,
    form_field_overrides,
    success_criteria,
    min_value,
    max_value,
    value_unit,
    geographic_requirements,
  } = raw;

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  if (!isValidRequestType(request_type)) {
    return NextResponse.json(
      {
        error: `request_type must be one of: ${VALID_REQUEST_TYPES.join(", ")}.`,
      },
      { status: 400 },
    );
  }
  if (typeof needs_description !== "string" || needs_description.trim().length === 0) {
    return NextResponse.json({ error: "needs_description is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("request_profiles")
    .insert({
      organization_id: organizationId,
      name: name.trim(),
      request_type,
      needs_description: needs_description.trim(),
      priority: typeof priority === "number" ? priority : 100,
      active: typeof active === "boolean" ? active : true,
      specific_requirements:
        specific_requirements != null && typeof specific_requirements === "object"
          ? specific_requirements
          : {},
      target_funder_categories: Array.isArray(target_funder_categories)
        ? (target_funder_categories as string[])
        : null,
      target_funder_types: Array.isArray(target_funder_types)
        ? (target_funder_types as string[])
        : null,
      pitch_template: typeof pitch_template === "string" ? pitch_template.trim() || null : null,
      form_field_overrides:
        form_field_overrides != null && typeof form_field_overrides === "object"
          ? form_field_overrides
          : {},
      success_criteria:
        typeof success_criteria === "string" ? success_criteria.trim() || null : null,
      min_value: typeof min_value === "number" ? min_value : null,
      max_value: typeof max_value === "number" ? max_value : null,
      value_unit: typeof value_unit === "string" && value_unit.trim() ? value_unit.trim() : "usd",
      geographic_requirements:
        geographic_requirements != null && typeof geographic_requirements === "object"
          ? geographic_requirements
          : null,
    })
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to create profile." }, { status: 500 });
  }

  return NextResponse.json({ profile: data }, { status: 201 });
}
