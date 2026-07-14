// GET /api/reports/board-report?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
// Derives organization_id from the authenticated session (never from the
// request - Contracts §2); any orgId query param is ignored.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { generateBoardReport } from "@/lib/reports/board-report-generator";

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (!dateFrom || !dateTo) {
    return jsonError(
      "dateFrom and dateTo are required.",
      "missing_date_range",
      400,
    );
  }
  if (dateFrom > dateTo) {
    return jsonError("dateFrom must be before dateTo.", "invalid_range", 400);
  }

  const report = await generateBoardReport(
    organizationId,
    dateFrom,
    dateTo,
    supabase,
  );

  return NextResponse.json(report);
}
