import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// Custom API Connections — list and create endpoints.
//
// GET  — list all custom_api_connections for the caller's org. auth_config
//         secrets are masked before returning to the client: the key/token
//         field is replaced with ****{last4} (BEHAVIORAL_CONTRACTS §20).
// POST — create a new connection. Admins and owners only. Validates that
//         field_mapping includes at least one mapping to "name".

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function maskAuthConfig(
  authType: string,
  authConfig: Record<string, string> | null,
): Record<string, string> {
  if (!authConfig || authType === "none") return {};
  const masked = { ...authConfig };
  const secretField = authType === "api_key" ? "key" : "token";
  const raw = masked[secretField] ?? "";
  if (raw) masked[secretField] = `****${raw.slice(-4) || "xxxx"}`;
  return masked;
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("custom_api_connections")
    .select(
      "id, name, base_url, auth_type, auth_config, field_mapping, poll_schedule, is_active, last_polled_at, last_success_at, error_count, created_at",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const connections = (data ?? []).map((row) => ({
    ...row,
    auth_config: maskAuthConfig(
      row.auth_type as string,
      row.auth_config as Record<string, string> | null,
    ),
  }));

  return NextResponse.json({ connections });
}

export async function POST(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  const {
    name,
    base_url,
    auth_type,
    auth_config,
    field_mapping,
    poll_schedule,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return jsonError("name is required.", "missing_field", 400);
  }
  if (typeof base_url !== "string" || !base_url.trim()) {
    return jsonError("base_url is required.", "missing_field", 400);
  }

  const validAuthTypes = ["none", "api_key", "bearer", "oauth"];
  const resolvedAuthType =
    typeof auth_type === "string" && validAuthTypes.includes(auth_type)
      ? auth_type
      : "none";

  const validSchedules = ["hourly", "daily", "weekly", "monthly"];
  const resolvedSchedule =
    typeof poll_schedule === "string" && validSchedules.includes(poll_schedule)
      ? poll_schedule
      : "daily";

  // field_mapping must include at least one value of "name" (Contracts §20).
  const mappingObj =
    typeof field_mapping === "object" && field_mapping !== null &&
    !Array.isArray(field_mapping)
      ? (field_mapping as Record<string, unknown>)
      : {};
  const hasNameMapping = Object.values(mappingObj).includes("name");
  if (!hasNameMapping) {
    return jsonError(
      'field_mapping must include a mapping to "name" (opportunity name).',
      "missing_name_mapping",
      400,
    );
  }

  const { data, error } = await supabase
    .from("custom_api_connections")
    .insert({
      organization_id: organizationId,
      name: name.trim(),
      base_url: base_url.trim(),
      auth_type: resolvedAuthType,
      auth_config:
        auth_config && typeof auth_config === "object" && !Array.isArray(auth_config)
          ? auth_config
          : {},
      field_mapping: mappingObj,
      poll_schedule: resolvedSchedule,
      is_active: true,
      error_count: 0,
    })
    .select(
      "id, name, base_url, auth_type, field_mapping, poll_schedule, is_active, error_count, created_at",
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ connection: data }, { status: 201 });
}
