import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit/logger";
import { enforceAiRateLimit, enforceLimit } from "@/lib/billing/tier-enforcer";
import { AgentError } from "@/lib/agents/base-agent";
import { EligibilityScorer } from "@/lib/agents/eligibility-scorer";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  deriveEligibilityFlag,
  isUuid,
  resolveGrantOwnership,
} from "@/lib/grants/grants-service";

// POST /api/grants/[id]/rescore - manual eligibility re-score for one grant using
// the organization's current search profile
// (BEHAVIORAL_CONTRACTS "POST /api/grants/[id]/rescore").
//
// "Grant" maps to the live `opportunities` table; organization_id is derived from
// the session (Six Laws Law 2). The contract requires an organization search
// profile to be configured (422 NO_SEARCH_PROFILE otherwise); we verify one
// exists in `search_profiles` before scoring. Scoring reuses the real
// EligibilityScorer agent (no mocks - Iron Law 8), which compares the verified
// org profile against the opportunity, writes eligibility_score / recommendation /
// recommendation_reasoning back onto the row, and logs to agent_runs.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The scorer makes a Claude call; give it headroom over the platform default.
export const maxDuration = 120;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

type RouteContext = { params: { id: string } };

export async function POST(request: Request, { params }: RouteContext) {
  // Re-scoring is a write action (it overwrites AI-owned fields) - viewers are
  // read-only (Contracts: grants_manager, grant_researcher → ≥ writer).
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  const id = params.id;
  if (!isUuid(id)) {
    return jsonError("Grant not found.", "NOT_FOUND", 404);
  }

  // Ownership: contract's 403 (other org) vs 404 (absent).
  const ownership = await resolveGrantOwnership(createAdminClient(), id, organizationId);
  if (ownership.status === "forbidden") {
    return jsonError(
      "This grant does not belong to your organization.",
      "FORBIDDEN",
      403,
    );
  }
  if (ownership.status === "not_found") {
    return jsonError("Grant not found.", "NOT_FOUND", 404);
  }
  if (ownership.status === "error") {
    return jsonError("Database error.", "DB_ERROR", 500);
  }

  // The org must have a search profile configured (Contracts: 422 otherwise).
  // Prefer an active profile; any configured profile satisfies the requirement.
  const { data: profile, error: profileError } = await supabase
    .from("search_profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .order("is_active", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (profileError) {
    return jsonError("Database error.", "DB_ERROR", 500);
  }
  if (!profile) {
    return jsonError(
      "Your organization has no search profile configured; scoring skipped.",
      "NO_SEARCH_PROFILE",
      422,
    );
  }

  // Burst guard + metered daily agent-run quota (Contracts §16 / §25).
  const burst = enforceAiRateLimit(organizationId);
  if (burst) return burst;
  const overLimit = await enforceLimit(supabase, organizationId, "agent_runs");
  if (overLimit) return overLimit;

  // Resolve AI config (platform_config overrides, then defaults) - same posture
  // as the eligibility route.
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

  const scorer = new EligibilityScorer({
    client: supabase,
    organizationId,
    triggeredBy: userId,
    model,
    maxTokens,
  });

  try {
    await scorer.run({ opportunityId: id });
  } catch (err) {
    if (err instanceof AgentError) {
      // Distinct DB-write failures keep their 500; everything else from the AI
      // path (bad/unreadable model output, timeout, generic agent failure) is the
      // contract's 502 AI_PROVIDER_ERROR.
      if (err.code === "write_failed") {
        return jsonError("Database update failed.", "DB_ERROR", 500);
      }
      if (err.code === "not_found") {
        return jsonError("Grant not found.", "NOT_FOUND", 404);
      }
      return jsonError(
        "The scoring provider returned an error. Please try again.",
        "AI_PROVIDER_ERROR",
        502,
      );
    }
    return jsonError(
      "The scoring provider returned an error. Please try again.",
      "AI_PROVIDER_ERROR",
      502,
    );
  }

  // Re-read the persisted, agent-owned fields as the source of truth for the
  // response (the scorer stamps updated_at when it writes the score).
  const { data: scored, error: readError } = await supabase
    .from("opportunities")
    .select("eligibility_score, recommendation_reasoning, updated_at")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (readError || !scored) {
    return jsonError("Database update failed.", "DB_ERROR", 500);
  }

  const row = scored as unknown as {
    eligibility_score: number | null;
    recommendation_reasoning: string | null;
    updated_at: string;
  };

  const matchPercentage = row.eligibility_score ?? 0;
  const eligibilityFlag = deriveEligibilityFlag(row.eligibility_score);
  const eligibilityNotes = row.recommendation_reasoning ?? "";
  const scoredAt = row.updated_at;

  // Audit the AI mutation: model + resulting score (Contracts §24 / AI-mutation
  // logging). Best-effort; never blocks the response.
  await logAudit(supabase, {
    organizationId,
    userId,
    action: "agent_run",
    entityType: "opportunity",
    entityId: id,
    details: {
      operation: "grant_rescore",
      model,
      match_percentage: matchPercentage,
      eligibility_flag: eligibilityFlag,
    },
    request,
  });

  return NextResponse.json({
    data: {
      match_percentage: matchPercentage,
      eligibility_flag: eligibilityFlag,
      eligibility_notes: eligibilityNotes,
      eligibility_scored_at: scoredAt,
    },
  });
}
