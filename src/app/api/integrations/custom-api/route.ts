import { NextResponse } from "next/server";

import { encryptAuthConfig, maskAuthSecret } from "@/lib/agents/custom-api";
import { requireRole } from "@/lib/auth/role-gate";
import {
  AllowlistBlockedError,
  assertDomainAllowed,
} from "@/lib/security/custom-connector-allowlist";

// Custom API Connections — list and create endpoints.
//
// GET  — list all custom_api_connections for the caller's org. The auth
//         secret is never returned: only a `****{last4}` hint, decrypted
//         server-side just long enough to mask it (BEHAVIORAL_CONTRACTS §20).
// POST — create a new connection. Admins and owners only. Requires base_url's
//         hostname to already be on this org's allowlisted domains
//         (custom_connector_allowlist — an admin adds domains separately,
//         under Settings) and that field_mapping includes at least one
//         mapping to "name". The auth secret is AES-256-GCM encrypted before
//         it's ever written to the database.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
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
    return jsonError("Failed to load custom API connections.", "db_error", 500);
  }

  const connections = (data ?? []).map((row) => {
    const { auth_config: _authConfig, ...rest } = row;
    return {
      ...rest,
      auth_key_hint: maskAuthSecret(
        row.auth_type as "none" | "api_key" | "bearer" | "oauth",
        (row.auth_config as Record<string, string> | null) ?? {},
      ),
    };
  });

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

  try {
    await assertDomainAllowed(supabase, organizationId, base_url.trim());
  } catch (err) {
    if (err instanceof AllowlistBlockedError) {
      return jsonError(err.message, "domain_not_allowlisted", 403);
    }
    return jsonError("Could not verify the domain allowlist.", "allowlist_check_failed", 500);
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
      auth_config: encryptAuthConfig(
        resolvedAuthType as "none" | "api_key" | "bearer" | "oauth",
        auth_config && typeof auth_config === "object" && !Array.isArray(auth_config)
          ? (auth_config as Record<string, string>)
          : {},
      ),
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
    return jsonError("Failed to create the custom API connection.", "db_error", 500);
  }

  return NextResponse.json({ connection: data }, { status: 201 });
}
