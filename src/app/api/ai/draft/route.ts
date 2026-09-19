import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { logAudit } from "@/lib/audit/logger";
import { createClient } from "@/lib/supabase/server";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { trackUsage } from "@/lib/billing/usage-tracker";
import { withUsageCheck } from "@/lib/billing/usage-middleware";
import { incrementUsage } from "@/lib/billing/usage-limiter";
import { checkTierGate } from "@/lib/services/tier-gate";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/utils/constants";
import { generateDraft, VALID_TEMPLATE_TYPES } from "@/lib/drafts/generator";
import type { DraftResult, DraftTemplateType } from "@/types/ai";

export const runtime = "nodejs";
// A full grant narrative can use the entire ai.max_tokens budget (8192), and a
// non-streaming Claude completion only returns once the whole draft is written -
// measured at ~180s for a max-length proposal. The previous 60s function limit
// (vercel.json) killed the function mid-callClaude before it could save the
// draft_version or mark the agent_run completed/failed, leaving the run stuck
// "running" and the client showing the last saved draft. Give generation room.
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

// Best-effort per-organization rate limit for AI routes: 20 requests / minute
// (BEHAVIORAL_CONTRACTS §16). In-memory; a shared store is the production fix.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function isRateLimited(orgId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(orgId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(orgId, recent);
    return true;
  }
  recent.push(now);
  hits.set(orgId, recent);
  return false;
}

export async function POST(request: Request) {
  // Generating a draft is a write action - viewers are read-only (Contracts §16).
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { opportunityId, templateType } = (body ?? {}) as {
    opportunityId?: unknown;
    templateType?: unknown;
  };

  if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
    return jsonError("opportunityId is required.", "invalid_input", 400);
  }
  if (
    typeof templateType !== "string" ||
    !VALID_TEMPLATE_TYPES.includes(templateType as DraftTemplateType)
  ) {
    return jsonError("A valid templateType is required.", "invalid_input", 400);
  }
  const template = templateType as DraftTemplateType;

  const supabase = createClient();

  // Authenticate via the session (BEHAVIORAL_CONTRACTS §16).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  // Derive organization_id server-side from the profile - never from the body.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return jsonError("Could not resolve your profile.", "no_profile", 403);
  }
  const organizationId = profile.organization_id as string;

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many draft requests. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  // Feature-level tier gate: draft_generation cap per tier (Contracts §25).
  const draftGate = await checkTierGate(organizationId, "draft_generation");
  if (!draftGate.allowed) {
    return NextResponse.json(
      {
        error: `Your plan allows ${draftGate.limit} AI drafts per month. Upgrade to continue.`,
        code: "tier_limit_exceeded",
        allowed: false,
        remaining: draftGate.remaining,
        limit: draftGate.limit,
      },
      { status: 429 },
    );
  }

  // Daily AI-request quota for the org's tier (Behavioral Contracts §25).
  const overLimit = await enforceLimit(supabase, organizationId, "api_calls");
  if (overLimit) return overLimit;

  // Monthly AI-drafts quota (usage-limiter tier limits).
  const draftLimitBlocked = await withUsageCheck(supabase, organizationId, "ai_drafts");
  if (draftLimitBlocked) return draftLimitBlocked;

  // Opportunity (RLS-scoped to the organization).
  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("*")
    .eq("id", opportunityId)
    .single();
  if (oppError || !opportunity) {
    return jsonError("Opportunity not found.", "not_found", 404);
  }

  // Log the agent run before starting (BEHAVIORAL_CONTRACTS §15). Best-effort:
  // a logging failure must not block drafting.
  const startedAt = Date.now();
  let runId: string | null = null;
  {
    const { data: run } = await supabase
      .from("agent_runs")
      .insert({
        organization_id: organizationId,
        agent_type: "narrative_drafting",
        status: "running",
        triggered_by: profile.id,
        input_params: { opportunityId, templateType: template },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    runId = run?.id ?? null;
  }

  try {
    const output = await generateDraft({
      supabase,
      organizationId,
      opportunityId,
      templateType: template,
      createdByUserId: profile.id,
    });

    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          output_summary: `Drafted ${template} (confidence ${output.confidenceScore}, ${output.sources.length} sources).`,
          items_found: output.sources.length,
          items_processed: 1,
          tokens_used: output.tokensUsed,
          duration_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    await trackUsage(supabase, organizationId, "api_calls", 1);
    await incrementUsage(supabase, organizationId, "ai_drafts");

    await logAudit(supabase, {
      organizationId,
      userId: profile.id,
      action: "agent_run",
      entityType: "opportunity",
      entityId: opportunityId,
      details: {
        templateType: template,
        confidenceScore: output.confidenceScore,
        sourcesCount: output.sources.length,
      },
    });

    const result: DraftResult & {
      belowThreshold: boolean;
      rubricDimensions?: Array<{
        name: string;
        points: number | null;
        description: string | null;
      }>;
    } = {
      content: output.content,
      confidenceScore: output.confidenceScore,
      sources: output.sources,
      savedVersion: output.savedVersion,
      belowThreshold: output.confidenceScore < AI_CONFIDENCE_THRESHOLD,
      rubricDimensions:
        output.rubricDimensionSummary.length > 0
          ? output.rubricDimensionSummary
          : undefined,
      logicModel: output.logicModel ?? undefined,
      complianceChecklist: output.complianceChecklist ?? undefined,
      incomplete: output.incomplete,
      missingFacts: output.missingFacts,
      scrubbedFigures: output.scrubbedFigures,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("DRAFT ERROR:", err);
    const message =
      err instanceof Error ? err.message : "Draft generation failed.";
    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "failed",
          error_message: message,
          duration_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return jsonError(
      "The draft could not be generated. Please try again.",
      "generation_failed",
      500,
    );
  }
}

