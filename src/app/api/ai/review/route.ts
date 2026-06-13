import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { trackUsage } from "@/lib/billing/usage-tracker";
import { createClient } from "@/lib/supabase/server";
import { AgentError } from "@/lib/agents/base-agent";
import { ReviewAgent } from "@/lib/agents/review-agent";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";

// Review endpoint (AGENTS.md Agent 08). Authenticates the user, derives
// organization_id from their profile (never the request body), and runs the
// ReviewAgent, which critiques the application's draft section-by-section, stores
// the review as a note, logs to agent_runs, and tracks token usage.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  // Consistent error shape across API routes (BEHAVIORAL_CONTRACTS §16).
  return NextResponse.json({ error: message, code }, { status });
}

// Best-effort per-organization rate limit: 20 requests / minute
// (BEHAVIORAL_CONTRACTS §16). In-memory; protects a single instance only.
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

  const { applicationId } = (body ?? {}) as { applicationId?: unknown };
  if (typeof applicationId !== "string" || applicationId.trim() === "") {
    return jsonError("applicationId is required.", "invalid_input", 400);
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
      "Too many review requests. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  // Daily AI-request quota for the org's tier (Behavioral Contracts §25).
  const overLimit = await enforceLimit(supabase, organizationId, "api_calls");
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

  const agent = new ReviewAgent({
    client: supabase,
    organizationId,
    triggeredBy: profile.id as string,
    model,
    maxTokens,
  });

  try {
    const outcome = await agent.run({ applicationId: applicationId.trim() });
    // Meter the AI request against the org's daily api_calls quota (§25).
    await trackUsage(supabase, organizationId, "api_calls", 1);
    return NextResponse.json({
      ...outcome.data,
      tokensUsed: outcome.tokensUsed,
    });
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    return jsonError(
      "The review could not be generated. Please try again.",
      "review_failed",
      500,
    );
  }
}
