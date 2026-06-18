// Simpler Grants Research Agent trigger.
//
// POST — authenticates the caller, derives organization_id, instantiates the
// SimplerGrantsResearchAgent, and runs a live Simpler.Grants.gov search.
//
// Body: { keywords: string[], pageSize?: number, pageOffset?: number }
// Response: { opportunities: [...], count: number, opportunitiesCreated: number, agent_run_id: string | null }

import { NextRequest, NextResponse } from "next/server";

import { SimplerGrantsResearchAgent } from "@/lib/agents/simpler-grants";
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

  const parsed = body as {
    keywords?: unknown;
    pageSize?: unknown;
    pageOffset?: unknown;
  };

  const keywords = Array.isArray(parsed.keywords)
    ? (parsed.keywords as unknown[]).map(String).filter(Boolean)
    : typeof parsed.keywords === "string" && parsed.keywords.trim()
      ? [parsed.keywords.trim()]
      : [];

  if (keywords.length === 0) {
    return jsonError("At least one keyword is required.", "no_keywords", 400);
  }

  const pageSize =
    typeof parsed.pageSize === "number" && parsed.pageSize > 0
      ? parsed.pageSize
      : 25;

  const pageOffset =
    typeof parsed.pageOffset === "number" && parsed.pageOffset > 0
      ? parsed.pageOffset
      : 1;

  const agent = new SimplerGrantsResearchAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ keywords, pageSize, pageOffset });
    return NextResponse.json({
      opportunities: outcome.data.opportunities,
      count: outcome.data.count,
      opportunitiesCreated: outcome.data.opportunitiesCreated,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Simpler Grants agent failed.";
    return jsonError(message, "agent_failed", 500);
  }
}
