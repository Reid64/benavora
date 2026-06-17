import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/utils/constants";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// Verbatim copy from /api/ai/draft/route.ts (BEHAVIORAL_CONTRACTS §9 / Agent 05).
function computeConfidence(
  draftText: string,
  kbCount: number,
  provenCount: number,
): number {
  const needsInput = (draftText.match(/\[NEEDS INPUT/gi) ?? []).length;

  if (kbCount === 0) {
    return Math.max(55, 65 - needsInput * 3);
  }

  let score = 92;
  if (provenCount === 0) score -= 4;
  if (kbCount < 3) score -= 12;
  score -= needsInput * 3;

  return Math.max(0, Math.min(100, score));
}

export async function POST(request: Request) {
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;
  const { supabase } = roleCheck;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { content, opportunityId, templateType } = (body ?? {}) as {
    content?: unknown;
    opportunityId?: unknown;
    templateType?: unknown;
  };

  if (typeof content !== "string" || content.trim() === "") {
    return jsonError("content is required.", "invalid_input", 400);
  }
  if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
    return jsonError("opportunityId is required.", "invalid_input", 400);
  }
  if (typeof templateType !== "string" || templateType.trim() === "") {
    return jsonError("templateType is required.", "invalid_input", 400);
  }

  // Load opportunity to get funder category for proven_narratives filter.
  // RLS scopes this to the caller's organization.
  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("category")
    .eq("id", opportunityId)
    .single();

  if (oppError || !opportunity) {
    return jsonError("Opportunity not found.", "not_found", 404);
  }

  // KB count and proven narrative count in parallel.
  // RLS scopes both queries to the caller's organization_id automatically.
  const [kbRes, provenRes] = await Promise.all([
    supabase
      .from("knowledge_base")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("proven_narratives")
      .select("id", { count: "exact", head: true })
      .eq("funder_category", opportunity.category),
  ]);

  const kbCount = kbRes.count ?? 0;
  const provenCount = provenRes.count ?? 0;

  const confidenceScore = computeConfidence(content, kbCount, provenCount);
  const needsInputCount = (content.match(/\[NEEDS INPUT/gi) ?? []).length;

  return NextResponse.json({
    confidenceScore,
    needsInputCount,
    belowThreshold: confidenceScore < AI_CONFIDENCE_THRESHOLD,
  });
}
