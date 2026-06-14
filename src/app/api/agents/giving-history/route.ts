import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { AgentError } from "@/lib/agents/base-agent";
import { GivingHistoryAgent } from "@/lib/agents/giving-history";

// POST /api/agents/giving-history
//
// Accepts { funderId, ein } in the request body. Derives organization_id from
// the session profile (never from the body), then runs GivingHistoryAgent which
// queries ProPublica Nonprofit Explorer for IRS 990-PF filing data and upserts
// per-year giving stats into funder_intelligence.recent_grants.
//
// Requires writer role or above (Contracts §16).

export const runtime = "nodejs";
export const maxDuration = 60;

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function isRateLimited(orgId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(orgId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(orgId, recent);
    return true;
  }
  recent.push(now);
  hits.set(orgId, recent);
  return false;
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { funderId, ein } = (body ?? {}) as {
    funderId?: unknown;
    ein?: unknown;
  };

  if (typeof funderId !== "string" || funderId.trim() === "") {
    return jsonError("funderId is required.", "invalid_input", 400);
  }
  if (typeof ein !== "string" || ein.trim() === "") {
    return jsonError("ein is required.", "invalid_input", 400);
  }

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profileRow) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }
  const organizationId = profileRow.organization_id as string;
  const triggeredBy = profileRow.id as string;

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many giving history runs. Please wait a moment.",
      "rate_limited",
      429,
    );
  }

  const overLimit = await enforceLimit(supabase, organizationId, "agent_runs");
  if (overLimit) return overLimit;

  try {
    const agent = new GivingHistoryAgent({
      client: supabase,
      organizationId,
      triggeredBy,
    });
    const outcome = await agent.run({
      funderId: funderId.trim(),
      ein: ein.trim(),
    });
    return NextResponse.json({
      runId: outcome.runId,
      status: "completed",
      result: outcome.data,
    });
  } catch (err) {
    const status = err instanceof AgentError ? err.status : 500;
    return jsonError(
      err instanceof AgentError
        ? err.message
        : "Giving history extraction failed. Please try again.",
      err instanceof AgentError ? err.code : "giving_history_failed",
      status,
    );
  }
}
