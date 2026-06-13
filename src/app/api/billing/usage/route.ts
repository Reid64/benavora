import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { getUsageSummary } from "@/lib/billing/usage-limiter";

export const runtime = "nodejs";

/**
 * GET /api/billing/usage - return the org's current usage vs tier limits for
 * all resource types (powers the Settings usage dashboard).
 * Any authenticated org member can read usage (Contracts §25 - read-only).
 */
export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const summary = await getUsageSummary(supabase, organizationId);
  return NextResponse.json(summary);
}
