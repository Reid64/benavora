import { NextResponse } from "next/server";

import { AgentError } from "@/lib/agents/base-agent";
import { FollowUpGeneratorAgent } from "@/lib/agents/follow-up-generator";
import { requireRole } from "@/lib/auth/role-gate";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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

  const { application_id } = (body ?? {}) as { application_id?: unknown };
  if (typeof application_id !== "string" || application_id.trim() === "") {
    return jsonError(
      "application_id is required and must be a non-empty string.",
      "missing_application_id",
      400,
    );
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

  const overLimit = await enforceLimit(supabase, organizationId, "agent_runs");
  if (overLimit) return overLimit;

  const agent = new FollowUpGeneratorAgent({
    client: supabase,
    organizationId,
    triggeredBy: profile.id as string,
  });

  try {
    const outcome = await agent.run({ applicationId: application_id.trim() });
    return NextResponse.json({
      ...outcome.data,
      tokensUsed: outcome.tokensUsed,
      durationMs: outcome.durationMs,
    });
  } catch (err) {
    if (err instanceof AgentError) {
      return jsonError(err.message, err.code, err.status);
    }
    return jsonError(
      "Follow-up generation failed. Please try again.",
      "agent_failed",
      500,
    );
  }
}
