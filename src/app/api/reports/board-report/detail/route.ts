// GET /api/reports/board-report/detail?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
// Full data aggregate for the printable /reports/board-report page. Derives
// organization_id from the authenticated session (never from the request —
// Contracts §2). Distinct from GET /api/reports/board-report (the lighter
// summary widget on the /reports index page).

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { aggregateBoardReportPageData } from "@/lib/reports/board-report-page";

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
    return jsonError("dateFrom and dateTo are required.", "missing_date_range", 400);
  }
  if (dateFrom > dateTo) {
    return jsonError("dateFrom must be before dateTo.", "invalid_range", 400);
  }

  try {
    const data = await aggregateBoardReportPageData(supabase, organizationId, dateFrom, dateTo);
    return NextResponse.json(data);
  } catch (err) {
    console.error("BOARD_REPORT_DETAIL ERROR:", err);
    return jsonError("Failed to load board report data.", "db_error", 500);
  }
}
