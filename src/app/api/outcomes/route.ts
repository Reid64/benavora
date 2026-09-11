import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { AgentError } from "@/lib/agents/base-agent";
import { RecursiveLearningAgent } from "@/lib/agents/recursive-learning";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import type { Enums } from "@/types/database";

// POST /api/outcomes - server-side outcome recording (BLUEPRINT §4.10,
// Behavioral Contracts §10). Until this route existed, the only way to record
// an outcome was the Outcomes page's client-side Supabase insert
// (src/components/outcomes/OutcomeForm.tsx) - fine for a human in the
// browser, but nothing server-side (integrations, inbound-email award
// detection, scripts) could record one. This mirrors that form's insert and
// its recursive-learning trigger so both paths converge on the same pipeline.
//
// organization_id and recorded_by are always derived from the session
// (Contracts §2), never the body. Recording an outcome is a write action, so
// viewers are rejected (Contracts §16).

export const runtime = "nodejs";
export const maxDuration = 300;

type OutcomeResult = Enums<"outcome_result">;

const RESULT_VALUES: OutcomeResult[] = ["awarded", "denied", "partial"];

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

interface OutcomeRequestBody {
  application_id?: unknown;
  result?: unknown;
  funder_feedback?: unknown;
  denial_reason?: unknown;
  amount_awarded?: unknown;
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  if (!checkRateLimit(`outcomes-record:${organizationId}`, 30)) {
    return jsonError(
      "Too many outcome submissions. Try again in a bit.",
      "rate_limited",
      429,
    );
  }

  let body: OutcomeRequestBody;
  try {
    body = (await request.json()) as OutcomeRequestBody;
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const applicationId = body.application_id;
  const result = body.result;

  if (typeof applicationId !== "string" || applicationId.trim() === "") {
    return jsonError("application_id is required.", "invalid_input", 400);
  }
  if (
    typeof result !== "string" ||
    !RESULT_VALUES.includes(result as OutcomeResult)
  ) {
    return jsonError(
      `result must be one of: ${RESULT_VALUES.join(", ")}.`,
      "invalid_input",
      400,
    );
  }

  let awardedAmount: number | null = null;
  if (result === "awarded" || result === "partial") {
    if (body.amount_awarded !== undefined && body.amount_awarded !== null) {
      const n = Number(body.amount_awarded);
      if (!Number.isFinite(n) || n < 0) {
        return jsonError(
          "amount_awarded must be a non-negative number.",
          "invalid_input",
          400,
        );
      }
      awardedAmount = n;
    }
  }

  const funderFeedback =
    typeof body.funder_feedback === "string" && body.funder_feedback.trim() !== ""
      ? body.funder_feedback.trim()
      : null;
  const denialReason =
    result === "denied" &&
    typeof body.denial_reason === "string" &&
    body.denial_reason.trim() !== ""
      ? body.denial_reason.trim()
      : null;

  // Resolve the application within this org, plus its opportunity/funder for
  // the category + keyword snapshot the learning agent reads later.
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("id, requested_amount, draft_content, opportunity_id")
    .eq("id", applicationId)
    .eq("organization_id", organizationId)
    .single();
  if (appError || !application) {
    return jsonError(
      "Application not found in your organization.",
      "not_found",
      404,
    );
  }

  const { data: opportunity } = await supabase
    .from("opportunities")
    .select("category, funder_id")
    .eq("id", application.opportunity_id as string)
    .maybeSingle();

  let funderCategory = (opportunity?.category as Enums<"funder_category"> | null) ?? null;
  if (opportunity?.funder_id) {
    const { data: funder } = await supabase
      .from("funders")
      .select("category")
      .eq("id", opportunity.funder_id as string)
      .maybeSingle();
    if (funder?.category) funderCategory = funder.category as Enums<"funder_category">;
  }

  const { data: keywordRows } = await supabase
    .from("opportunity_keywords")
    .select("keyword")
    .eq("opportunity_id", application.opportunity_id as string);
  const keywords = (keywordRows ?? []).map((k) => k.keyword as string);

  const draftContent = application.draft_content as string | null;

  const { data: outcome, error: insertError } = await supabase
    .from("outcomes")
    .insert({
      organization_id: organizationId,
      application_id: application.id as string,
      result: result as OutcomeResult,
      awarded_amount: awardedAmount,
      requested_amount: application.requested_amount as number | null,
      funder_feedback: funderFeedback,
      denial_reason: denialReason,
      narrative_snapshot: draftContent && draftContent.trim() !== "" ? draftContent : null,
      funder_category: funderCategory,
      opportunity_category: (opportunity?.category as Enums<"funder_category"> | null) ?? null,
      keywords_used: keywords.length > 0 ? keywords : null,
      recorded_by: userId,
    })
    .select("id, result")
    .single();

  if (insertError || !outcome) {
    if (insertError?.code === "23505") {
      return jsonError(
        "An outcome has already been recorded for this application.",
        "already_recorded",
        409,
      );
    }
    return jsonError("Could not record the outcome.", "insert_failed", 500);
  }

  // Trigger the Recursive Learning Agent (Agent 10), same as the Outcomes
  // page's /api/agents/learning call, run in-process since we're already
  // server-side. Best-effort: the outcome is already saved, so a learning
  // failure must not fail this request.
  let learning: { triggered: boolean; error?: string } = { triggered: false };
  const overLimit = await enforceLimit(supabase, organizationId, "agent_runs");
  if (overLimit) {
    learning = { triggered: false, error: "agent_run_quota_exceeded" };
  } else {
    try {
      const agent = new RecursiveLearningAgent({
        client: supabase,
        organizationId,
        triggeredBy: userId,
        model: DEFAULT_MODEL,
        maxTokens: DEFAULT_MAX_TOKENS,
      });
      await agent.run({ outcomeId: outcome.id as string });
      learning = { triggered: true };
    } catch (err) {
      learning = {
        triggered: false,
        error: err instanceof AgentError ? err.message : "learning_failed",
      };
    }
  }

  return NextResponse.json({
    id: outcome.id,
    result: outcome.result,
    learning,
  });
}
