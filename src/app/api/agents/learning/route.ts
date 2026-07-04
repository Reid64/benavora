import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { AgentError } from "@/lib/agents/base-agent";
import { RecursiveLearningAgent } from "@/lib/agents/recursive-learning";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";

// Recursive Learning endpoint (AGENTS.md Agent 10). The Outcomes page calls this
// after recording an outcome. It authenticates the user, derives organization_id
// from their profile (never the request body), and runs the
// RecursiveLearningAgent, which extracts proven narratives from awarded drafts,
// flags Knowledge Base entries, recalculates effectiveness scores, logs to
// agent_runs, and tracks token usage.

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  // Consistent error shape across API routes (BEHAVIORAL_CONTRACTS §16).
  return NextResponse.json({ error: message, code }, { status });
}

// Best-effort per-organization rate limit for agent runs (mirrors the AI-route
// limit of 20/min in BEHAVIORAL_CONTRACTS §16). In-memory; a shared store is the
// production fix for multi-instance deployments.
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
  // Running an agent is a write action - viewers are read-only (Contracts §16).
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { outcomeId } = (body ?? {}) as { outcomeId?: unknown };
  if (typeof outcomeId !== "string" || outcomeId.trim() === "") {
    return jsonError("outcomeId is required.", "invalid_input", 400);
  }

  const supabase = createClient();

  // Authenticate via the session (BEHAVIORAL_CONTRACTS §16).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  // Derive organization_id server-side from the profile - never from the body.
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
      "Too many learning requests. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  // Daily agent-run quota for the org's tier (Behavioral Contracts §25).
  const overLimit = await enforceLimit(supabase, organizationId, "agent_runs");
  if (overLimit) return overLimit;

  // Resolve AI config (platform_config overrides, then defaults).
  const { data: configRows } = await supabase
    .from("platform_config")
    .select("key, value")
    .in("key", ["ai.model", "ai.max_tokens"]);
  const config = new Map<string, string>(
    (configRows ?? []).map((r) => [r.key as string, r.value as string]),
  );
  const model = config.get("ai.model") ?? DEFAULT_MODEL;
  const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;

  // The agent scopes every query by organization_id explicitly, so the session
  // client (RLS on, as a second barrier) is safe to hand it.
  const agent = new RecursiveLearningAgent({
    client: supabase,
    organizationId,
    triggeredBy: profile.id as string,
    model,
    maxTokens,
  });

  try {
    const outcome = await agent.run({ outcomeId: outcomeId.trim() });
    return NextResponse.json({
      ...outcome.data,
      tokensUsed: outcome.tokensUsed,
    });
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    return jsonError(
      "Recursive learning failed. Please try again.",
      "learning_failed",
      500,
    );
  }
}
