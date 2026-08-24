import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { getPilClient } from "@/lib/pil/db";
import type { ProspectEntityType } from "@/lib/pil/types";

// GET /api/pil/prospects — list org prospects.
// POST /api/pil/prospects — create a prospect.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const { data, error } = await getPilClient()
    .from("pil_prospects")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "active");

  if (error) {
    return jsonError("Failed to load prospects.", "load_failed", 500);
  }

  return NextResponse.json({ prospects: data ?? [] });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  let body: { entityType?: ProspectEntityType; displayName?: string; canonicalName?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  if (!body.entityType || !body.displayName) {
    return jsonError("entityType and displayName are required.", "missing_fields", 400);
  }

  const { data, error } = await getPilClient()
    .from("pil_prospects")
    .insert({
      organization_id: organizationId,
      entity_type: body.entityType,
      display_name: body.displayName,
      canonical_name: body.canonicalName ?? body.displayName,
      status: "active",
      merged_into_prospect_id: null,
      source_of_record: "manual",
      created_by_agent_id: null,
    })
    .select("*")
    .single();

  if (error) {
    return jsonError("Failed to create prospect.", "create_failed", 500);
  }

  return NextResponse.json({ prospect: data }, { status: 201 });
}
