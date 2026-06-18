// Grants.gov Research Agent trigger — AGENTS.md Agent 15.
//
// POST — authenticates the caller, derives organization_id, instantiates the
// GrantsGovResearchAgent, and runs a live Grants.gov search. Returns the full
// list of discovered opportunities plus the agent run ID for audit.
//
// Body: { keywords: string[], categories?: string[], dateRange?: { from?: string, to?: string } }
// Response: { opportunities: [...], count: number, agent_run_id: string | null }

import { NextRequest, NextResponse } from "next/server";

import { GrantsGovResearchAgent } from "@/lib/agents/grants-gov";
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

  const parsed = body as {
    keywords?: unknown;
    categories?: unknown;
    dateRange?: unknown;
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

  const categories = Array.isArray(parsed.categories)
    ? (parsed.categories as unknown[]).map(String).filter(Boolean)
    : undefined;

  const rawRange =
    parsed.dateRange && typeof parsed.dateRange === "object"
      ? (parsed.dateRange as Record<string, unknown>)
      : {};

  const dateRange = {
    from: typeof rawRange.from === "string" ? rawRange.from : undefined,
    to: typeof rawRange.to === "string" ? rawRange.to : undefined,
  };

  const agent = new GrantsGovResearchAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ keywords, categories, dateRange });
    return NextResponse.json({
      opportunities: outcome.data.opportunities,
      count: outcome.data.count,
      opportunitiesCreated: outcome.data.opportunitiesCreated,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Grants.gov agent failed.";
    return jsonError(message, "agent_failed", 500);
  }
}
