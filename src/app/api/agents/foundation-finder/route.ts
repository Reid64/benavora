// Foundation Finder Agent route - POST /api/agents/foundation-finder
//
// Free Candid alternative: scrapes free foundation directories and inserts
// discovered private-foundation grant opportunities.

import { NextResponse } from "next/server";

import { FoundationFinderAgent } from "@/lib/agents/foundation-finder";
import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  const agent = new FoundationFinderAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({});
    return NextResponse.json({
      pagesScraped: outcome.data.pagesScraped,
      opportunitiesCreated: outcome.data.opportunitiesCreated,
      errors: outcome.data.errors,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Foundation Finder agent failed.";
    return jsonError(message, "agent_failed", 500);
  }
}
