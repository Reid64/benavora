import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// POST /api/agents/registry/configure - upsert this org's `agent_configurations`
// row for one agent: { agent_id, enabled, config } (migration 094, AGENTS_v2.md
// Pillar 17). organization_id is derived server-side via requireRole, never
// from the request body. Requires writer role or above (Contracts §16).

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { agent_id, enabled, config } = (body ?? {}) as {
    agent_id?: unknown;
    enabled?: unknown;
    config?: unknown;
  };

  if (typeof agent_id !== "string" || agent_id.trim() === "") {
    return jsonError("agent_id is required.", "invalid_input", 400);
  }
  if (typeof enabled !== "boolean") {
    return jsonError("enabled must be a boolean.", "invalid_input", 400);
  }
  if (config !== undefined && (typeof config !== "object" || config === null || Array.isArray(config))) {
    return jsonError("config must be an object.", "invalid_input", 400);
  }

  const { data: registryRow, error: registryError } = await supabase
    .from("agent_registry")
    .select("agent_id")
    .eq("agent_id", agent_id.trim())
    .maybeSingle();
  if (registryError) {
    return jsonError(
      "Could not verify the agent exists.",
      "registry_lookup_failed",
      500,
    );
  }
  if (!registryRow) {
    return jsonError("Unknown agent_id.", "unknown_agent", 404);
  }

  const { data, error } = await supabase
    .from("agent_configurations")
    .upsert(
      {
        organization_id: organizationId,
        agent_id: agent_id.trim(),
        enabled,
        config: config ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,agent_id" },
    )
    .select("agent_id, enabled, config, last_run_at, run_count, total_tokens_consumed")
    .single();

  if (error || !data) {
    return jsonError(
      "Could not save the agent configuration.",
      "config_save_failed",
      500,
    );
  }

  return NextResponse.json({ configuration: data });
}
