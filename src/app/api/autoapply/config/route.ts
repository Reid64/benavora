// GET /api/autoapply/config  — return current autonomous queue config for the org.
// POST /api/autoapply/config — upsert autonomous queue config.
// Derives organization_id from the authenticated session (never from request body).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

export async function GET(_request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("auto_queue_config")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to load config." }, { status: 500 });
  }

  return NextResponse.json({ config: data });
}

export async function POST(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;

  const payload = {
    organization_id: organizationId,
    enabled: typeof input.enabled === "boolean" ? input.enabled : false,
    max_per_batch: typeof input.max_per_batch === "number" ? Math.max(1, Math.min(500, input.max_per_batch)) : 50,
    schedule: typeof input.schedule === "string" ? input.schedule : "nightly",
    categories: Array.isArray(input.categories) ? (input.categories as string[]) : null,
    geographic_scope: Array.isArray(input.geographic_scope) ? (input.geographic_scope as string[]) : null,
    min_company_size: typeof input.min_company_size === "string" && input.min_company_size ? input.min_company_size : null,
    exclusion_list: Array.isArray(input.exclusion_list) ? (input.exclusion_list as string[]) : null,
    dedup_window_days: typeof input.dedup_window_days === "number" ? input.dedup_window_days : 30,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("auto_queue_config")
    .upsert(payload, { onConflict: "organization_id" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to save config." }, { status: 500 });
  }

  return NextResponse.json({ config: data });
}
