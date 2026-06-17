// POST /api/ai/budget - dedicated Budget Builder endpoint (AGENTS.md Agent 06).
//
// Accepts opportunityId and programId, generates a structured line-item budget
// and a humanized prose narrative grounded in the org's program data and
// Knowledge Base budget_justification entries. Returns budget_table, budget_
// narrative, and confidence_score (BEHAVIORAL_CONTRACTS §9).
//
// All data access is RLS-scoped via the session client; organization_id is
// derived from the profile row, never from the request body (Contracts §2).
// Agent_runs logging is handled by BudgetAgent (extends BaseAgent, Contracts §15).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { trackUsage } from "@/lib/billing/usage-tracker";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { BudgetAgent } from "@/lib/agents/budget-agent";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/utils/constants";
import type { BudgetApiResult } from "@/types/ai";

export const runtime = "nodejs";
// The budget narrative is a non-streaming Claude generation that can exceed the
// default 60s function limit; without the extension Vercel kills it mid-call.
export const maxDuration = 300;

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

function jsonError(message: string, code: string, status: number) {
  // Consistent error shape (BEHAVIORAL_CONTRACTS §16).
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  // Generating a budget is a write action - viewers are read-only (Contracts §16).
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { opportunityId, programId } = (body ?? {}) as {
    opportunityId?: unknown;
    programId?: unknown;
  };

  if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
    return jsonError("opportunityId is required.", "invalid_input", 400);
  }
  if (typeof programId !== "string" || programId.trim() === "") {
    return jsonError("programId is required.", "invalid_input", 400);
  }

  const supabase = createClient();

  // Authenticate via session (BEHAVIORAL_CONTRACTS §16).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  // Derive organization_id server-side - never from the body.
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
      "Too many budget requests. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  // Daily AI-request quota for the org's tier (Behavioral Contracts §25).
  const overLimit = await enforceLimit(supabase, organizationId, "api_calls");
  if (overLimit) return overLimit;

  // Resolve config (platform_config overrides, then env/defaults).
  const { data: configRows } = await supabase
    .from("platform_config")
    .select("key, value")
    .in("key", ["ai.model", "ai.max_tokens", "ai.confidence_threshold"]);
  const config = new Map<string, string>(
    (configRows ?? []).map((r) => [r.key as string, r.value as string]),
  );
  const model = config.get("ai.model") ?? DEFAULT_MODEL;
  const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;
  const threshold =
    Number(config.get("ai.confidence_threshold")) || AI_CONFIDENCE_THRESHOLD;

  try {
    const agent = new BudgetAgent({
      client: supabase,
      organizationId,
      triggeredBy: profile.id as string,
      model,
      maxTokens,
    });

    const { data } = await agent.run({ opportunityId, programId });

    // Meter the AI request against the org's daily api_calls quota (§25).
    await trackUsage(supabase, organizationId, "api_calls", 1);

    const result: BudgetApiResult = {
      budget_table: data.budgetTable,
      total_requested: data.totalRequested,
      budget_narrative: data.budgetNarrative,
      confidence_score: data.confidenceScore,
      sources: data.sources,
      savedVersion: data.savedVersion,
      belowThreshold: data.confidenceScore < threshold,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("BUDGET GENERATION ERROR:", err);
    return jsonError(
      "The budget could not be generated. Please try again.",
      "generation_failed",
      500,
    );
  }
}
