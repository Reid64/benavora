import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { runHumanizer } from "@/lib/agents/humanizer-agent";

// POST /api/outreach/humanize-step
// Lightweight humanizer pass for a single campaign email step body.
// Shares the same runHumanizer pipeline as /api/ai/humanize but does not
// require an opportunityId — it loads org context from the session profile.
// Returns { content: string } on success.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Authentication required.", "unauthenticated", 401);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile)
    return jsonError("Could not resolve your profile.", "no_profile", 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { text } = (body ?? {}) as { text?: unknown };
  if (typeof text !== "string" || text.trim() === "")
    return jsonError("text is required.", "validation_error", 400);

  const organizationId = profile.organization_id as string;

  const { data: org } = await supabase
    .from("organizations")
    .select(
      "name, dba, ein, tax_status, mission_statement, vision_statement, service_area, target_population, founder_name, annual_budget",
    )
    .eq("id", organizationId)
    .single();

  try {
    const result = await runHumanizer({
      draft: text.trim(),
      templateType: "donation_request_letter",
      organization: org
        ? {
            name: org.name as string,
            dba: (org.dba as string | null) ?? null,
            ein: (org.ein as string | null) ?? null,
            taxStatus: (org.tax_status as string | null) ?? null,
            missionStatement: (org.mission_statement as string | null) ?? null,
            visionStatement: (org.vision_statement as string | null) ?? null,
            serviceArea: (org.service_area as string | null) ?? null,
            targetPopulation: (org.target_population as string | null) ?? null,
            founderName: (org.founder_name as string | null) ?? null,
            annualBudget: (org.annual_budget as number | null) ?? null,
          }
        : null,
      knowledgeEntries: [],
      provenNarratives: [],
      model: DEFAULT_MODEL,
      maxTokens: DEFAULT_MAX_TOKENS,
    });

    return NextResponse.json({ content: result.content });
  } catch (err) {
    console.error("HUMANIZE STEP ERROR:", err);
    return jsonError(
      "Humanization failed. The original text will be used.",
      "humanization_failed",
      500,
    );
  }
}
