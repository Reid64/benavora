// POST /api/agents/form-filler
//
// Accepts { funderId, requestAmount?, requestDescription? }, authenticates the
// user, derives organization_id from the session profile, then runs the
// FormFillerAgent which uses Playwright to fill and submit a corporate giving
// form using the stored form_template for that funder.
//
// NOTE: Playwright requires a Chromium binary. This route works in local
// Node.js development but will fail in Vercel serverless. Production form
// fill runs on the dedicated AutoApply worker.
//
// Requires writer role or above (Contracts §16).

import { NextResponse } from "next/server";

import { AgentError } from "@/lib/agents/base-agent";
import { FormFillerAgent } from "@/lib/agents/form-filler";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { requireRole } from "@/lib/auth/role-gate";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

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

  const { funderId, requestAmount, requestDescription } = (body ?? {}) as {
    funderId?: unknown;
    requestAmount?: unknown;
    requestDescription?: unknown;
  };

  if (typeof funderId !== "string" || funderId.trim() === "") {
    return jsonError("funderId is required.", "invalid_input", 400);
  }

  const parsedAmount =
    typeof requestAmount === "number"
      ? requestAmount
      : typeof requestAmount === "string" && requestAmount !== ""
        ? Number(requestAmount)
        : undefined;

  const parsedDescription =
    typeof requestDescription === "string" && requestDescription.trim() !== ""
      ? requestDescription.trim()
      : undefined;

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
    const agent = new FormFillerAgent({
      client: supabase,
      organizationId,
      triggeredBy,
      model,
      maxTokens,
      timeoutMs: 110_000,
    });
    const outcome = await agent.run({
      funderId: funderId.trim(),
      requestAmount: parsedAmount,
      requestDescription: parsedDescription,
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
        : "Form fill run failed. Please try again.",
      err instanceof AgentError ? err.code : "form_filler_failed",
      status,
    );
  }
}
