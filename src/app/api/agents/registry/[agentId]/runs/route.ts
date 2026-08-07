import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// GET /api/agents/registry/[agentId]/runs - real agent_runs history for one
// agent_registry row, for the Agent Log Viewer (FEATURE_REGISTRY_v2.md #160,
// q27-003). agentId here is agent_registry.agent_id, which the seed script
// (scripts/seed-agent-registry.ts) deliberately sets to the agent's real
// on-disk agent_type/agentId literal wherever one exists (e.g.
// "eligibility_scoring", "ag-17-discovery", "ag-30-donor-intent") so it joins
// directly against agent_runs.agent_type - no separate mapping table needed.
// Agents seeded under a synthetic slug (plain functions / multi-source API
// routes with no single logged agent_type) will correctly return zero rows -
// that is an honest empty state, not a bug.
//
// organization_id is derived server-side via requireRole, never trusted from
// the client, matching every other org-scoped list route in this repo.

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const RUN_COLUMNS =
  "id, status, output_summary, items_found, items_processed, error_message, " +
  "tokens_used, duration_ms, started_at, completed_at, created_at";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: { agentId: string } },
) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const agentId = params.agentId;
  if (!agentId || typeof agentId !== "string") {
    return jsonError("agentId is required.", "invalid_input", 400);
  }

  const { data: registryRow, error: registryError } = await supabase
    .from("agent_registry")
    .select("agent_id, name")
    .eq("agent_id", agentId)
    .maybeSingle();
  if (registryError) {
    return jsonError("Could not load the agent registry.", "registry_load_failed", 500);
  }
  if (!registryRow) {
    return jsonError("Agent not found.", "not_found", 404);
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const limitParam = url.searchParams.get("limit");

  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (Number.isFinite(parsed) && parsed >= 1) {
      limit = Math.min(Math.floor(parsed), MAX_LIMIT);
    }
  }

  let query = supabase
    .from("agent_runs")
    .select(RUN_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("agent_type", agentId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;
  if (error) {
    return jsonError("Could not load run history for this agent.", "runs_load_failed", 500);
  }

  return NextResponse.json({
    agent: { agent_id: registryRow.agent_id, name: registryRow.name },
    runs: data ?? [],
  });
}
