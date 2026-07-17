// Lightweight application clone endpoint (list-page "Clone" action).
// POST /api/applications/[id]/clone
// Distinct from /api/agents/application-cloner (Agent 26, detail-page entry
// point) - this route is the simpler path wired to the Applications list page's
// clone modal. See memory: benavora-application-cloning-two-entry-points.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { targetOpportunityId } = (body ?? {}) as {
    targetOpportunityId?: unknown;
  };
  if (
    typeof targetOpportunityId !== "string" ||
    targetOpportunityId.trim() === ""
  ) {
    return jsonError("targetOpportunityId is required.", "invalid_input", 400);
  }

  const { data: source, error: sourceError } = await supabase
    .from("applications")
    .select("id, draft_content, requested_amount, organization_id")
    .eq("id", params.id)
    .eq("organization_id", organizationId)
    .single();

  if (sourceError || !source) {
    return jsonError("Source application not found.", "not_found", 404);
  }

  const { data: targetOpportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, name, description")
    .eq("id", targetOpportunityId.trim())
    .eq("organization_id", organizationId)
    .single();

  if (oppError || !targetOpportunity) {
    return jsonError("Target opportunity not found.", "not_found", 404);
  }

  const draftContent = (source.draft_content as string | null) ?? "";
  const targetName = targetOpportunity.name as string;
  const targetDescription =
    (targetOpportunity.description as string | null) ?? "No description provided.";

  let adaptedDraft = draftContent;
  if (draftContent.trim() !== "") {
    const prompt = `Adapt this grant application draft for a new opportunity. Original draft: ${draftContent}. New opportunity: ${targetName} - ${targetDescription}. Preserve the organization mission, programs, and impact data. Adapt the language to match the new funder priorities. Return only the adapted narrative text.`;

    try {
      const response = await callClaude({
        prompt,
        model: DEFAULT_MODEL,
        maxTokens: DEFAULT_MAX_TOKENS,
      });
      adaptedDraft = response.text.trim();
    } catch {
      return jsonError(
        "Could not generate the adapted draft. Please try again.",
        "ai_call_failed",
        502,
      );
    }
  }

  const { data: newApplication, error: insertError } = await supabase
    .from("applications")
    .insert({
      organization_id: organizationId,
      opportunity_id: targetOpportunityId.trim(),
      stage: "drafting",
      draft_content: adaptedDraft,
      requested_amount: (source.requested_amount as number | null) ?? null,
    })
    .select("id")
    .single();

  if (insertError || !newApplication) {
    return jsonError(
      "Could not create the cloned application.",
      "insert_failed",
      500,
    );
  }

  return NextResponse.json({
    newApplicationId: newApplication.id as string,
  });
}
