// POST /api/reports/board-report/executive-summary { dateFrom, dateTo }
// Generates a ~200-word board-ready executive summary paragraph via Claude
// for the /reports/board-report page's "Generate Executive Summary" button.
// Re-aggregates the report data server-side from the session's organization_id
// (never trusts a client-supplied payload — Contracts §2) so the summary
// always reflects the same numbers the page is currently displaying.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { callClaude, DEFAULT_MODEL, DEFAULT_MAX_TOKENS } from "@/lib/ai/claude";
import { enforceLimit } from "@/lib/billing/tier-enforcer";
import { trackUsage } from "@/lib/billing/usage-tracker";
import {
  aggregateBoardReportPageData,
  buildExecutiveSummaryPrompt,
} from "@/lib/reports/board-report-page";

export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { dateFrom, dateTo } = (body ?? {}) as { dateFrom?: unknown; dateTo?: unknown };

  if (typeof dateFrom !== "string" || typeof dateTo !== "string" || !dateFrom || !dateTo) {
    return jsonError("dateFrom and dateTo are required.", "missing_date_range", 400);
  }
  if (dateFrom > dateTo) {
    return jsonError("dateFrom must be before dateTo.", "invalid_range", 400);
  }

  const overLimit = await enforceLimit(supabase, organizationId, "api_calls");
  if (overLimit) return overLimit;

  try {
    const data = await aggregateBoardReportPageData(supabase, organizationId, dateFrom, dateTo);
    const prompt = buildExecutiveSummaryPrompt(data);

    const result = await callClaude({
      prompt,
      model: DEFAULT_MODEL,
      maxTokens: DEFAULT_MAX_TOKENS,
      temperature: 0.4,
    });

    await trackUsage(supabase, organizationId, "api_calls", 1);

    return NextResponse.json({
      summary: result.text.trim(),
      tokensUsed: result.usage.totalTokens,
    });
  } catch (err) {
    console.error("BOARD_REPORT_EXEC_SUMMARY ERROR:", err);
    return jsonError("Executive summary generation failed. Please try again.", "summary_failed", 500);
  }
}
