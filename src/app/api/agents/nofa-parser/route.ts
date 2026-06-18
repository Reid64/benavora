// NOFA Parser Agent trigger.
//
// POST — authenticates the caller, derives organization_id, runs NofaParserAgent
// against the specified opportunity, and returns the enriched fields.
//
// Body: { opportunityId: string }
// Response: { success: boolean, enrichedFields: string[], pdfsProcessed: number, agent_run_id: string | null }

import { NextRequest, NextResponse } from "next/server";

import { NofaParserAgent } from "@/lib/agents/nofa-parser";
import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  const parsed = body as { opportunityId?: unknown };
  const opportunityId =
    typeof parsed.opportunityId === "string" && parsed.opportunityId.trim()
      ? parsed.opportunityId.trim()
      : null;

  if (!opportunityId) {
    return jsonError("opportunityId is required.", "missing_opportunity_id", 400);
  }

  const agent = new NofaParserAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ opportunityId });
    return NextResponse.json({
      success: true,
      enrichedFields: outcome.data.enrichedFields,
      pdfsProcessed: outcome.data.pdfsProcessed,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "NOFA parser agent failed.";
    return jsonError(message, "agent_failed", 500);
  }
}
