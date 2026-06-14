// Custom Scrape Research Agent trigger — AGENTS.md Agent 20.
//
// POST { targetId? } — runs a scrape cycle for the caller's org.
// targetId is optional: omit to scrape all active targets, or pass a specific
// id to target one URL (e.g. "Run Now" from the settings UI).
//
// Runs the agent synchronously and returns discovered opportunities so the
// settings page can display immediate feedback.

import { NextRequest, NextResponse } from "next/server";

import { CustomScrapeResearchAgent } from "@/lib/agents/custom-scrape";
import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(req: NextRequest) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let targetId: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      targetId?: string;
    };
    if (typeof body.targetId === "string" && body.targetId.trim()) {
      targetId = body.targetId.trim();
    }
  } catch {
    // Body is optional — omitting targetId runs all active targets.
  }

  const agent = new CustomScrapeResearchAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ targetId });
    return NextResponse.json({
      targetsRun: outcome.data.targetsRun,
      opportunitiesCreated: outcome.data.opportunitiesCreated,
      targetsPaused: outcome.data.targetsPaused,
      errors: outcome.data.errors,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Custom scrape agent failed.";
    return jsonError(message, "agent_failed", 500);
  }
}
