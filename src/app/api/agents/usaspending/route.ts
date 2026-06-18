// USAspending Historical Awards Agent route - POST /api/agents/usaspending
//
// Pulls historical federal awards from the public USAspending.gov API and
// stores them in historical_awards for competitive intelligence.

import { NextResponse } from "next/server";

import { UsaspendingAgent } from "@/lib/agents/usaspending";
import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";
export const maxDuration = 120;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let keyword: string | undefined;
  const body = (await request.json().catch(() => ({}))) as { keyword?: unknown };
  if (typeof body.keyword === "string" && body.keyword.trim() !== "") {
    keyword = body.keyword;
  }

  const agent = new UsaspendingAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ keyword });
    return NextResponse.json({
      awardsFound: outcome.data.awardsFound,
      awardsStored: outcome.data.awardsStored,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "USAspending agent failed.";
    return jsonError(message, "agent_failed", 500);
  }
}
