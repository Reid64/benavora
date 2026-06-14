import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { decryptKey } from "@/lib/crypto/key-encrypt";

// SAM.gov Research Agent trigger (AGENTS.md Agent 16).
// POST — queues a SAM.gov polling cycle for the caller's org.
// Requires a SAM.gov API key stored in integration_keys.
// Full implementation lands in Tier 6 Phase A.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  // Verify that a SAM.gov API key is configured for this org.
  const { data: keyRow, error: keyErr } = await supabase
    .from("integration_keys")
    .select("encrypted_key, is_active")
    .eq("organization_id", organizationId)
    .eq("service_name", "sam_gov")
    .eq("is_active", true)
    .maybeSingle();

  if (keyErr) {
    return jsonError(keyErr.message, "db_error", 500);
  }
  if (!keyRow) {
    return jsonError(
      "SAM.gov API key not configured. Add your key in Settings > Integrations.",
      "key_missing",
      400,
    );
  }

  // Confirm the key is decryptable before queuing.
  try {
    decryptKey(keyRow.encrypted_key);
  } catch {
    return jsonError(
      "SAM.gov API key could not be read. Please re-enter it.",
      "key_unreadable",
      400,
    );
  }

  const { data: run, error } = await supabase
    .from("agent_runs")
    .insert({
      organization_id: organizationId,
      agent_type: "sam_gov_research",
      status: "pending",
      triggered_by: userId,
      input_params: { source: "manual_trigger", integration: "sam_gov" },
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return jsonError(error.message, "db_error", 500);
  }

  return NextResponse.json({ status: "queued", runId: run.id });
}
