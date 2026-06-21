// GET /api/autoapply/documents/readiness — readiness report for the org's document vault.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { DocumentVault } from "@/lib/autoapply/document-vault";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const vault = new DocumentVault(supabase);
  const report = await vault.getReadinessReport(organizationId);
  return NextResponse.json(report);
}
