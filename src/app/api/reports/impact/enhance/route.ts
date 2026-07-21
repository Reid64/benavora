// POST /api/reports/impact/enhance — sends the org's current impact report
// data to Claude and returns a polished, publication-ready narrative version
// for the "Enhance with AI" button on /reports/impact. Re-aggregates data
// server-side from the session's organization_id rather than trusting a
// client-supplied payload (Contracts §2).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { callClaude, DEFAULT_MODEL, DEFAULT_MAX_TOKENS } from "@/lib/ai/claude";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { trackUsage } from "@/lib/billing/usage-tracker";
import { aggregateImpactReportData, buildImpactNarrativePrompt } from "@/lib/reports/impact-report";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST() {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const overLimit = await enforceLimit(supabase, organizationId, "api_calls");
  if (overLimit) return overLimit;

  try {
    const data = await aggregateImpactReportData(supabase, organizationId);
    const prompt = buildImpactNarrativePrompt(data);

    const result = await callClaude({
      prompt,
      model: DEFAULT_MODEL,
      maxTokens: DEFAULT_MAX_TOKENS,
      temperature: 0.5,
    });

    await trackUsage(supabase, organizationId, "api_calls", 1);

    return NextResponse.json({
      narrative: result.text.trim(),
      tokensUsed: result.usage.totalTokens,
    });
  } catch (err) {
    console.error("IMPACT_REPORT_ENHANCE ERROR:", err);
    return jsonError("AI enhancement failed. Please try again.", "enhance_failed", 500);
  }
}
