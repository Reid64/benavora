import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { getUsageSummary } from "@/lib/billing/usage-tracker";

// Organization usage metrics (BLUEPRINT Phase 5 / Behavioral Contracts §25).
//
// GET → current usage rolled up by metric (today / last 7 / last 30 days) with
// the org's tier limits for context. Powers the billing + admin usage views.
//
// Admin-or-owner only (usage/billing oversight is an admin concern, BLUEPRINT
// §3.3). organization_id is derived from the session, never the request (§2).

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const summary = await getUsageSummary(supabase, organizationId);
  return NextResponse.json(summary);
}
