import { NextResponse } from "next/server";

import { CustomApiResearchAgent } from "@/lib/agents/custom-api";
import { requireRole } from "@/lib/auth/role-gate";

// Custom API Research Agent trigger endpoint (AGENTS.md Agent 19).
//
// POST { connectionId? } — runs a polling cycle for the caller's org.
// connectionId is optional: omit to poll all active connections, or pass a
// specific id to target one connection (e.g. "Run Now" in the settings UI).
//
// Manual-trigger-only in this pass (rows #59/#60 hardening, 2026-08-07) —
// runs synchronously and returns the result, same as /api/agents/custom-scrape.
// Not wired into any autonomous/scheduled pipeline, matching this repo's own
// precedent (AG-25 Disaster Response, AG-41 Simulation) of shipping
// manual-trigger-only first.

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let connectionId: string | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      connectionId?: string;
    };
    if (typeof body.connectionId === "string" && body.connectionId.trim()) {
      connectionId = body.connectionId.trim();
    }
  } catch {
    // Body is optional; run all active connections if omitted.
  }

  const agent = new CustomApiResearchAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ connectionId });
    return NextResponse.json({
      connectionsRun: outcome.data.connectionsRun,
      opportunitiesCreated: outcome.data.opportunitiesCreated,
      connectionsPaused: outcome.data.connectionsPaused,
      errors: outcome.data.errors,
      agent_run_id: outcome.runId,
    });
  } catch {
    return jsonError(
      "Custom API agent failed. Please try again.",
      "agent_failed",
      500,
    );
  }
}
