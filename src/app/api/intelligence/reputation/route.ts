import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { checkEntityReputation } from "@/lib/intelligence/reputation-agent";

// POST/GET/PATCH /api/intelligence/reputation — Reputation Intelligence
// (PLATFORM_VISION_ARCHITECTURE.md Pillar 15, AGENTS_v2.md AG-18).
//
// POST  { entityId, entityType, entityName } — runs a DuckDuckGo + Claude
//       reputation sweep for one entity, returns the newly inserted signals.
// GET   — unread reputation_alerts for the caller's org, joined with the
//       signal they point at. organizationId is always derived from the
//       session (Behavioral Contracts §2), never a client-supplied orgId —
//       reputation_alerts carries no RLS policy (migration 076), so trusting
//       a query param here would let one org read another's alerts.
// PATCH { alertId, status } — updates one alert's status, scoped to org_id
//       so a forged alertId cannot touch another org's row.

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_ALERT_STATUSES = ["unread", "read", "dismissed"];

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { entityId, entityType, entityName } = (body ?? {}) as {
    entityId?: unknown;
    entityType?: unknown;
    entityName?: unknown;
  };

  if (typeof entityId !== "string" || entityId.trim() === "") {
    return jsonError("entityId is required.", "invalid_input", 400);
  }
  if (typeof entityType !== "string" || entityType.trim() === "") {
    return jsonError("entityType is required.", "invalid_input", 400);
  }
  if (typeof entityName !== "string" || entityName.trim() === "") {
    return jsonError("entityName is required.", "invalid_input", 400);
  }

  try {
    const signals = await checkEntityReputation(
      entityId.trim(),
      entityType.trim(),
      entityName.trim(),
      supabase,
    );
    return NextResponse.json({ signals });
  } catch {
    return jsonError(
      "Reputation check failed.",
      "reputation_check_failed",
      500,
    );
  }
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { data, error } = await supabase
    .from("reputation_alerts")
    .select(
      "id, org_id, signal_id, status, created_at, reputation_signals(id, entity_id, entity_type, signal_type, severity, headline, summary, source_url, signal_date, verified)",
    )
    .eq("org_id", organizationId)
    .eq("status", "unread")
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError("Failed to load reputation alerts.", "db_error", 500);
  }

  return NextResponse.json({ alerts: data ?? [] });
}

export async function PATCH(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { alertId, status } = (body ?? {}) as {
    alertId?: unknown;
    status?: unknown;
  };

  if (typeof alertId !== "string" || alertId.trim() === "") {
    return jsonError("alertId is required.", "invalid_input", 400);
  }
  if (
    typeof status !== "string" ||
    !VALID_ALERT_STATUSES.includes(status)
  ) {
    return jsonError(
      `status must be one of: ${VALID_ALERT_STATUSES.join(", ")}.`,
      "invalid_input",
      400,
    );
  }

  const { error } = await supabase
    .from("reputation_alerts")
    .update({ status })
    .eq("id", alertId.trim())
    .eq("org_id", organizationId);

  if (error) {
    return jsonError("Failed to update the alert.", "db_error", 500);
  }

  return NextResponse.json({ success: true });
}
