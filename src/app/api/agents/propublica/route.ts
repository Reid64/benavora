// ProPublica 990 Mining Agent trigger — AGENTS.md Agent 17.
//
// POST — authenticates the caller, derives organization_id, instantiates the
// ProPublicaMiningAgent, and queries the ProPublica Nonprofit Explorer API.
// Returns structured IRS 990 filing data (revenue, expenses, assets, grants
// paid per fiscal year) for one or more matching nonprofits.
//
// Body: { ein?: string, query?: string, state?: string }
//   - Provide either `ein` (preferred, EIN with or without dashes) or `query`
//     (free-text org name / keyword). At least one is required.
//   - `state` is optional; narrows query-based searches to a US state.
//
// Response: { organizations: [...], organizations_found: number, agent_run_id }

import { NextRequest, NextResponse } from "next/server";

import { AgentError } from "@/lib/agents/base-agent";
import { ProPublicaMiningAgent } from "@/lib/agents/propublica";
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
    ein?: unknown;
    query?: unknown;
    state?: unknown;
  };

  const ein =
    typeof parsed.ein === "string" && parsed.ein.trim()
      ? parsed.ein.trim()
      : undefined;

  const query =
    typeof parsed.query === "string" && parsed.query.trim()
      ? parsed.query.trim()
      : undefined;

  const state =
    typeof parsed.state === "string" && parsed.state.trim()
      ? parsed.state.trim()
      : undefined;

  if (!ein && !query) {
    return jsonError(
      "Provide either ein or query in the request body.",
      "missing_input",
      400,
    );
  }

  const agent = new ProPublicaMiningAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
  });

  try {
    const outcome = await agent.run({ ein, query, state });
    return NextResponse.json({
      organizations: outcome.data.organizations,
      organizations_found: outcome.data.organizations_found,
      agent_run_id: outcome.runId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ProPublica agent failed.";
    const status = err instanceof AgentError ? err.status : 500;
    const code = err instanceof AgentError ? err.code : "agent_failed";
    return jsonError(message, code, status);
  }
}
