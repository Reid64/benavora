import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { AgentError } from "@/lib/agents/base-agent";
import { FormAnalyzerAgent } from "@/lib/agents/form-analyzer";

// POST /api/agents/form-analyzer
//
// Accepts { funderId } in the request body, authenticates the user, derives
// organization_id from the session profile, then runs the FormAnalyzerAgent
// which uses Playwright to fetch the funder's giving portal HTML, sends it to
// Claude for form structure analysis, and inserts the result into form_templates.
//
// NOTE: Playwright requires a Chromium binary. This route works in local
// Node.js development but will fail in Vercel serverless. Production form
// analysis runs on the dedicated AutoApply worker.
//
// Requires writer role or above (Contracts §16).

export const runtime = "nodejs";
export const maxDuration = 120;

const RATE_LIMIT = 5;
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

  const { funderId } = (body ?? {}) as { funderId?: unknown };
  if (typeof funderId !== "string" || funderId.trim() === "") {
    return jsonError("funderId is required.", "invalid_input", 400);
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
      "Too many form analysis runs. Please wait a moment.",
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

  try {
    const agent = new FormAnalyzerAgent({
      client: supabase,
      organizationId,
      triggeredBy,
      model,
      maxTokens,
      timeoutMs: 110_000,
    });
    const outcome = await agent.run({ funderId: funderId.trim() });
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
        : "Form analysis run failed. Please try again.",
      err instanceof AgentError ? err.code : "form_analyzer_failed",
      status,
    );
  }
}
