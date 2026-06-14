import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { AgentError } from "@/lib/agents/base-agent";
import { SuccessProbabilityAgent } from "@/lib/agents/success-probability";

// Success Probability endpoint (AGENTS.md Agent 22, BEHAVIORAL_CONTRACTS §25).
// Runs the 6-factor model and stores the result in success_probability_scores.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60_000 * 60; // 100 per hour (AGENTS.md Agent 22)
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

export async function POST(request: Request) {
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { applicationId } = (body ?? {}) as { applicationId?: unknown };
  if (typeof applicationId !== "string" || applicationId.trim() === "") {
    return jsonError("applicationId is required.", "invalid_input", 400);
  }

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }
  const organizationId = profile.organization_id as string;

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many probability calculations. Please wait and try again.",
      "rate_limited",
      429,
    );
  }

  const overLimit = await enforceLimit(supabase, organizationId, "agent_runs");
  if (overLimit) return overLimit;

  const agent = new SuccessProbabilityAgent({
    client: supabase,
    organizationId,
    triggeredBy: profile.id as string,
  });

  try {
    const outcome = await agent.run({
      applicationId: applicationId.trim(),
    });
    return NextResponse.json({
      ...outcome.data,
      tokensUsed: outcome.tokensUsed,
    });
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    return jsonError(
      "Success probability calculation failed. Please try again.",
      "agent_failed",
      500,
    );
  }
}
