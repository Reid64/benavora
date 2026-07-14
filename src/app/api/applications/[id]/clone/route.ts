import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { logAudit } from "@/lib/audit/logger";
import type { Database } from "@/types/database";

// POST /api/applications/[id]/clone
//
// Clones an application's latest draft onto a new target opportunity: creates
// a fresh application in the "discovered" stage, adapts the source draft for
// the new funder via Claude, and saves the adaptation as a new draft_versions
// row. organization_id is always derived from the caller's session, never the
// request body.

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: { id: string } };
type PipelineStage = Database["public"]["Enums"]["pipeline_stage"];
type DraftTemplateType = Database["public"]["Enums"]["draft_template_type"];

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function formatAmount(opp: {
  amount_available: unknown;
  amount_min: unknown;
  amount_max: unknown;
}): string {
  const avail = opp.amount_available;
  if (typeof avail === "number" && avail > 0) return `$${avail.toLocaleString()}`;
  const min = opp.amount_min;
  const max = opp.amount_max;
  if (typeof min === "number" && typeof max === "number")
    return `$${min.toLocaleString()} – $${max.toLocaleString()}`;
  if (typeof max === "number") return `Up to $${max.toLocaleString()}`;
  return "Not specified";
}

export async function POST(request: Request, { params }: RouteContext) {
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;
  const { supabase, userId, organizationId } = roleCheck;

  const sourceApplicationId = params.id;

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
    return jsonError(
      "targetOpportunityId is required.",
      "invalid_input",
      400,
    );
  }

  // Source application (RLS-scoped to the caller's organization).
  const { data: sourceApp, error: sourceAppError } = await supabase
    .from("applications")
    .select("id, opportunity_id, requested_amount")
    .eq("id", sourceApplicationId)
    .single();
  if (sourceAppError || !sourceApp) {
    return jsonError("Source application not found.", "not_found", 404);
  }

  const { data: sourceOpportunity } = await supabase
    .from("opportunities")
    .select("name")
    .eq("id", sourceApp.opportunity_id as string)
    .maybeSingle();
  const sourceOpportunityName =
    (sourceOpportunity?.name as string | null) ?? "the original opportunity";

  // Target opportunity (RLS-scoped).
  const { data: targetOpportunity, error: targetOppError } = await supabase
    .from("opportunities")
    .select(
      "id, name, description, eligibility_requirements, amount_min, amount_max, amount_available, deadline",
    )
    .eq("id", targetOpportunityId)
    .single();
  if (targetOppError || !targetOpportunity) {
    return jsonError("Target opportunity not found.", "not_found", 404);
  }

  // Latest draft for the source application's opportunity.
  const { data: latestDraft } = await supabase
    .from("draft_versions")
    .select("content, template_type")
    .eq("opportunity_id", sourceApp.opportunity_id as string)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  // New application in the discovery stage.
  const { data: newApplication, error: insertAppError } = await supabase
    .from("applications")
    .insert({
      organization_id: organizationId,
      opportunity_id: targetOpportunityId,
      stage: "discovered" as PipelineStage,
      requested_amount: (sourceApp.requested_amount as number | null) ?? null,
    })
    .select("id")
    .single();
  if (insertAppError || !newApplication) {
    return jsonError(
      insertAppError?.message ?? "Could not create the cloned application.",
      "write_failed",
      500,
    );
  }
  const newApplicationId = newApplication.id as string;

  await supabase.from("pipeline_history").insert({
    organization_id: organizationId,
    application_id: newApplicationId,
    from_stage: null,
    to_stage: "discovered",
    changed_by: userId,
    notes: `Cloned from application ${sourceApplicationId}.`,
  });

  // Adapt the draft for the new opportunity via Claude, when one exists.
  let tokensUsed = 0;
  const draftContent = latestDraft?.content as string | null | undefined;
  if (draftContent && draftContent.trim() !== "") {
    const { data: configRows } = await supabase
      .from("platform_config")
      .select("key, value")
      .in("key", ["ai.model", "ai.max_tokens"]);
    const config = new Map<string, string>(
      (configRows ?? []).map((r) => [r.key as string, r.value as string]),
    );
    const model = config.get("ai.model") ?? DEFAULT_MODEL;
    const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;

    const prompt = [
      "You are adapting a grant application draft that was written for one funding opportunity to suit a different one.",
      "Preserve the winning structure, persuasive language, and narrative arc. Update only what must change: funder-specific references, dollar amounts, and eligibility claims.",
      "",
      `ORIGINAL APPLICATION (for: ${sourceOpportunityName}):`,
      draftContent,
      "",
      "TARGET OPPORTUNITY:",
      `Name: ${targetOpportunity.name as string}`,
      `Description: ${(targetOpportunity.description as string | null) ?? "No description provided."}`,
      `Eligibility: ${(targetOpportunity.eligibility_requirements as string | null) ?? "Not specified."}`,
      `Funding amount: ${formatAmount(targetOpportunity)}`,
      `Deadline: ${(targetOpportunity.deadline as string | null) ?? "No deadline specified."}`,
      "",
      "Return ONLY the adapted grant application text. Do not include any explanation or preamble.",
    ].join("\n");

    try {
      const response = await callClaude({ prompt, model, maxTokens });
      const adaptedContent = response.text.trim();
      tokensUsed = response.usage.totalTokens;
      const templateType =
        (latestDraft?.template_type as DraftTemplateType | null) ??
        "grant_narrative";

      const { error: draftInsertError } = await supabase
        .from("draft_versions")
        .insert({
          organization_id: organizationId,
          opportunity_id: targetOpportunityId,
          application_id: newApplicationId,
          template_type: templateType,
          content: adaptedContent,
          humanization_status: "not_humanized",
          source: `Adapted from ${sourceOpportunityName}`,
          created_by: userId,
        });
      if (draftInsertError) {
        console.error(
          "CLONE DRAFT VERSION SAVE ERROR:",
          draftInsertError.message,
        );
      } else {
        await supabase
          .from("applications")
          .update({
            draft_content: adaptedContent,
            draft_template_type: templateType,
            updated_at: new Date().toISOString(),
          })
          .eq("id", newApplicationId);
      }
    } catch (err: unknown) {
      console.error(
        "CLONE DRAFT ADAPTATION ERROR:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  await logAudit(supabase, {
    organizationId,
    userId,
    action: "create",
    entityType: "application",
    entityId: newApplicationId,
    details: {
      cloned_from: sourceApplicationId,
      target_opportunity_id: targetOpportunityId,
    },
    request,
  });

  return NextResponse.json({ newApplicationId, tokensUsed });
}
