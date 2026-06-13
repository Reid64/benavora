import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { trackUsage } from "@/lib/billing/usage-tracker";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
} from "@/lib/ai/claude";
import {
  validateOpportunity,
  type ValidationOpportunity,
} from "@/lib/agents/consensus-validator";

// Cross-provider validation endpoint (migration 014, consensus-validator).
// Sends a discovered opportunity to two INDEPENDENT AI providers (Anthropic
// Claude + free-tier Google Gemini) which each judge existence, eligibility,
// deadline, and amounts. Each verdict is upserted to `validations`; the
// opportunity earns the "Verified" badge only when both providers agree.
// Logs to agent_runs with token tracking (BEHAVIORAL_CONTRACTS §15, §16).

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  // Consistent error shape across API routes (BEHAVIORAL_CONTRACTS §16).
  return NextResponse.json({ error: message, code }, { status });
}

// Best-effort per-organization rate limit for AI routes: 20 requests / minute
// (BEHAVIORAL_CONTRACTS §16). In-memory; protects a single instance only.
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
  // Running an agent is a write action - viewers are read-only (Contracts §16).
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, userId, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { opportunityId } = (body ?? {}) as { opportunityId?: unknown };
  if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
    return jsonError("opportunityId is required.", "invalid_input", 400);
  }

  if (isRateLimited(organizationId)) {
    return jsonError(
      "Too many validation requests. Please wait a moment and try again.",
      "rate_limited",
      429,
    );
  }

  // Daily AI-request quota for the org's tier (Behavioral Contracts §25).
  const overLimit = await enforceLimit(supabase, organizationId, "api_calls");
  if (overLimit) return overLimit;

  // Opportunity (RLS-scoped to the organization).
  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select(
      "id, name, category, description, funder_id, url, eligibility_requirements, deadline, amount_min, amount_max, amount_available, geographic_restrictions",
    )
    .eq("id", opportunityId)
    .single();
  if (oppError || !opportunity) {
    return jsonError("Opportunity not found.", "not_found", 404);
  }

  // Resolve config (platform_config overrides, then defaults).
  const { data: configRows } = await supabase
    .from("platform_config")
    .select("key, value")
    .in("key", ["ai.model", "ai.max_tokens"]);
  const config = new Map<string, string>(
    (configRows ?? []).map((r) => [r.key as string, r.value as string]),
  );
  const model = config.get("ai.model") ?? DEFAULT_MODEL;
  const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;

  // Funder name (best-effort) for the existence check.
  let funderName: string | null = null;
  if (opportunity.funder_id) {
    const { data: funder } = await supabase
      .from("funders")
      .select("name")
      .eq("id", opportunity.funder_id)
      .single();
    funderName = (funder?.name as string | null) ?? null;
  }

  // Log the agent run before starting (BEHAVIORAL_CONTRACTS §15). Best-effort.
  const startedAt = Date.now();
  let runId: string | null = null;
  {
    const { data: run } = await supabase
      .from("agent_runs")
      .insert({
        organization_id: organizationId,
        agent_type: "consensus_validation",
        status: "running",
        triggered_by: userId,
        input_params: { opportunityId },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    runId = run?.id ?? null;
  }

  try {
    const validationOpportunity: ValidationOpportunity = {
      name: opportunity.name as string,
      category: opportunity.category as string,
      description: (opportunity.description as string | null) ?? null,
      funderName,
      url: (opportunity.url as string | null) ?? null,
      eligibilityRequirements:
        (opportunity.eligibility_requirements as string | null) ?? null,
      deadline: (opportunity.deadline as string | null) ?? null,
      amountMin: (opportunity.amount_min as number | null) ?? null,
      amountMax: (opportunity.amount_max as number | null) ?? null,
      amountAvailable: (opportunity.amount_available as number | null) ?? null,
      geographicRestrictions:
        (opportunity.geographic_restrictions as string | null) ?? null,
    };

    const result = await validateOpportunity({
      client: supabase,
      organizationId,
      opportunityId: opportunity.id as string,
      opportunity: validationOpportunity,
      createdBy: userId,
      claudeModel: model,
      geminiModel: undefined,
      // A verdict is small structured JSON - a tight ceiling keeps cost down.
      maxTokens: Math.min(maxTokens, 1024),
    });

    // A validation is only meaningful if at least one provider responded.
    const responded = result.providers.filter((p) => p.verdict);
    if (responded.length === 0) {
      const detail =
        result.providers.find((p) => p.error)?.error ??
        "No AI provider returned a verdict.";
      throw new Error(detail);
    }

    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          output_summary: `Validation of "${opportunity.name}": ${result.consensus.label} (${responded.length}/2 providers responded).`,
          items_found: result.providers.length,
          items_processed: responded.length,
          tokens_used: result.totalTokens,
          duration_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    // Meter the AI request against the org's daily api_calls quota (§25).
    await trackUsage(supabase, organizationId, "api_calls", 1);

    return NextResponse.json({
      consensus: result.consensus,
      providers: result.providers.map((p) => ({
        provider: p.provider,
        providerLabel: p.providerLabel,
        model: p.model,
        verdict: p.verdict,
        error: p.error ?? null,
      })),
      tokensUsed: result.totalTokens,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Validation failed.";
    if (runId) {
      // Agents never fail silently (BEHAVIORAL_CONTRACTS §15).
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
      "The opportunity could not be validated. Please try again.",
      "validation_failed",
      500,
    );
  }
}
