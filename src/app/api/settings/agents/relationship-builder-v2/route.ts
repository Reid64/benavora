import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET/PATCH /api/settings/agents/relationship-builder-v2 — owner/admin-only
// toggle for the org-scoped feature.relationship_builder_v2 platform_config
// flag (added in ag19-flag-001; see /settings/agents' Relationship Builder v2
// (Beta) row). No existing route generically handles arbitrary platform_config
// flag toggles (checked: /api/autoapply/usage/keys is hardcoded to its own
// three BYOK keys; /api/automation/queue only reads flags, never writes them)
// so this one is dedicated to this key.
//
// worker/autonomous-orchestrator.ts's 'funder_relationship' queue case reads
// this exact { organization_id, key: 'feature.relationship_builder_v2',
// value } shape: a literal 'true' string routes the event to
// RelationshipBuilderAgent (AGENTS_v2.md AG-19); any other value, or no row
// at all, falls back to the existing FunderRelationshipAgent path. GET
// mirrors that same safe default — no row means enabled: false, never an
// error — so a fresh org reads as OFF rather than failing to load.

export const runtime = "nodejs";

const FLAG_KEY = "feature.relationship_builder_v2";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("platform_config")
    .select("value")
    .eq("organization_id", organizationId)
    .eq("key", FLAG_KEY)
    .maybeSingle();

  if (error) {
    return jsonError("Could not load this setting.", "load_failed", 500);
  }

  return NextResponse.json({ enabled: data?.value === "true" });
}

export async function PATCH(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    typeof (body as Record<string, unknown>).enabled !== "boolean"
  ) {
    return jsonError("enabled must be a boolean.", "invalid_input", 400);
  }

  const enabled = (body as { enabled: boolean }).enabled;

  const { error } = await supabase.from("platform_config").upsert(
    {
      organization_id: organizationId,
      key: FLAG_KEY,
      value: enabled ? "true" : "false",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,key" },
  );

  if (error) {
    return jsonError("Could not save this setting.", "save_failed", 500);
  }

  return NextResponse.json({ enabled });
}
