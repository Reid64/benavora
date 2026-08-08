import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// POST /api/funders/enroll-monitoring — FEATURE_REGISTRY_v2.md #151
// (Auto-Monitor on Add). Enqueues one agent_queue row per funder id so
// AG-18 (Reputation Intelligence) checks it as soon as the worker's
// continuous queue poll picks it up, instead of waiting for the nightly
// sweep's 5-funder/night sample to eventually reach it.
//
// Called right after a funder INSERT succeeds — never before, never
// synchronously in place of it. checkEntityReputation() makes a real
// DuckDuckGo search + Claude classification call per funder; running that
// inline in the create request would make funder creation slow/flaky. This
// route only ever writes a queued agent_queue row — the actual check runs
// later, on the worker.
//
// organizationId is derived from the session (Behavioral Contracts §2),
// never trusted from the request body. funderIds are re-checked against
// `funders.organization_id` server-side too, so a caller can't use this
// route to enqueue a reputation check against another org's funder.

export const runtime = "nodejs";

// Caller-side cap, independent of any cap the bulk-import route itself
// applies before calling this route — this route is also reachable directly
// from client components (foundation import, recommendation "add"), so it
// enforces its own ceiling rather than trusting every caller to have capped
// already.
const MAX_FUNDERS_PER_REQUEST = 25;

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

  const { funderIds } = (body ?? {}) as { funderIds?: unknown };
  if (
    !Array.isArray(funderIds) ||
    funderIds.length === 0 ||
    !funderIds.every((id) => typeof id === "string" && id.trim() !== "")
  ) {
    return jsonError(
      "funderIds must be a non-empty array of strings.",
      "invalid_input",
      400,
    );
  }

  const requested = Array.from(new Set(funderIds as string[])).slice(
    0,
    MAX_FUNDERS_PER_REQUEST,
  );

  const { data: funders, error: fundersError } = await supabase
    .from("funders")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in("id", requested);

  if (fundersError) {
    return jsonError("Failed to load funders.", "db_error", 500);
  }
  if (!funders || funders.length === 0) {
    // Nothing owned by this org matched — not an error, just nothing to do
    // (e.g. the funder was deleted between insert and this call).
    return NextResponse.json({ enrolled: 0 });
  }

  const rows = funders.map((funder) => ({
    org_id: organizationId,
    agent_id: "reputation",
    priority: 5,
    status: "queued" as const,
    trigger_source: "event" as const,
    input_payload: {
      entityId: funder.id,
      entityType: "funder",
      entityName: funder.name,
    },
  }));

  const { error: insertError } = await supabase
    .from("agent_queue")
    .insert(rows);

  if (insertError) {
    return jsonError(
      "Failed to enqueue reputation monitoring.",
      "db_error",
      500,
    );
  }

  return NextResponse.json({ enrolled: rows.length });
}
