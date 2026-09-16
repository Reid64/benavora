import { NextResponse } from "next/server";

import { AgentError } from "@/lib/agents/base-agent";
import { FinalAssemblyAgent } from "@/lib/agents/final-assembly";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { requireRole } from "@/lib/auth/role-gate";

// POST /api/agents/final-assembly (Phase 5.4, 2026-09-15) - runs the
// FinalAssemblyAgent (AGENTS.md Agent 09) for an application: orders
// attached documents against the opportunity's stated requirements, builds
// a submission checklist, and optionally drafts a cover letter via Claude.
// Fired best-effort from src/components/applications/pipeline.ts's
// executeTransition() when an application moves to "submitted", the same
// pattern already used there for funder-relationship/followup-trigger/
// track-submission. Modeled directly on /api/compliance/check's route shape.

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON.", code: "invalid_body" },
      { status: 400 },
    );
  }

  const { application_id, generate_cover_letter } = (body ?? {}) as {
    application_id?: unknown;
    generate_cover_letter?: unknown;
  };
  if (typeof application_id !== "string" || !application_id.trim()) {
    return NextResponse.json(
      { error: "application_id is required.", code: "invalid_input" },
      { status: 400 },
    );
  }

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

  const agent = new FinalAssemblyAgent({
    client: supabase,
    organizationId,
    triggeredBy: userId,
    model,
    maxTokens,
  });

  try {
    const outcome = await agent.run({
      applicationId: application_id.trim(),
      generateCoverLetter: generate_cover_letter !== false,
    });

    return NextResponse.json({ data: outcome.data });
  } catch (err) {
    if (err instanceof AgentError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: "Final assembly failed. Please try again.", code: "assembly_failed" },
      { status: 500 },
    );
  }
}
