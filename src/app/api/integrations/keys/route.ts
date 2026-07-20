import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { decryptKey, encryptKey } from "@/lib/crypto/key-encrypt";
import type { Enums } from "@/types/database";

export const runtime = "nodejs";

// GET — return all integration key statuses (masked) for the caller's org.
// Viewers and above can see which services are configured. Keys are never
// returned in plaintext; only ****{last4} is exposed.
export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("integration_keys")
    .select(
      "id, service_name, is_active, last_validated_at, validation_status, encrypted_key, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .order("service_name");

  if (error) {
    return NextResponse.json({ error: "Failed to load integration keys.", code: "db_error" }, { status: 500 });
  }

  const masked = (data ?? []).map((row) => {
    let keyHint = "****xxxx";
    try {
      const plain = decryptKey(row.encrypted_key);
      keyHint = `****${plain.slice(-4) || "xxxx"}`;
    } catch {
      // Auth-tag failure means a different INTEGRATION_KEY_SECRET was used.
      // Show generic mask rather than crashing.
    }
    return {
      id: row.id,
      service_name: row.service_name,
      is_active: row.is_active,
      last_validated_at: row.last_validated_at,
      validation_status: row.validation_status,
      key_hint: keyHint,
      created_at: row.created_at,
    };
  });

  return NextResponse.json({ keys: masked });
}

// POST — save or update an API key for a given service.
// Body: { service_name: integration_service; api_key: string }
// Only admins and owners may set keys (writers/viewers cannot).
export async function POST(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body.", code: "invalid_body" },
      { status: 400 },
    );
  }

  const { service_name, api_key } = (body ?? {}) as {
    service_name?: unknown;
    api_key?: unknown;
  };

  if (typeof service_name !== "string" || !service_name.trim()) {
    return NextResponse.json(
      { error: "service_name is required.", code: "missing_field" },
      { status: 400 },
    );
  }
  if (typeof api_key !== "string" || !api_key.trim()) {
    return NextResponse.json(
      { error: "api_key is required.", code: "missing_field" },
      { status: 400 },
    );
  }

  const validServices: Enums<"integration_service">[] = [
    "sam_gov",
    "two_captcha",
    "candid",
    "gmail",
    "gcal",
    "resend",
    "custom_api",
  ];
  if (!validServices.includes(service_name as Enums<"integration_service">)) {
    return NextResponse.json(
      { error: "Unknown service_name.", code: "invalid_service" },
      { status: 400 },
    );
  }

  const encrypted = encryptKey(api_key.trim());
  const keyHint = `****${api_key.trim().slice(-4) || "xxxx"}`;

  const { data, error } = await supabase
    .from("integration_keys")
    .upsert(
      {
        organization_id: organizationId,
        service_name: service_name as Enums<"integration_service">,
        encrypted_key: encrypted,
        is_active: true,
        validation_status: "pending",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,service_name" },
    )
    .select("id, service_name, is_active, validation_status, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to save the API key.", code: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ success: true, key: { ...data, key_hint: keyHint } });
}
