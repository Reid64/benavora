import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { getBudgetSummary } from "@/lib/pil/cost";

// GET /api/pil/cost/summary — budget summary for the caller's org.
// (File lives at cost/summary/route.ts, matching the /api/pil/cost/summary
// path the task described — a route.ts at cost/route.ts could only ever
// serve /api/pil/cost, not the /summary sub-path.)

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const budgets = await getBudgetSummary(organizationId);
  return NextResponse.json({ budgets });
}
