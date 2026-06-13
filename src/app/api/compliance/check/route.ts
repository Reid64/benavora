import { NextResponse } from "next/server";

import { AgentError } from "@/lib/agents/base-agent";
import { ComplianceChecker } from "@/lib/agents/compliance-checker";
import { DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { requireRole } from "@/lib/auth/role-gate";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { trackUsage } from "@/lib/billing/usage-tracker";

// POST /api/compliance/check — run the ComplianceChecker agent for an application.
// Derives organization_id from the session (BEHAVIORAL_CONTRACTS §2, §6). Returns
// a compliance_report with a passed boolean, checks array, blocking_issues, and
// warnings. A failed report prevents stage transition to "submitted" (§6).

export const runtime = "nodejs";

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

  const { application_id } = (body ?? {}) as { application_id?: unknown };
  if (typeof application_id !== "string" || !application_id.trim()) {
    return NextResponse.json(
      { error: "application_id is required.", code: "invalid_input" },
      { status: 400 },
    );
  }

  const overLimit = await enforceLimit(supabase, organizationId, "api_calls");
  if (overLimit) return overLimit;

  const { data: configRows } = await supabase
    .from("platform_config")
    .select("key, value")
    .in("key", ["ai.model", "ai.max_tokens"]);
  const config = new Map<string, string>(
    (configRows ?? []).map((r) => [r.key as string, r.value as string]),
  );
  const model = config.get("ai.model") ?? DEFAULT_MODEL;
  const maxTokens = Number(config.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;

  const checker = new ComplianceChecker({
    client: supabase,
    organizationId,
    triggeredBy: userId,
    model,
    maxTokens,
  });

  try {
    const outcome = await checker.run({ applicationId: application_id.trim() });
    await trackUsage(supabase, organizationId, "api_calls", 1);

    const result = outcome.data;

    const checks: {
      name: string;
      status: "pass" | "fail" | "warn";
      details: string;
    }[] = [
      ...result.passed.map((p) => ({
        name: p,
        status: "pass" as const,
        details: "",
      })),
      ...result.failed.map((f) => ({
        name: f.check,
        status: "fail" as const,
        details: f.detail,
      })),
      ...result.aiFindings.map((w) => ({
        name: "ai_review",
        status: "warn" as const,
        details: w,
      })),
    ];

    return NextResponse.json({
      data: {
        application_id: result.applicationId,
        passed: result.readyToSubmit,
        checks,
        blocking_issues: result.failed.map((f) => f.detail),
        warnings: result.aiFindings,
        checked_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof AgentError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return NextResponse.json(
      {
        error: "Compliance check failed. Please try again.",
        code: "check_failed",
      },
      { status: 500 },
    );
  }
}
