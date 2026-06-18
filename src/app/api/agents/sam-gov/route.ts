// SAM.gov Research Agent trigger — AGENTS.md Agent 16.
//
// POST — authenticates the caller, reads SAM_GOV_API_KEY from process.env,
// instantiates SamGovResearchAgent, and runs a live search.
// Returns the full list of discovered opportunities plus the agent run ID.
//
// Body: { keywords: string[], postedFrom?: string, postedTo?: string }
// Response: { opportunities: [...], count: number, opportunitiesCreated: number, agent_run_id: string | null }

import { NextRequest, NextResponse } from "next/server";

import { SamGovResearchAgent } from "@/lib/agents/sam-gov";
import { requireRole } from "@/lib/auth/role-gate";
import { AgentError } from "@/lib/agents/base-agent";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(req: NextRequest) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  const apiKey = process.env.SAM_GOV_API_KEY;
  if (!apiKey) {
    return jsonError(
      "SAM_GOV_API_KEY environment variable is not configured.",
      "key_missing",
      500,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body.", "bad_request", 400);
  }

  const parsed = body as {
    keywords?: unknown;
    postedFrom?: unknown;
    postedTo?: unknown;
  };

  const keywords = Array.isArray(parsed.keywords)
    ? (parsed.keywords as unknown[]).map(String).filter(Boolean)
    : typeof parsed.keywords === "string" && parsed.keywords.trim()
      ? [parsed.keywords.trim()]
      : [];

  if (keywords.length === 0) {
    return jsonError(
      "At least one keyword is required.",
      "no_keywords",
      400,
    );
  }

  const postedFrom =
    typeof parsed.postedFrom === "string" ? parsed.postedFrom : undefined;
  const postedTo =
    typeof parsed.postedTo === "string" ? parsed.postedTo : undefined;

  const agent = new SamGovResearchAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ apiKey, keywords, postedFrom, postedTo });
    return NextResponse.json({
      opportunities: outcome.data.opportunities,
      count: outcome.data.count,
      opportunitiesCreated: outcome.data.opportunitiesCreated,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    const message =
      err instanceof Error ? err.message : "SAM.gov agent failed.";
    return jsonError(message, "agent_failed", 500);
  }
}
