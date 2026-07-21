// GET  /api/reports/impact — aggregated organization impact report data.
// PUT  /api/reports/impact { stories: string[] } — save the org's 1-2
//      "Stories of Impact" free-text entries (organization_id derived from
//      the session, never the request body — Contracts §2).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { aggregateImpactReportData, saveImpactStories } from "@/lib/reports/impact-report";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  try {
    const data = await aggregateImpactReportData(supabase, organizationId);
    return NextResponse.json(data);
  } catch (err) {
    console.error("IMPACT_REPORT ERROR:", err);
    return jsonError("Failed to load impact report data.", "db_error", 500);
  }
}

export async function PUT(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { stories } = (body ?? {}) as { stories?: unknown };
  if (!Array.isArray(stories) || !stories.every((s) => typeof s === "string")) {
    return jsonError("stories must be an array of strings.", "invalid_input", 400);
  }

  try {
    await saveImpactStories(supabase, organizationId, stories);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("IMPACT_REPORT_SAVE ERROR:", err);
    return jsonError("Failed to save stories of impact.", "db_error", 500);
  }
}
