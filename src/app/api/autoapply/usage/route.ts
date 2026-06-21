// GET /api/autoapply/usage — returns usage report for the current org and period.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { UsageMeter } from "@/lib/autoapply/usage-meter";

export const runtime = "nodejs";

export async function GET(_request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;

  const { supabase, organizationId } = gate;

  const meter = new UsageMeter();
  const report = await meter.getUsageReport(organizationId, undefined, supabase);

  return NextResponse.json(report);
}
