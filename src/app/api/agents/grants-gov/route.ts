// Grants.gov Research Agent trigger — AGENTS.md Agent 15.
//
// POST — authenticates the caller, derives organization_id, instantiates the
// GrantsGovResearchAgent, and runs a live Grants.gov search. Returns the full
// list of discovered opportunities plus the agent run ID for audit.
//
// Body: { keywords?: string[], categories?: string[], dateRange?: { from?: string, to?: string } }
//   - keywords defaults to the org's active search_profiles when omitted
//     (the settings-page "Run Now" trigger sends an empty body).
// Response: { opportunities: [...], count: number, agent_run_id: string | null }

import { NextRequest, NextResponse } from "next/server";

import { GrantsGovResearchAgent } from "@/lib/agents/grants-gov";
import { getDefaultResearchKeywords } from "@/lib/agents/org-defaults";
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

  // Body-supplied keywords take precedence; the settings-page "Run Now"
  // trigger sends an empty body (the connector card has no keyword input),
  // so fall back to the org's active search_profiles keywords.
  const bodyKeywords = Array.isArray(parsed.keywords)
    ? (parsed.keywords as unknown[]).map(String).filter(Boolean)
    : typeof parsed.keywords === "string" && parsed.keywords.trim()
      ? [parsed.keywords.trim()]
      : [];

  const keywords =
    bodyKeywords.length > 0
      ? bodyKeywords
      : await getDefaultResearchKeywords(supabase, organizationId);

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
  } catch {
    return jsonError(
      "Grants.gov agent failed. Please try again.",
      "agent_failed",
      500,
    );
  }
}
