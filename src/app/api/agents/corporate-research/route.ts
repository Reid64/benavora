// Corporate Scraper Agent route — POST /api/agents/corporate-research
//
// Scrapes major corporate foundation and giving pages and inserts
// discovered grant opportunities.

import { NextResponse } from "next/server";

import { CorporateScraperAgent } from "@/lib/agents/corporate-scraper";
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

  const agent = new CorporateScraperAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({});
    return NextResponse.json({
      targetsRun: outcome.data.targetsRun,
      opportunitiesCreated: outcome.data.opportunitiesCreated,
      errors: outcome.data.errors,
      agent_run_id: outcome.runId,
    });
  } catch {
    return jsonError(
      "Corporate scraper agent failed. Please try again.",
      "agent_failed",
      500,
    );
  }
}
