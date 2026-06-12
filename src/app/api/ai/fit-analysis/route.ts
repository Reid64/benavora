import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { trackUsage } from "@/lib/billing/usage-tracker";
import { createClient } from "@/lib/supabase/server";
import {
  callClaude,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
} from "@/lib/ai/claude";
import {
  buildFitAnalysisPrompt,
  type FitAnalysisContext,
} from "@/lib/ai/prompts/fit-analysis";

// Fit Analysis endpoint (AGENTS.md Agent 04). A deeper "should we apply?" pass
// than eligibility scoring: it weighs effort vs. reward, program alignment,
// competitive landscape, and strategic value, informed by the organization's
// historical success rate with the funder category when enough outcomes exist
// (BEHAVIORAL_CONTRACTS §10). Logs to agent_runs with token tracking (§15).

export const runtime = "nodejs";

// Default minimum outcomes before a success rate is considered meaningful
// (BEHAVIORAL_CONTRACTS §10); overridable via the
// learning.min_outcomes_for_scoring platform_config flag.
const DEFAULT_MIN_OUTCOMES = 5;

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
  // Running an agent is a write action — viewers are read-only (Contracts §16).
  const roleCheck = await requireRole("writer");
  if ("error" in roleCheck) return roleCheck.error;

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

  const supabase = createClient();

  // Authenticate via the session (BEHAVIORAL_CONTRACTS §16).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError("Authentication required.", "unauthenticated", 401);
  }

  // Derive organization_id server-side from the profile — never from the body.
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
      "Too many fit-analysis requests. Please wait a moment and try again.",
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
      "id, name, category, description, funder_id, eligibility_requirements, amount_min, amount_max, eligibility_score",
    )
    .eq("id", opportunityId)
    .single();
  if (oppError || !opportunity) {
    return jsonError("Opportunity not found.", "not_found", 404);
  }

  // Log the agent run before starting (BEHAVIORAL_CONTRACTS §15). Best-effort.
  const startedAt = Date.now();
  let runId: string | null = null;
  {
    const { data: run } = await supabase
      .from("agent_runs")
      .insert({
        organization_id: organizationId,
        agent_type: "fit_analysis",
        status: "running",
        triggered_by: profile.id,
        input_params: { opportunityId },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    runId = run?.id ?? null;
  }

  try {
    // Resolve config (platform_config overrides, then defaults).
    const { data: configRows } = await supabase
      .from("platform_config")
      .select("key, value")
      .in("key", ["ai.model", "ai.max_tokens", "learning.min_outcomes_for_scoring"]);
    const config = new Map<string, string>(
      (configRows ?? []).map((r) => [r.key as string, r.value as string]),
    );
    const model = config.get("ai.model") ?? DEFAULT_MODEL;
    const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;
    const minOutcomes =
      Number(config.get("learning.min_outcomes_for_scoring")) ||
      DEFAULT_MIN_OUTCOMES;

    // Organization profile, programs, funder name, and historical outcomes for
    // this funder category (the basis for the success rate).
    const [orgRes, programsRes, funderRes, outcomesRes] = await Promise.all([
      supabase
        .from("organizations")
        .select(
          "name, mission_statement, service_area, target_population, annual_budget",
        )
        .eq("id", organizationId)
        .single(),
      supabase
        .from("programs")
        .select("name")
        .eq("organization_id", organizationId),
      opportunity.funder_id
        ? supabase
            .from("funders")
            .select("name")
            .eq("id", opportunity.funder_id)
            .single()
        : Promise.resolve({ data: null }),
      supabase
        .from("outcomes")
        .select("result")
        .eq("funder_category", opportunity.category),
    ]);

    // Historical success rate (BEHAVIORAL_CONTRACTS §10): awarded / total * 100,
    // shown only when the sample reaches the minimum.
    const outcomeRows = outcomesRes.data ?? [];
    const totalOutcomes = outcomeRows.length;
    const awardedCount = outcomeRows.filter(
      (o) => (o.result as string) === "awarded",
    ).length;
    const sufficient = totalOutcomes >= minOutcomes;
    const successRate = sufficient
      ? Math.round((awardedCount / totalOutcomes) * 100)
      : null;

    const org = orgRes.data;
    const context: FitAnalysisContext = {
      organization: org
        ? {
            name: org.name as string,
            missionStatement: (org.mission_statement as string | null) ?? null,
            serviceArea: (org.service_area as string | null) ?? null,
            targetPopulation:
              (org.target_population as string | null) ?? null,
            annualBudget: (org.annual_budget as number | null) ?? null,
            programs: (programsRes.data ?? []).map((p) => p.name as string),
          }
        : null,
      opportunity: {
        name: opportunity.name as string,
        category: opportunity.category as string,
        description: (opportunity.description as string | null) ?? null,
        funderName:
          (funderRes.data?.name as string | null | undefined) ?? null,
        eligibilityRequirements:
          (opportunity.eligibility_requirements as string | null) ?? null,
        amountMin: (opportunity.amount_min as number | null) ?? null,
        amountMax: (opportunity.amount_max as number | null) ?? null,
        eligibilityScore:
          (opportunity.eligibility_score as number | null) ?? null,
      },
      history: { sufficient, totalOutcomes, awardedCount, successRate },
    };

    const { system, prompt } = buildFitAnalysisPrompt(context);
    const response = await callClaude({ system, prompt, model, maxTokens });

    // Persist the analysis as a note on the opportunity (Agent 04: "Store
    // analysis in notes"). Best-effort — a notes failure must not fail the run.
    await supabase.from("notes").insert({
      organization_id: organizationId,
      opportunity_id: opportunity.id,
      content: `**Fit Analysis**\n\n${response.text}`,
      author_id: profile.id,
    });

    if (runId) {
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          output_summary: `Fit analysis for "${opportunity.name}"${
            successRate != null ? ` (historical success ${successRate}%)` : ""
          }.`,
          items_found: totalOutcomes,
          items_processed: 1,
          tokens_used: response.usage.totalTokens,
          duration_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    // Meter the AI request against the org's daily api_calls quota (§25).
    await trackUsage(supabase, organizationId, "api_calls", 1);

    return NextResponse.json({
      analysis: response.text,
      history: { sufficient, totalOutcomes, awardedCount, successRate },
      tokensUsed: response.usage.totalTokens,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Fit analysis failed.";
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
      "The fit analysis could not be generated. Please try again.",
      "analysis_failed",
      500,
    );
  }
}
