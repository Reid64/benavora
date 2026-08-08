import { NextResponse } from "next/server";

import { deployDisasterResponse } from "@/lib/agents/disaster-response-agent";
import { requireRole } from "@/lib/auth/role-gate";

// GET/PATCH /api/autonomous/decisions - the audit trail of autonomous agent
// decisions (agent_decisions, migration 080). organization_id is always
// derived server-side via requireRole, never from the request body
// (Contracts §2).
//
// GET   - newest first, limit 50. Optional ?agentId= filter, optional
//         ?requiresReview=true filter (required_human_review=true AND not
//         yet reviewed), optional ?cursor=<created_at ISO> for pagination
//         (returns rows strictly older than the cursor).
// PATCH - records a human verdict on one decision: { id, verdict, notes? }.
//         agent_decisions has no dedicated notes column, so notes are folded
//         into action_payload.review_notes (same convention as
//         AutonomousAgent.createNotification's metadata handling).
//
//         AGENTS_v2.md AG-25 / row #130 "Auto-Deploy Response": approving a
//         `disaster_response_deploy` decision here is a one-click action, not
//         just record-keeping — it calls the real deployDisasterResponse()
//         using the declarationId stashed in action_payload by
//         worker/autonomous-orchestrator.ts's runDisasterResponsePipeline,
//         and folds the deployment outcome back into action_payload. This
//         reuses the existing approve/reject mechanism already wired into
//         the Decision Log UI (/settings/agents) rather than inventing a
//         second approval flow. Idempotent: a decision that already has
//         action_payload.deployment_result is never re-deployed.

export const runtime = "nodejs";

const VALID_VERDICTS = ["approved", "rejected", "modified"];
const DISASTER_RESPONSE_DEPLOY_DECISION_TYPE = "disaster_response_deploy";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");
  const requiresReview = url.searchParams.get("requiresReview") === "true";
  const cursor = url.searchParams.get("cursor");

  let query = supabase
    .from("agent_decisions")
    .select(
      "id, org_id, agent_run_id, agent_id, decision_type, entity_type, entity_id, " +
        "reasoning, confidence_score, action_taken, action_payload, " +
        "required_human_review, human_reviewed_at, human_reviewer_id, human_verdict, created_at",
    )
    .eq("org_id", organizationId);

  if (agentId) query = query.eq("agent_id", agentId);
  if (requiresReview) {
    query = query.eq("required_human_review", true).is("human_reviewed_at", null);
  }
  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return jsonError("Could not load agent decisions.", "load_failed", 500);
  }

  return NextResponse.json({ decisions: data ?? [] });
}

export async function PATCH(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { id, verdict, notes } = (body ?? {}) as {
    id?: unknown;
    verdict?: unknown;
    notes?: unknown;
  };

  if (typeof id !== "string" || id.trim() === "") {
    return jsonError("id is required.", "invalid_input", 400);
  }
  if (typeof verdict !== "string" || !VALID_VERDICTS.includes(verdict)) {
    return jsonError(
      `verdict must be one of: ${VALID_VERDICTS.join(", ")}.`,
      "invalid_input",
      400,
    );
  }
  if (notes !== undefined && typeof notes !== "string") {
    return jsonError("notes must be a string.", "invalid_input", 400);
  }

  const { data: existing, error: fetchError } = await supabase
    .from("agent_decisions")
    .select("decision_type, action_payload")
    .eq("id", id)
    .eq("org_id", organizationId)
    .single();

  if (fetchError || !existing) {
    return jsonError("Decision not found.", "not_found", 404);
  }

  const currentPayload =
    typeof existing.action_payload === "object" && existing.action_payload !== null
      ? (existing.action_payload as Record<string, unknown>)
      : {};

  const patch: Record<string, unknown> = {
    human_reviewed_at: new Date().toISOString(),
    human_reviewer_id: userId,
    human_verdict: verdict,
  };

  let nextPayload = currentPayload;

  if (typeof notes === "string" && notes.trim() !== "") {
    nextPayload = { ...nextPayload, review_notes: notes.trim() };
  }

  if (
    verdict === "approved" &&
    existing.decision_type === DISASTER_RESPONSE_DEPLOY_DECISION_TYPE &&
    !nextPayload.deployment_result
  ) {
    const declarationId = (nextPayload as { declarationId?: unknown }).declarationId;
    if (typeof declarationId === "string" && declarationId.trim() !== "") {
      try {
        const result = await deployDisasterResponse(
          declarationId,
          organizationId,
          supabase,
        );
        nextPayload = { ...nextPayload, deployment_result: result };
      } catch (err) {
        nextPayload = {
          ...nextPayload,
          deployment_error:
            err instanceof Error
              ? err.message
              : "Disaster response deployment failed.",
        };
      }
    }
  }

  if (nextPayload !== currentPayload) {
    patch.action_payload = nextPayload;
  }

  const { data, error } = await supabase
    .from("agent_decisions")
    .update(patch)
    .eq("id", id)
    .eq("org_id", organizationId)
    .select("id, human_reviewed_at, human_reviewer_id, human_verdict, action_payload")
    .single();

  if (error || !data) {
    return jsonError("Could not update decision.", "update_failed", 404);
  }

  return NextResponse.json({ decision: data });
}
