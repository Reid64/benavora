// State Portal Research Agent trigger — AGENTS.md Agent 18.
//
// POST — authenticates the caller, derives organization_id, instantiates the
// StatePortalResearchAgent, and runs a live portal scrape + Claude extraction.
// Returns discovered opportunities and the agent run ID for audit.
//
// Body: { state?: string, keywords?: string[], category?: string }
//   - state defaults to the org's own profile state, keywords to the org's
//     active search_profiles, when omitted (the settings-page "Run Now"
//     trigger sends an empty body).
// Response: { opportunities: [...], count: number, opportunitiesCreated: number,
//             state: string, agent_run_id: string | null }

import { NextRequest, NextResponse } from "next/server";

import { StatePortalResearchAgent } from "@/lib/agents/state-portal";
import {
  getDefaultResearchKeywords,
  getOrgProfileBasics,
} from "@/lib/agents/org-defaults";
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
    state?: unknown;
    keywords?: unknown;
    category?: unknown;
  };

  // Body-supplied state takes precedence; the settings-page "Run Now"
  // trigger sends an empty body (the connector card has no state input), so
  // fall back to the org's own profile state.
  let state =
    typeof parsed.state === "string" && parsed.state.trim()
      ? parsed.state.trim()
      : "";

  if (!state) {
    const orgProfile = await getOrgProfileBasics(supabase, organizationId);
    state = orgProfile.state ?? "";
  }

  if (!state) {
    return jsonError(
      "state is required (e.g. \"TX\" or \"Texas\"), and your organization " +
        "profile has no state on file. Set one in Settings, or pass a " +
        "state explicitly.",
      "no_state",
      400,
    );
  }

  const bodyKeywords = Array.isArray(parsed.keywords)
    ? (parsed.keywords as unknown[]).map(String).filter(Boolean)
    : typeof parsed.keywords === "string" && parsed.keywords.trim()
      ? [parsed.keywords.trim()]
      : [];

  const keywords =
    bodyKeywords.length > 0
      ? bodyKeywords
      : await getDefaultResearchKeywords(supabase, organizationId);

  const category =
    typeof parsed.category === "string" && parsed.category.trim()
      ? parsed.category.trim()
      : undefined;

  const agent = new StatePortalResearchAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ state, keywords, category });
    return NextResponse.json({
      opportunities: outcome.data.opportunities,
      count: outcome.data.count,
      opportunitiesCreated: outcome.data.opportunitiesCreated,
      state: outcome.data.state,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "State portal agent failed.";
    return jsonError(message, "agent_failed", 500);
  }
}
