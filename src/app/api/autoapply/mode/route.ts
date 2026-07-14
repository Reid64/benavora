// GET /api/autoapply/mode  — return the org's current AutoApply mode (manual/semi_auto/autonomous).
// POST /api/autoapply/mode — update the org's AutoApply mode.
// Derives organization_id from the authenticated session (never from request body).
// Only owners may set the org into autonomous mode - enforced here, not just in the UI.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const VALID_MODES = ["manual", "semi_auto", "autonomous"] as const;
type AutoapplyMode = (typeof VALID_MODES)[number];

function isValidMode(value: unknown): value is AutoapplyMode {
  return typeof value === "string" && (VALID_MODES as readonly string[]).includes(value);
}

export async function GET(_request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("org_settings")
    .select("autoapply_mode")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to load AutoApply mode." }, { status: 500 });
  }

  return NextResponse.json({ autoapply_mode: data?.autoapply_mode ?? "manual" });
}

export async function POST(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  const { supabase, organizationId, userRole } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;

  if (!isValidMode(input.autoapply_mode)) {
    return NextResponse.json(
      { error: "autoapply_mode must be one of: manual, semi_auto, autonomous." },
      { status: 400 },
    );
  }

  if (input.autoapply_mode === "autonomous" && userRole !== "owner") {
    return NextResponse.json(
      { error: "Only an owner can enable autonomous mode.", code: "forbidden" },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from("org_settings")
    .upsert(
      {
        organization_id: organizationId,
        autoapply_mode: input.autoapply_mode,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    )
    .select("autoapply_mode")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to save AutoApply mode." }, { status: 500 });
  }

  return NextResponse.json({ autoapply_mode: data.autoapply_mode });
}
