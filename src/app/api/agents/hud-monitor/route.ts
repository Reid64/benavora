// HUD Monitor Agent trigger.
//
// POST — authenticates the caller, derives organization_id, instantiates the
// HudMonitorAgent, and fetches + parses the HUD funding opportunities page.
//
// Body: { keywords?: string[] }
// Response: { opportunities: [...], count: number, opportunitiesCreated: number, agent_run_id: string | null }

import { NextRequest, NextResponse } from "next/server";

import { HudMonitorAgent } from "@/lib/agents/hud-monitor";
import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(req: NextRequest) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", "bad_request", 400);
  }

  const parsed = body as { keywords?: unknown };

  const keywords = Array.isArray(parsed.keywords)
    ? (parsed.keywords as unknown[]).map(String).filter(Boolean)
    : [];

  const agent = new HudMonitorAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ keywords });
    return NextResponse.json({
      opportunities: outcome.data.opportunities,
      count: outcome.data.count,
      opportunitiesCreated: outcome.data.opportunitiesCreated,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "HUD monitor agent failed.";
    return jsonError(message, "agent_failed", 500);
  }
}
