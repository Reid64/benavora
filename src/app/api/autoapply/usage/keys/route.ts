// GET  /api/autoapply/usage/keys — return own-key status for the current org
// POST /api/autoapply/usage/keys — save an API key { type: "anthropic"|"openai", key: string }
// PATCH /api/autoapply/usage/keys — toggle using_own_keys { using_own_keys: boolean }
//
// Keys are stored in platform_config as:
//   key = "own_key_anthropic" | "own_key_openai" | "own_keys_enabled"
//   value = the encrypted key text (plaintext for now; swap for AES at encryption layer)

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const KEY_ANTHROPIC = "own_key_anthropic";
const KEY_OPENAI = "own_key_openai";
const KEY_ENABLED = "own_keys_enabled";

export async function GET(_req: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  const { supabase, organizationId } = gate;

  const { data: rows } = await supabase
    .from("platform_config")
    .select("key, value")
    .eq("organization_id", organizationId)
    .in("key", [KEY_ANTHROPIC, KEY_OPENAI, KEY_ENABLED]);

  const rowMap = Object.fromEntries(
    (rows ?? []).map((r) => [r.key, r.value]),
  );

  return NextResponse.json({
    using_own_keys: rowMap[KEY_ENABLED] === "true",
    has_anthropic: !!rowMap[KEY_ANTHROPIC],
    has_openai: !!rowMap[KEY_OPENAI],
  });
}

export async function POST(req: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  const { supabase, organizationId } = gate;

  const body = (await req.json().catch(() => ({}))) as {
    type?: string;
    key?: string;
  };

  if (
    (body.type !== "anthropic" && body.type !== "openai") ||
    !body.key ||
    typeof body.key !== "string"
  ) {
    return NextResponse.json(
      { error: "type must be 'anthropic' or 'openai' and key must be a non-empty string." },
      { status: 400 },
    );
  }

  const configKey = body.type === "anthropic" ? KEY_ANTHROPIC : KEY_OPENAI;

  const { error } = await supabase.from("platform_config").upsert(
    {
      organization_id: organizationId,
      key: configKey,
      value: body.key,
    },
    { onConflict: "organization_id,key" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(req: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  const { supabase, organizationId } = gate;

  const body = (await req.json().catch(() => ({}))) as {
    using_own_keys?: boolean;
  };

  if (typeof body.using_own_keys !== "boolean") {
    return NextResponse.json(
      { error: "using_own_keys must be a boolean." },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("platform_config").upsert(
    {
      organization_id: organizationId,
      key: KEY_ENABLED,
      value: body.using_own_keys ? "true" : "false",
    },
    { onConflict: "organization_id,key" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, using_own_keys: body.using_own_keys });
}
