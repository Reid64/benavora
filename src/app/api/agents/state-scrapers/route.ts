// State Scrapers Agent route — POST /api/agents/state-scrapers
//
// Scrapes five state housing agency grant pages and inserts discovered
// housing grant opportunities.

import { NextResponse } from "next/server";

import { StateScrapersAgent } from "@/lib/agents/state-scrapers";
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

  const agent = new StateScrapersAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({});
    return NextResponse.json({
      sourcesScraped: outcome.data.sourcesScraped,
      pagesScraped: outcome.data.pagesScraped,
      opportunitiesCreated: outcome.data.opportunitiesCreated,
      errors: outcome.data.errors,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "State scrapers agent failed.";
    return jsonError(message, "agent_failed", 500);
  }
}
