// TDHCA Scraper Agent route — POST /api/agents/tdhca
//
// Scrapes Texas Department of Housing and Community Affairs grant pages
// and inserts discovered housing grant opportunities.

import { NextResponse } from "next/server";

import { TdhcaScraperAgent } from "@/lib/agents/tdhca-scraper";
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

  const agent = new TdhcaScraperAgent({
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
      err instanceof Error ? err.message : "TDHCA scraper agent failed.";
    return jsonError(message, "agent_failed", 500);
  }
}
