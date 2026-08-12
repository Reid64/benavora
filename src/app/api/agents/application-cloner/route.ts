// Application Cloner endpoint - AGENTS.md Agent 26.
// POST /api/agents/application-cloner
// Authenticates the user, derives organization_id from their profile (never from
// the request body), and runs ApplicationClonerAgent.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { AgentError } from "@/lib/agents/base-agent";
import { ApplicationClonerAgent } from "@/lib/agents/application-cloner";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

const RATE_LIMIT = 20;
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

export async function POST(request: Request) {
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { sourceApplicationId, targetOpportunityId } = (body ?? {}) as {
    sourceApplicationId?: unknown;
    targetOpportunityId?: unknown;
  };

  if (
    typeof sourceApplicationId !== "string" ||
    sourceApplicationId.trim() === ""
  ) {
    return jsonError("sourceApplicationId is required.", "invalid_input", 400);
  }
  if (
    typeof targetOpportunityId !== "string" ||
    targetOpportunityId.trim() === ""
  ) {
    return jsonError("targetOpportunityId is required.", "invalid_input", 400);
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
      "Too many requests. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  const overLimit = await enforceLimit(supabase, organizationId, "agent_runs");
  if (overLimit) return overLimit;

  const { data: configRows } = await supabase
    .from("platform_config")
    .select("key, value")
    .eq("organization_id", organizationId)
    .in("key", ["ai.model", "ai.max_tokens"]);
  const config = new Map<string, string>(
    (configRows ?? []).map((r) => [r.key as string, r.value as string]),
  );
  const model = config.get("ai.model") ?? DEFAULT_MODEL;
  const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;

  const agent = new ApplicationClonerAgent({
    client: supabase,
    organizationId,
    triggeredBy: profile.id as string,
    model,
    maxTokens,
  });

  try {
    const outcome = await agent.run({
      sourceApplicationId: sourceApplicationId.trim(),
      targetOpportunityId: targetOpportunityId.trim(),
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
      "Application cloning failed. Please try again.",
      "cloning_failed",
      500,
    );
  }
}
